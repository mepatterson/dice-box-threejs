import * as THREE from "three"
import { radialDot } from "./helpers.js"

// Inner sparkles: a cloud of soft point sprites inside a glass die (`inner` on the colorset, in `inner_color` or
// the accent). The cloud is a THREE.Points child of the die, sampled inside its physics hull shrunk towards the
// middle, so it turns with the die and never pokes out of its faces. Everything moves in the vertex shader from
// one shared time uniform, scaled by the colorset's `inner_speed`:
// - snow sinks and embers rise along the world's up, as seen from inside the tumbling die, fading out at the end
//   of their run and in again at the start; a galaxy turns about the die's own axis, faster near the middle.
// - blizzard flakes stream fast in one steady direction of the world, whatever the die does, each crossing the
//   ball that fits inside the die and coming in again on the far side, so it never runs out.
// - maelstrom particles spiral fast into a tight vortex about the die's centre (about the world's up, so it
//   reads as a whirlpool from above), faster near the middle, and start again at the rim.
// - lightning is a branching bolt made by midpoint displacement (octaves of random offsets, halving each time,
//   pinned at the ends) between two points on that ball, with up to three branches, drawn again every eighth of
//   a second, flickering, sometimes missing a beat, and now and then a flash that fills the glass with light.
// The world-fixed styles live in a frame that keeps the world's axes: the model matrix transposed takes them into
// the die. Nothing moves on the CPU, and under prefers-reduced-motion the time stays still: everything holds
// where it is, a bolt included.

export const INNER_STYLES = ['snow', 'galaxy', 'embers', 'blizzard', 'maelstrom', 'lightning']
// Sprites per die by device.
export const INNER_BUDGETS = { desktop: 260, tablet: 180, phone: 110 }
// How far inside the hull the cloud stays (a share of each face's distance from the middle), and how far
// a drifting sprite may stray from its place (a share of what is left).
const SHRINK = 0.78
const STRAY = 0.4
const STYLE = { snow: 0, galaxy: 1, embers: 2, blizzard: 3, maelstrom: 4, lightning: 5 }
// Lightning's colour without an accent or inner_color.
export const LIGHTNING_GLOW = '#9FD8FF'
// A bolt has this many branches besides its trunk, which takes this share of the sprites.
const BRANCHES = 3
const TRUNK = 0.55

