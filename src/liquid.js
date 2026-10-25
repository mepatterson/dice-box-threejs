import * as THREE from "three"

// Liquid fill for glass dice (`liquid` on the colorset): a coloured liquid inside the die whose surface stays level
// with the world however the die turns. It is the die's own geometry, a little smaller so the glass has walls, drawn
// twice between the glass's back faces and its front faces: the back faces first, then the front ones, both cut away
// above a plane in world space. Where the front faces are cut, the back faces below the plane show through the hole,
// and those are drawn as the liquid's top (lit as a flat surface facing up the plane), so the die reads as filled to
// a level. A thin band just under the plane, on both, is the meniscus, a little lighter.
// The plane's normal tilts with a damped spring (DiceBox.slosh) driven by the die's motion as it plays back, so the
// liquid rushes up one side when the die is shoved and settles; impacts also start a ripple that dies away.
// Bubbles rise through the liquid on the drift clock and pop at the surface. Under prefers-reduced-motion the surface
// stays level and the bubbles hold still.

export const LIQUID_STYLES = ['water', 'potion']
// Water is clear and light; potion is deeper, glows faintly (and blooms with the colorset's bloom) and fizzes more.
// opacity: the body's alpha head-on; deep: how much darker and more opaque it grows towards the rim; glow: the light it
// gives off; bubbles: the share of the device's bubbles.
export const LIQUIDS = {
	water: { color: '#4FA8E0', opacity: 0.8, deep: 0.55, glow: 0, bubbles: 0.4 },
	potion: { color: '#8B3FD9', opacity: 0.72, deep: 0.8, glow: 0.35, bubbles: 1 },
}
export const LIQUID_LEVEL = 0.6
// Bubbles per die by device, before the style's share.
export const BUBBLE_BUDGETS = { desktop: 36, tablet: 28, phone: 18 }
// The faces of a die with a liquid veil it at this share of glass_opacity, so the liquid shows in its own colour; the
// edges, shine and refraction still say glass.
export const LIQUID_VEIL = 0.2
// The liquid is the die shrunk to this, so the glass keeps a wall round it.
export const LIQUID_SCALE = 0.9
// The surface catches the key light from here (the same as glass's glints).
const KEY = new THREE.Vector3(-0.35, 0.45, 0.82).normalize()

// The height (in radii, -1 to 1) under which a ball holds `fill` of its volume, by bisection.
export function fillHeight(fill) {
	let lo = -1, hi = 1
	for (let i = 0; i < 30; i++) {
		const mid = (lo + hi) / 2
		if ((mid + 1) ** 2 * (2 - mid) / 4 < fill) lo = mid
		else hi = mid
	}
	return (lo + hi) / 2
}

// The liquid's surface height above the die's centre in its own units, for a level of 0 to 1: the hull is taken as a
// ball between its inradius and its radius. A full die never cuts; an empty one has no liquid.
export function levelOf(geometry, level) {
	const radius = geometry.boundingSphere ? geometry.boundingSphere.radius : 1
	const shape = geometry.cannon_shape
	let inradius = radius * 0.7
	if (shape && shape.faces && shape.faceNormals) {
		inradius = Math.min(...shape.faces.map((face, k) => {
			const n = shape.faceNormals[k], v = shape.vertices[face[0]]
			return n.x * v.x + n.y * v.y + n.z * v.z
		}))
	}
	const ball = LIQUID_SCALE * (inradius + radius) / 2
	return { height: level >= 0.999 ? radius * 10 : fillHeight(level) * ball, radius: radius * LIQUID_SCALE }
}

// One die's slosh: the plane normal's tilt (x, y) and its rate, and a ripple (amplitude in die units, phase, direction).
export function sloshState() {
	return { tx: 0, ty: 0, vx: 0, vy: 0, amp: 0, phase: 0, dx: 1, dy: 0, resting: true }
}

const VERTEX = `
	varying vec3 vLiquidWorld;
	varying vec3 vLiquidCentre;
	varying vec3 vLiquidNormal;
	void main() {
		vec4 world = modelMatrix * vec4( position, 1.0 );
		vLiquidWorld = world.xyz;
		vLiquidCentre = modelMatrix[ 3 ].xyz;
		vLiquidNormal = normalize( mat3( modelMatrix ) * normal );
		gl_Position = projectionMatrix * viewMatrix * world;
	}`

// How far under the surface a point is (negative above it), with the ripple.
const SURFACE = `
	uniform vec4 liquidPlane;
	uniform vec4 liquidWave;
	uniform float liquidBand;
	float liquidBelow( vec3 rel ) {
		return liquidPlane.w + liquidWave.z * sin( dot( rel.xy, liquidWave.xy ) + liquidWave.w ) - dot( rel, liquidPlane.xyz );
	}`

