import * as THREE from "three"

// Procedural normal maps, drawn once per box from tiling height fields and shared by every theme.
// Each relief is a DataTexture with the tangent-space normal in rgb and a roughness factor in alpha
// (1 leaves the material's roughness as it is), tiled `repeat` times across a face.
//
// Metal grain (`grain` on a metal colorset), the metal's own normal map: brushed (fine parallel
// streaks, with the roughness streaky too), hammered (overlapping shallow dents with ridges between
// them) and worn (soft dents, scratches and pits, rougher in the pits).
// Coats (`coat`), a clearcoatNormalMap over any material with a clear coat: scratched (fine hairline
// scratches), flake (metallic flake, tiny facets each tilted its own way) and weave (a carbon-fibre
// weave of round tows).

const SIZE = 256

export const GRAINS = ['brushed', 'hammered', 'worn']
export const COATS = ['scratched', 'flake', 'weave']

function random(seed) {
	return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

const smoothstep = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
}

// Smooth value noise on an nx by ny lattice that tiles over the unit square: (u, v) in 0 to 1 wraps.
function noise(seed, nx, ny = nx) {
	const next = random(seed)
	const grid = Float32Array.from({ length: nx * ny }, next)
	return (u, v) => {
		const x = u * nx, y = v * ny
		const xi = Math.floor(x), yi = Math.floor(y)
		let fx = x - xi, fy = y - yi
		fx = fx * fx * (3 - 2 * fx)
		fy = fy * fy * (3 - 2 * fy)
		const x0 = ((xi % nx) + nx) % nx, y0 = ((yi % ny) + ny) % ny
		const x1 = (x0 + 1) % nx, y1 = (y0 + 1) % ny
		const a = grid[y0 * nx + x0], b = grid[y0 * nx + x1], c = grid[y1 * nx + x0], d = grid[y1 * nx + x1]
		return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
	}
}

// Octaves of a tiling noise: doubling the frequency keeps the tile.
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

// Wrapped distance between two points of the unit square.
function wrapped(ax, ay, bx, by) {
	let dx = Math.abs(ax - bx), dy = Math.abs(ay - by)
	if (dx > 0.5) dx = 1 - dx
	if (dy > 0.5) dy = 1 - dy
	return Math.hypot(dx, dy)
}

// Shortest wrapped distance from a point to a segment, and where along it (0 to 1).
function toSegment(px, py, ax, ay, bx, by) {
	let best = Infinity, at = 0
	for (let ox = -1; ox <= 1; ox++) {
		for (let oy = -1; oy <= 1; oy++) {
			const x = px + ox, y = py + oy
			const vx = bx - ax, vy = by - ay
			const t = Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)))
			const d = Math.hypot(x - ax - vx * t, y - ay - vy * t)
			if (d < best) {
				best = d
				at = t
			}
		}
	}
	return [best, at]
}

// A height field (0 to 1) and roughness factor over the tile, as a normal map: slopes from central
// differences, `strength` the relief's height in texels of a texel-wide step.
function fromHeight(size, strength, field) {
	const heights = new Float32Array(size * size)
	const rough = new Float32Array(size * size)
	const out = { height: 0.5, roughness: 1 }
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			out.height = 0.5
			out.roughness = 1
			field((x + 0.5) / size, (y + 0.5) / size, out)
			heights[y * size + x] = out.height
			rough[y * size + x] = out.roughness
		}
	}
	const data = new Uint8Array(size * size * 4)
	const at = (x, y) => heights[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength
			const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * strength
			const l = Math.hypot(dx, dy, 1)
			const i = (y * size + x) * 4
			data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255)
			data[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255)
			data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255)
			data[i + 3] = Math.round(Math.min(1, Math.max(0, rough[y * size + x] / 2)) * 255)
		}
	}
	return data
}

// Fine parallel streaks: long along u, fine across v, with the roughness streaky too.
function brushed(size) {
	const long = noise(101, 2, 256), fine = noise(102, 4, 512), bands = noise(103, 1, 48)
	return fromHeight(size, 6, (u, v, o) => {
		o.height = 0.5 + 0.3 * (fbm(long, u, v, 2) - 0.5) + 0.2 * (fine(u, v) - 0.5)
		o.roughness = 0.8 + 0.45 * bands(u, v) + 0.2 * (fine(u + 0.5, v) - 0.5)
	})
}

// Overlapping shallow dents on a jittered grid: each a spherical dish, the deepest one wins, so
// ridges run where dents meet.
function hammered(size) {
	const next = random(111)
	const N = 7
	const dents = []
	for (let i = 0; i < N; i++) {
		for (let j = 0; j < N; j++) dents.push([(i + 0.15 + 0.7 * next()) / N, (j + 0.15 + 0.7 * next()) / N, (0.6 + 0.5 * next()) / N, 0.5 + 0.5 * next()])
	}
	const grit = noise(112, 128)
	return fromHeight(size, 10, (u, v, o) => {
		let deepest = 0
		for (const [cx, cy, r, depth] of dents) {
			const d = wrapped(u, v, cx, cy)
			if (d < r) deepest = Math.max(deepest, depth * (1 - (d / r) ** 2))
		}
		o.height = 1 - 0.6 * deepest + 0.02 * (grit(u, v) - 0.5)
		o.roughness = 0.95 + 0.1 * deepest
	})
}