function random(seed) {
	return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

// A soft round dot, brightest in the middle.
export function dotTexture() {
	return radialDot(32, [[0, 1], [0.25, 0.7], [0.6, 0.15], [1, 0]])
}

// The die's hull as planes (normal, distance from the middle), from its cannon shape.
function planesOf(geometry) {
	const shape = geometry.cannon_shape
	if (!shape || !shape.faces || !shape.faceNormals) return null
	return shape.faces.map((face, k) => {
		const n = shape.faceNormals[k], v = shape.vertices[face[0]]
		return [n.x, n.y, n.z, n.x * v.x + n.y * v.y + n.z * v.z]
	})
}

// `count` sprites inside the die: positions, `sparkle` (phase, speed, size, seed) and `reach`, how far each
// may drift. A galaxy is a thin disc about the die's axis, inside the ball that fits the shrunk hull, so
// turning never carries a sprite out; snow and embers fill the shrunk hull. The world-fixed styles keep
// their own coordinates in `position` and the ball's radius in `reach`: a blizzard flake its place across
// the stream and along it; a maelstrom particle its start angle, its place in its life and its height; a
// lightning sprite how far along its bolt, which bolt (0 the trunk, then the branches, -1 the flash) and
// the cloud's seed.
export function innerCloud(geometry, count, style, seed = 1) {
	const planes = planesOf(geometry)
	const radius = geometry.boundingSphere ? geometry.boundingSphere.radius : 1
	const inradius = planes ? Math.min(...planes.map(p => p[3])) : radius * 0.6
	const margin = inradius * (1 - SHRINK)
	const next = random(seed * 7919 + 13)
	const inside = (x, y, z) => !planes || planes.every(([nx, ny, nz, d]) => nx * x + ny * y + nz * z <= d * SHRINK)
	const positions = new Float32Array(count * 3)
	const sparkle = new Float32Array(count * 4)
	const reach = new Float32Array(count)
	const galaxy = style == 'galaxy'
	const ball = inradius * SHRINK * 0.95
	const trunk = Math.max(2, Math.round((count - 1) * TRUNK))
	const branch = Math.max(2, Math.floor((count - 1 - trunk) / BRANCHES))
	for (let i = 0; i < count; i++) {
		let x, y, z, speed, size
		if (style == 'blizzard') {
			const r = ball * 0.92 * Math.sqrt(next()), a = next() * Math.PI * 2
			x = Math.cos(a) * r
			y = Math.sin(a) * r
			z = next()
			speed = 1.8 + 1.4 * next()
			size = radius * (0.22 + 0.24 * next() ** 2)
		} else if (style == 'maelstrom') {
			x = next() * Math.PI * 2
			y = next()
			z = next() * 2 - 1
			speed = 0.8 + 0.4 * next()
			size = radius * (0.22 + 0.3 * next() ** 2)
		} else if (style == 'lightning') {
			const bolt = i == 0 ? -1 : i <= trunk ? 0 : Math.min(BRANCHES, 1 + Math.floor((i - 1 - trunk) / branch))
			const along = bolt < 0 ? 0 : bolt == 0 ? (i - 1) / (trunk - 1) : ((i - 1 - trunk) % branch) / (branch - 1)
			x = along
			y = bolt
			z = seed
			speed = 0
			size = bolt < 0 ? radius * 4 : radius * (bolt == 0 ? 0.45 : 0.32)
		} else if (galaxy) {
			const r = ball * Math.sqrt(next()) * (0.15 + 0.85 * next() ** 0.3), a = next() * Math.PI * 2
			x = Math.cos(a) * r
			y = Math.sin(a) * r
			z = (next() - 0.5) * ball * 0.5 * (1 - r / ball) ** 0.5
			speed = 0.12 + 0.3 * (1 - Math.hypot(x, y) / Math.max(ball, 1e-6))
			size = radius * (0.2 + 0.3 * next() ** 2)
		} else {
			do {
				x = (next() * 2 - 1) * radius
				y = (next() * 2 - 1) * radius
				z = (next() * 2 - 1) * radius
			} while (!inside(x, y, z))
			speed = style == 'snow' ? 0.08 + 0.08 * next() : 0.12 + 0.12 * next()
			size = radius * (style == 'snow' ? 0.26 + 0.3 * next() : 0.18 + 0.24 * next())
		}
		positions.set([x, y, z], i * 3)
		sparkle.set([next() * 6.2832, speed, size, next()], i * 4)
		reach[i] = STYLE[style] >= 3 ? ball : margin * STRAY
	}
	const cloud = new THREE.BufferGeometry()
	cloud.setAttribute('position', new THREE.BufferAttribute(positions, 3))
	cloud.setAttribute('sparkle', new THREE.BufferAttribute(sparkle, 4))
	cloud.setAttribute('reach', new THREE.BufferAttribute(reach, 1))
	cloud.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius)
	return cloud
}

