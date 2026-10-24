import * as THREE from "three"
import { DICE_GEOM } from "./const/dice"

// Energy: a die of nothing but glowing lines. Each face of the die's polyhedron gets loops of thin ribbons
// just inside its edges, so every edge carries a bundle of parallel lines (half on each of its faces) and,
// with `faces`, a pair of fainter contour lines a little further in. The ribbons lie flat in the face planes
// and are drawn in a shader, additive and with no body: a soft-edged line a pixel or so wide (never thinner,
// so it stays smooth at any size) in the glow colour with a little halo, dimmer on faces turned away so the
// back of the die reads as depth, a white-hot core where it runs brightest, and, with `flow`, a comet of
// light running round each loop. The numbers are drawn on the die's own faces as glowing strokes
// (DiceFactory), dim until a face is the result. One shared clock drives every energy die, kept to a span
// every loop's pulses repeat over, so it stays small for mediump phones. With `colors` the lines take a second
// colour too (ENERGY_COLORS): contours and numbers in it ("edges"), pulses flaring into it ("pulses"), a blend
// across the die from the glow colour to it that tumbles with the die ("gradient"), or neither: hues drifting
// round each loop ("prismatic", at `speed`).

export const ENERGY_GLOW = '#FF8A2B'
// The flow clock repeats over this many seconds; each loop's pulse goes round a whole number of times in it.
export const ENERGY_PERIOD = 60
// Ribbons in die radii: the edge bundle's insets from the edge, the contours', and a ribbon's half width
// (its line is CORE of that, the rest its halo).
const EDGE_INSETS = [0.016, 0.034, 0.052]
const CONTOUR_INSETS = [0.088, 0.108]
const HALF_WIDTH = 0.012
export const ENERGY_COLORS = ['one', 'edges', 'pulses', 'gradient', 'prismatic']
// The way across the die a gradient runs, in the die's own space.
const GRADIENT_AXIS = [0.35, 0.87, 0.35]
export const ENERGY = { CORE: 0.32, HALO: 0.3, BASE: 0.6, FLOW: 2.2, BACK: 0.22, CONTOUR: 0.5, WHITE: 0.9, NUMBER: 0.5, RESULT: 2.2, RATE_LOW: 26, RATE_HIGH: 44, PRISM: 1.7, PAIR: 1.35 }

function random(seed) {
	return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

// The faces of a die type's polyhedron, each a list of corner points at `radius` with its outward normal.
function facesOf(shape, radius) {
	const geom = DICE_GEOM[shape]
	if (!geom) return null
	const points = geom.vertices.map(v => new THREE.Vector3().fromArray(v).normalize().multiplyScalar(radius))
	return geom.faces.map(face => {
		const corners = face.slice(0, face.length - 1).map(i => points[i])
		const middle = corners.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(corners.length)
		const normal = new THREE.Vector3()
		for (let k = 0; k < corners.length; k++) {
			const a = corners[k], b = corners[(k + 1) % corners.length]
			normal.x += (a.y - b.y) * (a.z + b.z)
			normal.y += (a.z - b.z) * (a.x + b.x)
			normal.z += (a.x - b.x) * (a.y + b.y)
		}
		normal.normalize()
		if (normal.dot(middle) < 0) normal.negate()
		return { corners, middle, normal }
	})
}

// A convex face's outline moved `inset` inwards: each edge's line shifted along its inward normal, the corners
// where neighbouring lines meet.
function insetLoop({ corners, middle, normal }, inset) {
	const n = corners.length
	const inward = corners.map((a, k) => {
		const b = corners[(k + 1) % n]
		const d = new THREE.Vector3().crossVectors(normal, new THREE.Vector3().subVectors(b, a)).normalize()
		if (d.dot(new THREE.Vector3().subVectors(middle, a)) < 0) d.negate()
		return d
	})
	return corners.map((p, k) => {
		const a = inward[(k + n - 1) % n], b = inward[k]
		return p.clone().addScaledVector(new THREE.Vector3().addVectors(a, b), inset / (1 + a.dot(b)))
	})
}

// The ribbons of a die type: per vertex its position, its face's normal, and `energy` (across the ribbon -1
// to 1, how far round its loop in pulse cycles, its brightness, a seed).
export function energyLines(shape, radius, { faces = true } = {}) {
	const list = facesOf(shape, radius)
	if (!list) return null
	const next = random(shape.length * 97 + Math.round(radius))
	const positions = [], normals = [], energy = [], index = []
	const loops = [...EDGE_INSETS.map(at => [at, 1]), ...(faces ? CONTOUR_INSETS.map(at => [at, ENERGY.CONTOUR]) : [])]
	for (const face of list) {
		for (const [at, level] of loops) {
			const outer = insetLoop(face, (at - HALF_WIDTH) * radius)
			const centre = insetLoop(face, at * radius)
			const inner = insetLoop(face, (at + HALF_WIDTH) * radius)
			const n = centre.length
			const lengths = centre.map((p, k) => p.distanceTo(centre[(k + 1) % n]))
			const total = lengths.reduce((a, b) => a + b, 0)
			const seed = next()
			let along = 0
			for (let k = 0; k < n; k++) {
				const j = (k + 1) % n
				const from = along / total, to = (along + lengths[k]) / total
				along += lengths[k]
				const base = positions.length / 3
				for (const [p, across, at] of [[outer[k], -1, from], [outer[j], -1, to], [inner[j], 1, to], [inner[k], 1, from]]) {
					positions.push(p.x, p.y, p.z)
					normals.push(face.normal.x, face.normal.y, face.normal.z)
					energy.push(across, at, level, seed)
				}
				index.push(base, base + 1, base + 2, base, base + 2, base + 3)
			}
		}
	}
	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
	geometry.setAttribute('energy', new THREE.Float32BufferAttribute(energy, 4))
	geometry.setIndex(index)
	geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius)
	return geometry
}

