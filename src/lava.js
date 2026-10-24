import * as THREE from "three"

// Lava: dark rock with molten cracks that glow and flow, after three.js's webgl_shader_lava example. Two
// tiling textures drawn in code scroll against each other across every label: a cloud of soft noise that
// warps and pulses the flow, and a field of cracks between cooled plates. Where they line up the rock is
// molten: emissive in the glow colour (the colorset's accent, or ember), white-hot where it runs hottest,
// so the cracks glow without any light. The numbers stay rock. One shared clock drives every lava die,
// kept to a span both textures tile over, so it never loses precision on a phone.

export const LAVA_GLOW = '#F2743B'
// Both textures repeat across this many seconds of the clock.
export const LAVA_PERIOD = 800 / 3

const CLOUD = 128
const TILE = 256

function random(seed) {
	return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

// Smooth value noise on an n by n lattice that tiles over the unit square.
function noise(seed, n) {
	const next = random(seed)
	const grid = Float32Array.from({ length: n * n }, next)
	return (u, v) => {
		const x = u * n, y = v * n
		const xi = Math.floor(x), yi = Math.floor(y)
		let fx = x - xi, fy = y - yi
		fx = fx * fx * (3 - 2 * fx)
		fy = fy * fy * (3 - 2 * fy)
		const x0 = ((xi % n) + n) % n, y0 = ((yi % n) + n) % n
		const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n
		const a = grid[y0 * n + x0], b = grid[y0 * n + x1], c = grid[y1 * n + x0], d = grid[y1 * n + x1]
		return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
	}
}

function fbm(n, u, v, octaves) {
	let sum = 0, amp = 0.5, total = 0, k = 1
	for (let i = 0; i < octaves; i++) {
		sum += n(u * k, v * k) * amp
		total += amp
		amp *= 0.5
		k *= 2
	}
	return sum / total
}

function texture(data, size) {
	const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
	t.wrapS = t.wrapT = THREE.RepeatWrapping
	t.minFilter = THREE.LinearMipmapLinearFilter
	t.magFilter = THREE.LinearFilter
	t.generateMipmaps = true
	t.needsUpdate = true
	return t
}

// Four soft noises, one per channel, like the example's cloud.png.
function cloud() {
	const ns = [noise(201, 4), noise(202, 4), noise(203, 4), noise(204, 8)]
	const data = new Uint8Array(CLOUD * CLOUD * 4)
	for (let y = 0; y < CLOUD; y++) {
		for (let x = 0; x < CLOUD; x++) {
			const u = (x + 0.5) / CLOUD, v = (y + 0.5) / CLOUD
			ns.forEach((n, k) => { data[(y * CLOUD + x) * 4 + k] = Math.round(fbm(n, u, v, 4) * 255) })
		}
	}
	return texture(data, CLOUD)
}

// Cracks between cooled plates: the edges of a wrapped Voronoi of a few big plates, with finer cracks
// across the plates and a few molten pools where they meet. Red is how molten a point runs (0 to 1).
function cracks() {
	const next = random(211)
	const plates = (n) => Array.from({ length: n * n }, (_, i) => [((i % n) + 0.1 + 0.8 * next()) / n, (Math.floor(i / n) + 0.1 + 0.8 * next()) / n])
	const big = plates(5), fine = plates(11)
	const wobble = noise(212, 16), width = noise(213, 6), pools = noise(214, 5)
	const edge = (points, n, u, v) => {
		const ci = Math.floor(u * n), cj = Math.floor(v * n)
		let f1 = Infinity, f2 = Infinity
		for (let di = -2; di <= 2; di++) {
			for (let dj = -2; dj <= 2; dj++) {
				const i = ci + di, j = cj + dj
				const p = points[(((j % n) + n) % n) * n + (((i % n) + n) % n)]
				const d = Math.hypot(p[0] + Math.floor(i / n) - u, p[1] + Math.floor(j / n) - v)
				if (d < f1) { f2 = f1; f1 = d } else if (d < f2) f2 = d
			}
		}
		return f2 - f1
	}
	const data = new Uint8Array(TILE * TILE * 4)
	for (let y = 0; y < TILE; y++) {
		for (let x = 0; x < TILE; x++) {
			const u = (x + 0.5) / TILE, v = (y + 0.5) / TILE
			const wu = u + 0.025 * (wobble(u, v) - 0.5), wv = v + 0.025 * (wobble(u + 0.5, v + 0.5) - 0.5)
			const w = 0.012 + 0.03 * width(u, v)
			const main = 1 - smoothstep(0, w, edge(big, 5, wu, wv))
			const thin = (1 - smoothstep(0, w * 0.45, edge(fine, 11, wu, wv))) * 0.55 * smoothstep(0.35, 0.7, width(u + 0.3, v))
			const pool = smoothstep(0.62, 0.8, fbm(pools, u, v, 3))
			const hot = Math.min(1, Math.max(main, thin, pool * 0.9) + 0.06 * fbm(wobble, u, v, 2))
			const i = (y * TILE + x) * 4
			data[i] = Math.round(hot * 255)
			data[i + 1] = data[i + 2] = data[i]
			data[i + 3] = 255
		}
	}
	return texture(data, TILE)
}

const smoothstep = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
}