const FRAGMENT = `
	uniform vec3 liquidColor;
	uniform vec3 liquidLook;
	uniform vec3 liquidKey;
	uniform float liquidBloomOnly;
	varying vec3 vLiquidWorld;
	varying vec3 vLiquidCentre;
	varying vec3 vLiquidNormal;
	${SURFACE}
	// Towards white by t as the eye sees it: mixed in linear light, even a little white turns a deep red pink.
	vec3 liquidLift( vec3 c, float t ) {
		return pow( mix( pow( c, vec3( 1.0 / 2.2 ) ), vec3( 1.0 ), t ), vec3( 2.2 ) );
	}
	void main() {
		float below = liquidBelow( vLiquidWorld - vLiquidCentre );
		float line = max( liquidBand * 0.3, fwidth( below ) * 1.5 );
		if ( liquidBloomOnly > 0.5 ) {
			if ( below < 0.0 ) discard;
			gl_FragColor = vec4( liquidColor * liquidLook.z * 2.0, 1.0 );
			return;
		}
		float fill = 1.0 - smoothstep( 0.0, line, abs( below ) );
		float glow = 1.0 - smoothstep( 0.0, liquidBand * 3.5, abs( below ) );
		vec3 pale = liquidLift( liquidColor, 0.35 );
		#ifdef LIQUID_TOP
			if ( below < 0.0 ) {
				// the empty glass above the surface: a pale veil, clearer than the filled part
				vec3 air = liquidLift( liquidColor, 0.6 );
				float veil = ( 0.22 + 0.3 * glow ) * ( 1.0 - fill );
				gl_FragColor = vec4( mix( air * veil, pale, fill ), max( veil, fill ) );
				#include <colorspace_fragment>
				#include <premultiplied_alpha_fragment>
				return;
			}
		#else
			if ( below < - line ) discard;
		#endif
		vec3 view = normalize( cameraPosition - vLiquidWorld );
		float rim = 1.0 - smoothstep( 0.0, max( liquidBand, fwidth( below ) * 1.5 ), below );
		vec3 color;
		float alpha;
		#ifdef LIQUID_TOP
			float facing = abs( dot( liquidPlane.xyz, view ) );
			float shine = pow( max( dot( liquidPlane.xyz, normalize( liquidKey + view ) ), 0.0 ), 80.0 );
			color = liquidLift( liquidColor, 0.04 + 0.2 * ( 1.0 - facing ) ) * 1.1 + shine * 0.7;
			alpha = mix( liquidLook.x + 0.18, 1.0, 0.45 * ( 1.0 - facing ) );
		#else
			float facing = abs( dot( normalize( vLiquidNormal ), view ) );
			color = liquidLift( liquidColor, 0.05 ) * mix( 1.1, 0.6, liquidLook.y * ( 1.0 - facing ) );
			alpha = liquidLook.x + ( 1.0 - liquidLook.x ) * liquidLook.y * 0.6 * ( 1.0 - facing );
		#endif
		color = mix( color, liquidLift( liquidColor, 0.2 ), max( rim * 0.5, glow * 0.3 ) );
		alpha = mix( alpha, 1.0, rim * 0.6 );
		color = mix( color, pale, fill * 0.6 );
		alpha = mix( alpha, 1.0, fill * 0.6 );
		color += liquidColor * liquidLook.z * 0.6;
		gl_FragColor = vec4( min( color, vec3( 1.0 ) ), clamp( alpha, 0.0, 1.0 ) );
		#include <colorspace_fragment>
		#include <premultiplied_alpha_fragment>
	}`

// The liquid's body (front faces) or its top (back faces, `top`), in `color` with a style's look. Premultiplied, like
// glass. Its plane, ripple and meniscus are per die (`liquidUniforms`, set before each draw).
export function liquidMaterial({ color, style, top, bloomOnly }) {
	const look = LIQUIDS[style] || LIQUIDS.water
	const mat = new THREE.ShaderMaterial({
		uniforms: {
			liquidPlane: { value: new THREE.Vector4(0, 0, 1, 0) },
			liquidWave: { value: new THREE.Vector4(1, 0, 0, 0) },
			liquidBand: { value: 1 },
			liquidColor: { value: new THREE.Color(color) },
			liquidLook: { value: new THREE.Vector3(look.opacity, look.deep, look.glow) },
			liquidKey: { value: KEY },
			liquidBloomOnly: bloomOnly,
		},
		vertexShader: VERTEX,
		fragmentShader: FRAGMENT,
		defines: top ? { LIQUID_TOP: '' } : {},
		side: top ? THREE.BackSide : THREE.FrontSide,
		transparent: true,
		premultipliedAlpha: true,
		depthTest: false,
		depthWrite: false,
	})
	mat.customProgramCacheKey = () => `liquid|${top ? 'top' : 'body'}`
	return mat
}

