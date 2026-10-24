import * as THREE from "three"
import { radialDot } from "./helpers.js"

// Inner sparkles: a cloud of soft point sprites inside a glass die (`inner` on the colorset: snow, galaxy
// or embers, in `inner_color` or the accent). The cloud is a THREE.Points child of the die, sampled inside
// its physics hull shrunk towards the middle, so it turns with the die and never pokes out of its faces.
// The drift is in the vertex shader from one shared time uniform: snow sinks and embers rise along the
// world's up, as seen from inside the tumbling die, fading out at the end of their run and in again at
// the start; a galaxy turns about the die's own axis, faster near the middle. Every sprite twinkles a
// little. Nothing moves on the CPU, and under prefers-reduced-motion the time stays still.

export const INNER_STYLES = ['snow', 'galaxy', 'embers']
// Sprites per die by device.
export const INNER_BUDGETS = { desktop: 260, tablet: 180, phone: 110 }
// How far inside the hull the cloud stays (a share of each face's distance from the middle), and how far
// a drifting sprite may stray from its place (a share of what is left).
const SHRINK = 0.78
const STRAY = 0.4
const STYLE = { snow: 0, galaxy: 1, embers: 2 }

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
// turning never carries a sprite out; the others fill the shrunk hull.
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
	for (let i = 0; i < count; i++) {
		let x, y, z
		if (galaxy) {
			const r = ball * Math.sqrt(next()) * (0.15 + 0.85 * next() ** 0.3), a = next() * Math.PI * 2
			x = Math.cos(a) * r
			y = Math.sin(a) * r
			z = (next() - 0.5) * ball * 0.5 * (1 - r / ball) ** 0.5
		} else {
			do {
				x = (next() * 2 - 1) * radius
				y = (next() * 2 - 1) * radius
				z = (next() * 2 - 1) * radius
			} while (!inside(x, y, z))
		}
		positions.set([x, y, z], i * 3)
		const distance = Math.hypot(x, y)
		const speed = galaxy ? (0.12 + 0.3 * (1 - distance / Math.max(ball, 1e-6))) : style == 'snow' ? 0.08 + 0.08 * next() : 0.12 + 0.12 * next()
		const size = radius * (galaxy ? 0.2 + 0.3 * next() ** 2 : style == 'snow' ? 0.26 + 0.3 * next() : 0.18 + 0.24 * next())
		sparkle.set([next() * 6.2832, speed, size, next()], i * 4)
		reach[i] = margin * STRAY
	}
	const cloud = new THREE.BufferGeometry()
	cloud.setAttribute('position', new THREE.BufferAttribute(positions, 3))
	cloud.setAttribute('sparkle', new THREE.BufferAttribute(sparkle, 4))
	cloud.setAttribute('reach', new THREE.BufferAttribute(reach, 1))
	cloud.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius)
	return cloud
}

// One material per theme and style: additive soft dots in the sparkle colour, drifting on the shared
// `time` uniform (seconds). Premultiplied, so over the glass the canvas's alpha grows with the light added.
export function innerMaterial({ map, color, style, time, pixel = false }) {
	const mat = new THREE.PointsMaterial({
		map, color: new THREE.Color(color), size: pixel ? 1.6 : 1, sizeAttenuation: true, transparent: true,
		depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true, opacity: style == 'galaxy' ? 0.75 : 0.9,
	})
	const styleIndex = STYLE[style] ?? 0
	mat.onBeforeCompile = shader => {
		shader.uniforms.driftTime = time
		shader.vertexShader = shader.vertexShader
			.replace('void main() {', `attribute vec4 sparkle;
				attribute float reach;
				uniform float driftTime;
				varying float vSparkleFade;
				void main() {`)
			.replace('#include <begin_vertex>', `
				vec3 transformed = position;
				float sparkleT = driftTime * sparkle.y + sparkle.x;
				float sparkleFade = 1.0;
				#if ${styleIndex} == 1
					float sparkleC = cos( sparkleT ), sparkleS = sin( sparkleT );
					transformed.xy = vec2( sparkleC * position.x - sparkleS * position.y, sparkleS * position.x + sparkleC * position.y );
				#else
					vec3 sparkleUp = normalize( transpose( mat3( modelMatrix ) ) * vec3( 0.0, 0.0, 1.0 ) );
					float sparkleRun = fract( sparkleT );
					vec3 sparkleSway = vec3( sin( sparkleT * 2.7 + sparkle.w * 6.0 ), cos( sparkleT * 2.1 + sparkle.w * 9.0 ), 0.0 ) * 0.3;
					transformed += ( sparkleUp * ( ( sparkleRun - 0.5 ) * ${styleIndex == 0 ? '-1.4' : '1.4'} ) + sparkleSway ) * reach;
					sparkleFade = sin( sparkleRun * 3.14159 );
				#endif
				vSparkleFade = sparkleFade * ( 0.65 + 0.35 * sin( driftTime * 3.0 + sparkle.w * 40.0 ) );`)
			.replace('gl_PointSize = size;', 'gl_PointSize = size * sparkle.z;')
		shader.fragmentShader = shader.fragmentShader
			.replace('void main() {', 'varying float vSparkleFade;\nvoid main() {')
			.replace('#include <alphatest_fragment>', 'diffuseColor.a *= vSparkleFade;\n#include <alphatest_fragment>')
	}
	mat.customProgramCacheKey = () => `inner|${style}`
	return mat
}