export function lavaTextures() {
	return { cloud: cloud(), cracks: cracks() }
}

// The material patch. uniforms: { cloud, cracks, time, color, strength }. The flow follows the label's UV,
// so each face runs its own way, and the rock darkens where it melts.
export function lavaShader(shader, uniforms) {
	shader.uniforms.lavaCloud = uniforms.cloud
	shader.uniforms.lavaCracks = uniforms.cracks
	shader.uniforms.lavaTime = uniforms.time
	shader.uniforms.lavaColor = uniforms.color
	shader.uniforms.lavaStrength = uniforms.strength
	shader.fragmentShader = shader.fragmentShader
		.replace('void main() {', `uniform sampler2D lavaCloud;
			uniform sampler2D lavaCracks;
			uniform float lavaTime;
			uniform vec3 lavaColor;
			uniform float lavaStrength;
			void main() {`)
		.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
			{
				vec2 lavaUv = vMapUv;
				vec4 lavaNoise = texture2D( lavaCloud, lavaUv );
				vec2 lavaT1 = lavaUv + vec2( 1.5, - 1.5 ) * lavaTime * 0.02 + lavaNoise.xy * 2.0;
				vec2 lavaT2 = lavaUv + vec2( - 0.5, 2.0 ) * lavaTime * 0.01 + vec2( - lavaNoise.y, lavaNoise.z ) * 0.2;
				float lavaPulse = texture2D( lavaCloud, lavaT1 ).a;
				float lavaHeat = texture2D( lavaCracks, lavaT2 * 0.75 ).r;
				float lavaMolten = max( lavaHeat * lavaPulse * 2.0 + lavaHeat * lavaHeat - 0.3, 0.0 );
				float lavaRock = 1.0;
				#ifdef USE_BUMPMAP
					lavaRock = smoothstep( 0.12, 0.4, texture2D( bumpMap, vBumpMapUv ).r );
				#elif defined( USE_METALNESSMAP )
					lavaRock = smoothstep( 0.12, 0.4, texture2D( metalnessMap, vMetalnessMapUv ).r );
				#endif
				lavaMolten *= lavaRock;
				vec3 lavaGlow = lavaColor * lavaMolten + mix( lavaColor, vec3( 1.0, 0.95, 0.75 ), 0.6 ) * max( lavaMolten - 1.0, 0.0 );
				diffuseColor.rgb *= 1.0 - 0.85 * saturate( lavaMolten );
				#ifdef LAVA_DIM
					lavaGlow *= 0.3;
				#endif
				totalEmissiveRadiance += lavaGlow * lavaStrength;
			}`)
}