// Bubbles: points in a frame with the world's axes, each rising along the world's up across the ball that fits inside
// the liquid, wobbling, drawn only below the surface as a thin bright ring.
export function bubbleCloud(count, seed = 1) {
	let s = seed * 7919 + 17
	const next = () => (s = (s * 16807) % 2147483647) / 2147483647
	const positions = new Float32Array(count * 3)
	const bubble = new Float32Array(count * 4)
	for (let i = 0; i < count; i++) {
		const r = 0.8 * Math.sqrt(next()), a = next() * Math.PI * 2
		bubble.set([Math.cos(a) * r, Math.sin(a) * r, next(), 0.25 + 0.35 * next()], i * 4)
		positions.set([0, 0, 0.3 + 0.7 * next() ** 2], i * 3)
	}
	const cloud = new THREE.BufferGeometry()
	cloud.setAttribute('position', new THREE.BufferAttribute(positions, 3))
	cloud.setAttribute('bubble', new THREE.BufferAttribute(bubble, 4))
	cloud.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1)
	return cloud
}

export function bubbleMaterial({ color, style, time, pixels }) {
	const look = LIQUIDS[style] || LIQUIDS.water
	const mat = new THREE.ShaderMaterial({
		uniforms: {
			liquidPlane: { value: new THREE.Vector4(0, 0, 1, 0) },
			liquidWave: { value: new THREE.Vector4(1, 0, 0, 0) },
			liquidBand: { value: 1 },
			bubbleReach: { value: 1 },
			bubbleColor: { value: new THREE.Color(color).lerp(new THREE.Color(1, 1, 1), 0.55) },
			bubbleGlow: { value: look.glow },
			driftTime: time,
			pointScale: pixels,
		},
		vertexShader: `
			attribute vec4 bubble;
			uniform float bubbleReach;
			uniform float driftTime;
			uniform float pointScale;
			varying vec3 vBubbleRel;
			varying float vBubbleFade;
			void main() {
				float scale = length( modelMatrix[ 0 ].xyz );
				float run = fract( bubble.z + driftTime * bubble.w );
				float reach = bubbleReach * scale;
				float span = sqrt( max( 1.0 - dot( bubble.xy, bubble.xy ), 0.0 ) );
				vec3 rel = vec3( bubble.xy + 0.06 * vec2( sin( driftTime * 5.0 + bubble.z * 40.0 ), cos( driftTime * 4.0 + bubble.z * 30.0 ) ), ( run * 2.0 - 1.0 ) * span ) * reach;
				vBubbleRel = rel;
				vBubbleFade = smoothstep( 0.0, 0.15, run );
				vec4 mv = viewMatrix * vec4( modelMatrix[ 3 ].xyz + rel, 1.0 );
				gl_Position = projectionMatrix * mv;
				gl_PointSize = position.z * 0.16 * reach * pointScale / max( - mv.z, 1.0 );
			}`,
		fragmentShader: `
			uniform vec3 bubbleColor;
			uniform float bubbleGlow;
			varying vec3 vBubbleRel;
			varying float vBubbleFade;
			${SURFACE}
			void main() {
				float below = liquidBelow( vBubbleRel );
				if ( below < 0.0 ) discard;
				vec2 p = gl_PointCoord * 2.0 - 1.0;
				float r = length( p );
				float ring = smoothstep( 1.0, 0.75, r ) * ( 0.35 + 0.65 * smoothstep( 0.45, 0.85, r ) );
				float spot = smoothstep( 0.3, 0.0, length( p - vec2( - 0.35, - 0.35 ) ) );
				float alpha = ( ring * ( 0.55 + bubbleGlow ) + spot * 0.6 ) * vBubbleFade * smoothstep( 0.0, liquidBand * 2.0, below );
				if ( alpha < 0.004 ) discard;
				gl_FragColor = vec4( bubbleColor, min( alpha, 1.0 ) );
				#include <colorspace_fragment>
				#include <premultiplied_alpha_fragment>
			}`,
		transparent: true,
		premultipliedAlpha: true,
		depthTest: false,
		depthWrite: false,
	})
	mat.customProgramCacheKey = () => 'liquid|bubbles'
	return mat
}

// Before a liquid part draws: its die's plane, ripple and meniscus in world units (a popping die is scaled).
export function applySlosh(uniforms, liquid, scale) {
	const { state, height, radius } = liquid
	const length = Math.hypot(state.tx, state.ty, 1)
	uniforms.liquidPlane.value.set(state.tx / length, state.ty / length, 1 / length, height * scale)
	const k = Math.PI * 2 / (1.3 * radius * scale)
	uniforms.liquidWave.value.set(state.dx * k, state.dy * k, state.amp * scale, state.phase)
	uniforms.liquidBand.value = 0.05 * radius * scale
	if (uniforms.bubbleReach) uniforms.bubbleReach.value = radius * 0.8
}