const consts = () => Object.entries({ ...ENERGY, PERIOD: ENERGY_PERIOD }).map(([k, v]) => `#define ENERGY_${k} ${Number(v).toFixed(3)}`).join('\n')

// The second colour a look's `colors` uses when it names none: the glow colour a third of the way round the wheel.
export function energySecond(color, second) {
	return second ? new THREE.Color(second) : new THREE.Color(color).offsetHSL(1 / 3, 0, 0)
}

// The ribbons' material. look: { color, second, colors (ENERGY_COLORS), speed, time (the shared clock), flow, core,
// dim }. Premultiplied and additive, never brighter than its alpha (WebKit blots a canvas pixel that is).
export function energyLinesMaterial({ color, second = null, colors = 'one', speed = 1, time, flow = true, core = true, dim = false }) {
	const mode = Math.max(0, ENERGY_COLORS.indexOf(colors))
	return new THREE.ShaderMaterial({
		uniforms: {
			energyColor: { value: new THREE.Color(color) },
			energySecond: { value: energySecond(color, second) },
			energyTime: time,
			energyLook: { value: new THREE.Vector3(flow ? 1 : 0, core ? 1 : 0, dim ? 0.3 : 1) },
			energyHues: { value: Math.max(1, Math.round(3 * speed)) },
		},
		defines: { ENERGY_MODE: mode },
		vertexShader: `
			attribute vec4 energy;
			varying vec4 vEnergy;
			varying float vFacing;
			varying float vAcross;
			void main() {
				vEnergy = energy;
				vAcross = dot( normalize( position ), normalize( vec3( ${GRADIENT_AXIS.map(v => v.toFixed(3)).join(', ')} ) ) );
				vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
				vFacing = dot( normalize( normalMatrix * normal ), normalize( - mvPosition.xyz ) );
				gl_Position = projectionMatrix * mvPosition;
			}`,
		fragmentShader: `${consts()}
			uniform vec3 energyColor;
			uniform vec3 energySecond;
			uniform float energyTime;
			uniform vec3 energyLook;
			uniform float energyHues;
			varying vec4 vEnergy;
			varying float vFacing;
			varying float vAcross;
			// A colour at full brightness times scale, so a blend of two keeps their light.
			vec3 energyFull( vec3 c, float scale ) {
				return c / max( max( c.r, max( c.g, c.b ) ), 0.001 ) * scale;
			}
			vec3 energyHue( float h ) {
				return clamp( abs( mod( h * 6.0 + vec3( 0.0, 4.0, 2.0 ), 6.0 ) - 3.0 ) - 1.0, 0.0, 1.0 );
			}
			void main() {
				float d = abs( vEnergy.x );
				float px = max( fwidth( vEnergy.x ), 0.0001 );
				float wide = max( ENERGY_CORE, px * 0.8 );
				float line = ( 1.0 - smoothstep( wide - px * 0.5, wide + px * 0.5, d ) ) * ENERGY_CORE / wide;
				float halo = exp( - d * d * 5.0 ) * ENERGY_HALO;
				float rate = floor( mix( ENERGY_RATE_LOW, ENERGY_RATE_HIGH, vEnergy.w ) ) / ENERGY_PERIOD;
				float phase = fract( vEnergy.y - energyTime * rate + vEnergy.w * 7.0 );
				float pulse = pow( phase, 12.0 ) * smoothstep( 1.0, 0.98, phase ) * energyLook.x;
				float white = ENERGY_WHITE * energyLook.y;
				#if ENERGY_MODE == 1
					// the white-hot core stays on the edges, so the contours keep the second colour
					white *= step( 0.75, vEnergy.z );
				#elif ENERGY_MODE == 2
					// a longer comet all in the second colour, with no white-hot head to hide it
					float tail = pow( phase, 4.0 ) * smoothstep( 1.0, 0.98, phase ) * energyLook.x;
					pulse = max( pulse, tail * 0.7 );
					white *= 1.0 - smoothstep( 0.02, 0.3, tail );
				#endif
				float strength = vEnergy.z;
				#if ENERGY_MODE == 1
					strength = 1.0;
				#endif
				float level = strength * mix( ENERGY_BACK, 1.0, smoothstep( - 0.2, 0.2, vFacing ) ) * energyLook.z;
				float bright = level * ( ENERGY_BASE + ENERGY_FLOW * pulse );
				vec3 glow = energyColor;
				#if ENERGY_MODE == 1
					glow = energyFull( mix( energySecond, energyColor, step( 0.75, vEnergy.z ) ), ENERGY_PAIR );
				#elif ENERGY_MODE == 2
					glow = energyFull( mix( energyColor, energySecond, smoothstep( 0.02, 0.3, tail ) ), ENERGY_PAIR );
				#elif ENERGY_MODE == 3
					glow = energyFull( mix( energyColor, energySecond, smoothstep( - 0.8, 0.8, vAcross ) ), ENERGY_PAIR );
				#elif ENERGY_MODE == 4
					float hue = fract( vEnergy.y + vEnergy.w + vAcross * 0.25 - energyTime * energyHues / ENERGY_PERIOD );
					glow = energyHue( hue ) * ENERGY_PRISM;
				#endif
				vec3 light = glow * bright * ( line + halo ) + vec3( white ) * line * smoothstep( 0.5, 1.6, bright ) * bright;
				light = min( light, vec3( 1.0 ) );
				float alpha = max( light.r, max( light.g, light.b ) );
				gl_FragColor = vec4( light / max( alpha, 0.0001 ), alpha );
				#include <colorspace_fragment>
				#include <premultiplied_alpha_fragment>
			}`,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		side: THREE.DoubleSide,
		blending: THREE.AdditiveBlending,
		premultipliedAlpha: true,
	})
}

// The numbers' patch on a MeshBasicMaterial whose map is the label drawn as white strokes on black: light in
// energyGlow (rgb the colour, a the strength), with ENERGY_HOT a white core where the strokes are brightest,
// nothing else.
export function energyNumberShader(shader, glow) {
	shader.uniforms.energyGlow = glow
	shader.fragmentShader = shader.fragmentShader
		.replace('void main() {', `${consts()}\nuniform vec4 energyGlow;\nvoid main() {`)
		.replace('#include <opaque_fragment>', `
			float energyInk = diffuseColor.r;
			vec3 energyLight = energyGlow.rgb * energyGlow.a * energyInk;
			#ifdef ENERGY_HOT
				energyLight += vec3( ENERGY_WHITE * 0.5 ) * energyGlow.a * pow( energyInk, 3.0 );
			#endif
			#ifdef ENERGY_DIM
				energyLight *= 0.3;
			#endif
			energyLight = min( energyLight, vec3( 1.0 ) );
			float energyAlpha = max( energyLight.r, max( energyLight.g, energyLight.b ) );
			gl_FragColor = vec4( energyLight / max( energyAlpha, 0.0001 ), energyAlpha );`)
}