// The vertex shader's motion for each style: sets `transformed` (in the die) and `sparkleFade`.
const MOTION = {
	// snow, embers: along the world's up, within each sprite's reach
	drift: (down) => `
		vec3 sparkleUp = normalize( transpose( mat3( modelMatrix ) ) * vec3( 0.0, 0.0, 1.0 ) );
		float sparkleRun = fract( sparkleT );
		vec3 sparkleSway = vec3( sin( sparkleT * 2.7 + sparkle.w * 6.0 ), cos( sparkleT * 2.1 + sparkle.w * 9.0 ), 0.0 ) * 0.3;
		transformed += ( sparkleUp * ( ( sparkleRun - 0.5 ) * ${down ? '-1.4' : '1.4'} ) + sparkleSway ) * reach;
		sparkleFade = sin( sparkleRun * 3.14159 );`,
	galaxy: `
		float sparkleC = cos( sparkleT ), sparkleS = sin( sparkleT );
		transformed.xy = vec2( sparkleC * position.x - sparkleS * position.y, sparkleS * position.x + sparkleC * position.y );`,
	blizzard: `
		vec3 sparkleW = normalize( vec3( 1.0, - 0.45, - 0.35 ) );
		vec3 sparkleE1 = normalize( cross( sparkleW, vec3( 0.0, 0.0, 1.0 ) ) );
		vec3 sparkleE2 = cross( sparkleW, sparkleE1 );
		float sparkleHalf = sqrt( max( reach * reach - dot( position.xy, position.xy ), 0.0 ) );
		float sparkleRun = fract( position.z + sparkleClock * sparkle.y * reach / max( 2.0 * sparkleHalf, 0.001 ) );
		vec3 sparkleWobble = sparkleE1 * sin( sparkleClock * 7.0 + sparkle.w * 40.0 ) * 0.03 * reach;
		sparkleWorld = sparkleW * ( sparkleRun * 2.0 - 1.0 ) * sparkleHalf + sparkleE1 * position.x + sparkleE2 * position.y + sparkleWobble;
		sparkleFade = pow( sin( sparkleRun * 3.14159 ), 0.5 );`,
	maelstrom: `
		float sparkleMax = reach * 0.95, sparkleMin = reach * 0.06, sparkleEye = reach * 0.1;
		float sparkleCycle = sparkleClock * 0.45 * sparkle.y + position.y;
		float sparkleLife = fract( sparkleCycle );
		float sparkleR = sparkleMax - ( sparkleMax - sparkleMin ) * sparkleLife;
		float sparkleA = position.x + 7.5 * log( ( sparkleMax + sparkleEye ) / ( sparkleR + sparkleEye ) ) + floor( sparkleCycle ) * 2.39996;
		sparkleWorld = vec3( cos( sparkleA ) * sparkleR, sin( sparkleA ) * sparkleR, position.z * reach * 0.35 * ( 0.2 + 0.8 * sparkleR / reach ) );
		sparkleFade = smoothstep( 0.0, 0.1, sparkleLife ) * smoothstep( 1.0, 0.8, sparkleLife );`,
	lightning: `
		float sparkleEpoch = floor( sparkleClock * 8.0 );
		float sparkleK = mod( sparkleEpoch, 509.0 ) * 7.31 + position.z * 101.7;
		vec3 sparkleA = sparkleDir( sparkleK + 1.0 ) * reach * 0.92;
		vec3 sparkleB = normalize( - sparkleA / ( reach * 0.92 ) + sparkleDir( sparkleK + 2.0 ) * 0.7 ) * reach * 0.92;
		float sparkleOn = driftTime == 0.0 ? 1.0 : step( sparkleHash( sparkleK * 0.37 ), 0.75 );
		float sparkleFlicker = 0.55 + 0.45 * sparkleHash( mod( floor( sparkleClock * 40.0 ), 997.0 ) + sparkleK );
		if ( position.y < - 0.5 ) {
			float sparkleBeat = sparkleClock * 2.5;
			float sparkleFlash = step( sparkleHash( mod( floor( sparkleBeat ), 509.0 ) * 3.3 + position.z * 11.0 ), 0.2 ) * exp( - fract( sparkleBeat ) * 5.0 );
			sparkleWorld = vec3( 0.0 );
			sparkleFade = sparkleOn * ( 0.1 + 0.6 * sparkleFlash ) * sparkleFlicker;
			sparkleSize = 0.3 + 0.7 * sparkleFlash;
		} else if ( position.y < 0.5 ) {
			sparkleWorld = sparkleBolt( sparkleA, sparkleB, position.x, sparkleK, 0.22 );
			sparkleFade = sparkleOn * sparkleFlicker;
		} else {
			float sparkleJ = position.y;
			float sparkleFrom = 0.2 + 0.6 * sparkleHash( sparkleK + sparkleJ * 3.1 );
			vec3 sparkleP = sparkleBolt( sparkleA, sparkleB, sparkleFrom, sparkleK, 0.22 );
			vec3 sparkleTo = normalize( sparkleDir( sparkleK + sparkleJ * 5.3 ) + normalize( sparkleB - sparkleA ) * 0.5 );
			vec3 sparkleE = sparkleP + sparkleTo * reach * 0.7 * ( 0.5 + 0.5 * sparkleHash( sparkleK + sparkleJ * 1.7 ) );
			sparkleWorld = sparkleBolt( sparkleP, sparkleE, position.x, sparkleK + sparkleJ * 13.0, 0.28 );
			sparkleFade = sparkleOn * sparkleFlicker * step( sparkleHash( sparkleK + sparkleJ * 9.7 ), 0.7 ) * ( 1.0 - 0.6 * position.x );
		}
		float sparkleLength = length( sparkleWorld );
		if ( sparkleLength > reach ) sparkleWorld *= reach / sparkleLength;`,
}

