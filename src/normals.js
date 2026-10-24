import * as THREE from "three"

// Procedural normal maps, drawn once per box from tiling height fields and shared by every theme.
// Each relief is a DataTexture with the tangent-space normal in rgb and a roughness factor in alpha
// (1 leaves the material's roughness as it is), tiled `repeat` times across a face.
//
// Metal grain (`grain` on a metal colorset), the metal's own normal map: brushed (fine parallel
// streaks, with the roughness streaky too), hammered (overlapping shallow dents with ridges between
// them) and worn (soft dents, scratches and pits, rougher in the pits).
// Coats (`coat`), a clearcoatNormalMap over any material with a clear coat, drawn at a scale a die a couple
// of hundred pixels across can show (finer ones read as per-pixel noise): scratched (a few dozen long,
// curved scratches), flake (big soft flakes, each tilted its own way) and weave (a coarse carbon-fibre twill).
// Pebble (the leather texture's grain): rounded pebbles of a jittered cellular noise with creases between
// them, rougher in the creases; its roughness factor also tells the leather patch where they are.

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

// The tangent-space normals of a height field (0 to 1) as RGBA bytes, alpha 128 (a roughness factor of 1),
// each texel optionally tilted further by its own slope (`slopes`, x and y per texel).
function normalsOf(size, heights, strength, slopes = null) {
	const data = new Uint8Array(size * size * 4)
	const at = (x, y) => heights[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const k = y * size + x
			const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength + (slopes ? slopes[k * 2] : 0)
			const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * strength + (slopes ? slopes[k * 2 + 1] : 0)
			const l = Math.hypot(dx, dy, 1)
			const i = (y * size + x) * 4
			data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255)
			data[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255)
			data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255)
			data[i + 3] = 128
		}
	}
	return data
}

// Scratches in a clear coat, sized for a die a couple of hundred pixels across: a few dozen long, gently
// curved cuts a few texels wide (a face shows one tile), most of them along two directions, each with a
// soft rounded groove that is deepest in its middle and fades out at both ends. A groove's two walls face
// opposite ways, so a scratch shows as a bright line where one of them catches a light. Each cut is
// drawn segment by segment over only the texels near it.
function scratched(size) {
	const next = random(131)
	const main = next() * Math.PI
	const heights = new Float32Array(size * size).fill(1)
	const STEPS = 14
	for (let k = 0; k < 38; k++) {
		const x = next() * size, y = next() * size, length = (0.22 + 0.55 * next()) * size
		const angle = next() < 0.8 ? main + (next() < 0.6 ? 0 : Math.PI / 2) + (next() - 0.5) * 0.35 : next() * Math.PI
		const bend = (next() - 0.5) * 0.35 * length
		const width = 1.6 + 2.2 * next() ** 2
		const depth = 0.35 + 0.65 * next()
		const ex = x + Math.cos(angle) * length, ey = y + Math.sin(angle) * length
		const cx = (x + ex) / 2 - Math.sin(angle) * bend, cy = (y + ey) / 2 + Math.cos(angle) * bend
		const point = t => [(1 - t) ** 2 * x + 2 * (1 - t) * t * cx + t * t * ex, (1 - t) ** 2 * y + 2 * (1 - t) * t * cy + t * t * ey]
		for (let s = 0; s < STEPS; s++) {
			const t0 = s / STEPS, t1 = (s + 1) / STEPS
			const [ax, ay] = point(t0), [bx, by] = point(t1)
			const vx = bx - ax, vy = by - ay, vv = vx * vx + vy * vy || 1
			const pad = width + 1
			for (let py = Math.floor(Math.min(ay, by) - pad); py <= Math.ceil(Math.max(ay, by) + pad); py++) {
				for (let px = Math.floor(Math.min(ax, bx) - pad); px <= Math.ceil(Math.max(ax, bx) + pad); px++) {
					const u = Math.min(1, Math.max(0, ((px + 0.5 - ax) * vx + (py + 0.5 - ay) * vy) / vv))
					const d = Math.hypot(px + 0.5 - ax - vx * u, py + 0.5 - ay - vy * u) / width
					if (d >= 1) continue
					const along = t0 + (t1 - t0) * u
					const h = 1 - depth * 0.5 * (1 + Math.cos(Math.PI * d)) * Math.sin(along * Math.PI) ** 0.6
					const i = (((py % size) + size) % size) * size + (((px % size) + size) % size)
					if (h < heights[i]) heights[i] = h
				}
			}
		}
	}
	return normalsOf(size, heights, 3.2)
}