// Soft dents, a handful of scratches and small pits: a metal that has been handled, rougher where it
// is pitted and scratched and smoother on the high spots.
function worn(size) {
	const next = random(121)
	const bumps = noise(122, 8), fine = noise(123, 64)
	const scratches = Array.from({ length: 28 }, () => {
		const x = next(), y = next(), a = next() * Math.PI, l = 0.1 + 0.3 * next()
		return [x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.3 + 0.7 * next()]
	})
	const pits = Array.from({ length: 60 }, () => [next(), next(), (0.5 + next()) / size * 3, 0.4 + 0.6 * next()])
	return fromHeight(size, 7, (u, v, o) => {
		let h = 0.5 + 0.25 * (fbm(bumps, u, v, 3) - 0.5) + 0.04 * (fine(u, v) - 0.5)
		let rough = 0.85 + 0.3 * fbm(bumps, u + 0.5, v + 0.5, 2)
		for (const [ax, ay, bx, by, depth] of scratches) {
			const [d] = toSegment(u, v, ax, ay, bx, by)
			const cut = depth * (1 - smoothstep(0, 1.6 / size, d))
			h -= 0.12 * cut
			rough += 0.5 * cut
		}
		for (const [cx, cy, r, depth] of pits) {
			const d = wrapped(u, v, cx, cy)
			if (d < r) {
				h -= 0.2 * depth * (1 - (d / r) ** 2)
				rough += 0.6 * depth
			}
		}
		o.height = h
		o.roughness = rough
	})
}

// Hairline scratches in a clear coat: many short, thin cuts, most of them along two directions, a few
// anywhere, each with a crisp V profile.
function scratched(size) {
	const next = random(131)
	const main = next() * Math.PI
	const cuts = Array.from({ length: 220 }, () => {
		const x = next(), y = next(), l = 0.04 + 0.22 * next()
		const a = next() < 0.75 ? main + (next() < 0.5 ? 0 : Math.PI / 2) + (next() - 0.5) * 0.5 : next() * Math.PI
		return [x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.25 + 0.75 * next(), (0.6 + 0.9 * next()) / size]
	})
	return fromHeight(size, 9, (u, v, o) => {
		let h = 1
		for (const [ax, ay, bx, by, depth, width] of cuts) {
			const [d, at] = toSegment(u, v, ax, ay, bx, by)
			if (d < width * 2) h -= depth * (1 - smoothstep(0, width, d)) * Math.sin(at * Math.PI) ** 0.5 * 0.5
		}
		o.height = h
	})
}

// Metallic flake: jittered cells, each one flat facet tilted its own way, so the coat glints in
// scattered points as the light moves. Written straight as normals.
function flake(size) {
	const next = random(141)
	const N = 26
	const cells = []
	for (let i = 0; i < N; i++) {
		for (let j = 0; j < N; j++) cells.push([(i + 0.1 + 0.8 * next()) / N, (j + 0.1 + 0.8 * next()) / N, (next() - 0.5) * 0.8, (next() - 0.5) * 0.8])
	}
	const data = new Uint8Array(size * size * 4)
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const u = (x + 0.5) / size, v = (y + 0.5) / size
			const ci = Math.floor(u * N), cj = Math.floor(v * N)
			let best = Infinity, tilt = null
			for (let di = -1; di <= 1; di++) {
				for (let dj = -1; dj <= 1; dj++) {
					const c = cells[(((ci + di) % N) + N) % N * N + (((cj + dj) % N) + N) % N]
					const d = wrapped(u, v, c[0], c[1])
					if (d < best) {
						best = d
						tilt = c
					}
				}
			}
			const l = Math.hypot(tilt[2], tilt[3], 1)
			const i = (y * size + x) * 4
			data[i] = Math.round((tilt[2] / l * 0.5 + 0.5) * 255)
			data[i + 1] = Math.round((tilt[3] / l * 0.5 + 0.5) * 255)
			data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255)
			data[i + 3] = 128
		}
	}
	return data
}

// A plain weave of round tows, alternating along and across, with fine fibres along each tow.
function weave(size) {
	const fibres = noise(151, 512, 8)
	const TOWS = 4
	return fromHeight(size, 5, (u, v, o) => {
		const i = Math.floor(u * TOWS), j = Math.floor(v * TOWS)
		const fx = u * TOWS - i, fy = v * TOWS - j
		const along = (i + j) % 2 == 0
		const across = along ? fy : fx
		const edge = Math.max(0, 1 - (2 * across - 1) ** 2)
		const fibre = along ? fibres(u, v) : fibres(v, u)
		o.height = 0.2 + 0.7 * Math.sqrt(edge) + 0.08 * (fibre - 0.5) * edge
	})
}

const RELIEFS = {
	brushed: { draw: brushed, repeat: 1.5, scale: 0.5 },
	hammered: { draw: hammered, repeat: 1.2, scale: 1 },
	worn: { draw: worn, repeat: 1, scale: 0.7 },
	scratched: { draw: scratched, repeat: 1.5, scale: 1 },
	flake: { draw: flake, repeat: 4, scale: 1.2 },
	weave: { draw: weave, repeat: 10, scale: 0.6 },
}

// A relief's texture, tiled `repeat` times across a face, with the normal scale that suits it.
export function makeRelief(name, size = SIZE) {
	const relief = RELIEFS[name]
	if (!relief) return null
	const texture = new THREE.DataTexture(relief.draw(size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping
	texture.repeat.set(relief.repeat, relief.repeat)
	texture.minFilter = THREE.LinearMipmapLinearFilter
	texture.magFilter = THREE.LinearFilter
	texture.generateMipmaps = true
	texture.needsUpdate = true
	return { texture, scale: relief.scale }
}