// Lightning's midpoint displacement: the point `s` (0 to 1) along a bolt from a to b, offset across it by five
// octaves of random knots pinned to zero at both ends, each half the last; and the hashes it draws from.
const BOLT = `
	float sparkleHash( float n ) { return fract( sin( n * 12.9898 ) * 43758.5453 ); }
	vec3 sparkleDir( float n ) {
		return normalize( vec3( sparkleHash( n ), sparkleHash( n + 0.37 ), sparkleHash( n + 0.71 ) ) * 2.0 - 1.0 + vec3( 0.001 ) );
	}
	vec3 sparkleBolt( vec3 a, vec3 b, float s, float k, float amp ) {
		vec3 d = b - a;
		float len = max( length( d ), 0.0001 );
		vec3 t = d / len;
		vec3 p1 = normalize( cross( t, abs( t.z ) < 0.9 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );
		vec3 p2 = cross( t, p1 );
		vec2 off = vec2( 0.0 );
		float size = amp * len;
		for ( int o = 0; o < 5; o ++ ) {
			float n = exp2( float( o ) + 1.0 );
			float x = s * n;
			float i = floor( x );
			float f = x - i;
			float seed = k + float( o ) * 37.0;
			vec2 h0 = i < 0.5 ? vec2( 0.0 ) : vec2( sparkleHash( seed + i ), sparkleHash( seed + i + 19.1 ) ) * 2.0 - 1.0;
			vec2 h1 = i + 1.0 > n - 0.5 ? vec2( 0.0 ) : vec2( sparkleHash( seed + i + 1.0 ), sparkleHash( seed + i + 20.1 ) ) * 2.0 - 1.0;
			off += mix( h0, h1, f ) * size;
			size *= 0.5;
		}
		return a + d * s + p1 * off.x + p2 * off.y;
	}`

// One material per theme and style: additive soft dots in the sparkle colour, moving on the shared `time`
// uniform (seconds) times `speed`. Premultiplied, so over the glass the canvas's alpha grows with the light added.
export function innerMaterial({ map, color, style, time, speed = 1, pixel = false }) {
	const mat = new THREE.PointsMaterial({
		map, color: new THREE.Color(color), size: pixel ? 1.6 : 1, sizeAttenuation: true, transparent: true,
		depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, opacity: style == 'galaxy' ? 0.75 : style == 'lightning' ? 1 : 0.9,
	})
	const styleIndex = STYLE[style] ?? 0
	const motion = styleIndex == 0 ? MOTION.drift(true) : styleIndex == 2 ? MOTION.drift(false) : MOTION[style]
	const world = styleIndex >= 3
	mat.onBeforeCompile = shader => {
		shader.uniforms.driftTime = time
		shader.uniforms.innerSpeed = { value: speed }
		shader.vertexShader = shader.vertexShader
			.replace('void main() {', `attribute vec4 sparkle;
				attribute float reach;
				uniform float driftTime;
				uniform float innerSpeed;
				varying float vSparkleFade;
				${styleIndex == 5 ? BOLT : ''}
				void main() {`)
			.replace('#include <begin_vertex>', `
				vec3 transformed = position;
				float sparkleClock = driftTime * innerSpeed;
				float sparkleT = sparkleClock * sparkle.y + sparkle.x;
				float sparkleFade = 1.0;
				float sparkleSize = 1.0;
				vec3 sparkleWorld = vec3( 0.0 );
				${motion}
				${world ? `transformed = transpose( mat3( modelMatrix ) ) * sparkleWorld / max( dot( modelMatrix[ 0 ].xyz, modelMatrix[ 0 ].xyz ), 0.0001 );` : ''}
				vSparkleFade = sparkleFade${styleIndex == 5 ? '' : ' * ( 0.65 + 0.35 * sin( sparkleClock * 3.0 + sparkle.w * 40.0 ) )'};`)
			// a sprite faded out draws nothing, so a bolt between strikes costs no fill
			.replace('gl_PointSize = size;', 'gl_PointSize = vSparkleFade < 0.004 ? 0.0 : size * sparkle.z * sparkleSize;')
		shader.fragmentShader = shader.fragmentShader
			.replace('void main() {', 'varying float vSparkleFade;\nvoid main() {')
			.replace('#include <alphatest_fragment>', 'diffuseColor.a *= vSparkleFade;\n#include <alphatest_fragment>')
	}
	mat.customProgramCacheKey = () => `inner|${style}`
	return mat
}