// Metallic flake, big enough to see on a die: round flakes of a few sizes scattered on a jittered grid with
// clear coat between them, each one flat facet tilted its own way with a soft rim that eases back to the
// coat's surface, so each reads as a disc that flashes when its tilt brings a light into view as the die
// turns. Written straight as normals.
function flake(size) {
	const next = random(141)
	const N = 10
	const cells = []
	for (let i = 0; i < N; i++) {
		for (let j = 0; j < N; j++) {
			const a = next() * Math.PI * 2, tilt = 0.18 + 0.3 * next(), r = next() < 0.15 ? 0 : (0.22 + 0.2 * next()) / N
			cells.push([(i + 0.3 + 0.4 * next()) / N, (j + 0.3 + 0.4 * next()) / N, Math.cos(a) * tilt, Math.sin(a) * tilt, r])
		}
	}
	const data = new Uint8Array(size * size * 4)
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const u = (x + 0.5) / size, v = (y + 0.5) / size
			const ci = Math.floor(u * N), cj = Math.floor(v * N)
			let rim = 0, tilt = null
			for (let di = -1; di <= 1; di++) {
				for (let dj = -1; dj <= 1; dj++) {
					const c = cells[(((ci + di) % N) + N) % N * N + (((cj + dj) % N) + N) % N]
					if (!c[4]) continue
					const cover = 1 - smoothstep(c[4] * 0.7, c[4], wrapped(u, v, c[0], c[1]))
					if (cover > rim) {
						rim = cover
						tilt = c
					}
				}
			}
			const tx = tilt ? tilt[2] * rim : 0, ty = tilt ? tilt[3] * rim : 0
			const l = Math.hypot(tx, ty, 1)
			const i = (y * size + x) * 4
			data[i] = Math.round((tx / l * 0.5 + 0.5) * 255)
			data[i + 1] = Math.round((ty / l * 0.5 + 0.5) * 255)
			data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255)
			data[i + 3] = 128
		}
	}
	return data
}

// A carbon-fibre 2x2 twill of round tows, coarse enough to read on a die: each tow passes over two
// crossings and under two, the next one shifted by one, so the floats step along diagonals. A tow is
// rounded across and dips where it goes under its neighbour, and the floats running one way are tilted
// one way and those running the other another, as carbon's fibres catch the light along their length:
// the two directions light up in turn as the die turns, which is what makes carbon's checker show.
function weave(size) {
	const TOWS = 8
	const TILT = 0.3
	const heights = new Float32Array(size * size)
	const slopes = new Float32Array(size * size * 2)
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const u = (x + 0.5) / size * TOWS, v = (y + 0.5) / size * TOWS
			const i = Math.floor(u), j = Math.floor(v)
			const warp = ((i + j) % 4 + 4) % 4 < 2
			const across = warp ? u - i : v - j
			// where along its two-crossing float the tow is, 0 to 2
			const start = warp ? (((j + i) % 4 + 4) % 4 == 0 ? j : j - 1) : (((j + i) % 4 + 4) % 4 == 2 ? i : i - 1)
			const along = (warp ? v : u) - start
			const round = Math.sin(Math.PI * across) ** 0.7
			const dip = 0.55 + 0.45 * Math.sin(Math.PI * along / 2)
			heights[y * size + x] = 0.15 + 0.85 * round * dip
			slopes[(y * size + x) * 2 + (warp ? 0 : 1)] = warp ? TILT : -TILT
		}
	}
	return normalsOf(size, heights, 4, slopes)
}

// Pebble grain: each cell of a wrapped Voronoi a low rounded pebble, F2 - F1 small where two meet, so
// the creases run between them. A fine noise keeps the tops from reading as plastic. Rougher in the creases.
function pebble(size) {
	const next = random(161)
	const N = 12
	const cells = []
	for (let i = 0; i < N; i++) {
		for (let j = 0; j < N; j++) cells.push([(i + 0.1 + 0.8 * next()) / N, (j + 0.1 + 0.8 * next()) / N, 0.7 + 0.3 * next()])
	}
	const fine = noise(162, 96), lumps = noise(163, 6)
	return fromHeight(size, 7, (u, v, o) => {
		const ci = Math.floor(u * N), cj = Math.floor(v * N)
		let f1 = Infinity, f2 = Infinity, lift = 1
		for (let di = -2; di <= 2; di++) {
			for (let dj = -2; dj <= 2; dj++) {
				const c = cells[(((ci + di) % N) + N) % N * N + (((cj + dj) % N) + N) % N]
				const d = wrapped(u, v, c[0], c[1])
				if (d < f1) {
					f2 = f1
					f1 = d
					lift = c[2]
				} else if (d < f2) f2 = d
			}
		}
		const crease = 1 - smoothstep(0, 0.2 / N, f2 - f1)
		const dome = Math.sqrt(smoothstep(0, 0.9 / N, f2 - f1))
		o.height = 0.3 + 0.45 * dome * lift - 0.2 * crease + 0.05 * (fine(u, v) - 0.5) + 0.08 * (lumps(u, v) - 0.5)
		o.roughness = 0.85 + 0.4 * crease + 0.08 * (fine(v, u) - 0.5)
	})
}

const RELIEFS = {
	brushed: { draw: brushed, repeat: 1.5, scale: 0.5 },
	hammered: { draw: hammered, repeat: 1.2, scale: 1 },
	worn: { draw: worn, repeat: 1, scale: 0.7 },
	scratched: { draw: scratched, repeat: 1, scale: 1 },
	flake: { draw: flake, repeat: 1.3, scale: 1 },
	weave: { draw: weave, repeat: 1.25, scale: 1 },
	pebble: { draw: pebble, repeat: 3, scale: 0.8 },
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
