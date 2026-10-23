import * as THREE from "three"
import { DICE_GEOM } from "./const/dice"

// Each polyhedron's label layout (`tab` and `af` place its face's corners on the label's circle) and
// its classic chamfer: faces shrunk to this share of their size about their centres, flat bevels between.
export const GEOM_PARAMS = {
	d4: { tab: -0.1, af: Math.PI * 7 / 6, chamfer: 0.96 },
	d6: { tab: 0.1, af: Math.PI / 4, chamfer: 0.96 },
	d8: { tab: 0, af: -Math.PI / 4 / 2, chamfer: 0.965 },
	d10: { tab: 0.3, af: Math.PI, chamfer: 0.945 },
	d12: { tab: 0.2, af: -Math.PI / 4 / 2, chamfer: 0.968 },
	d20: { tab: -0.2, af: -Math.PI / 4 / 2, chamfer: 0.955 },
}

// edges 0 to 1: from a hairline rim (`sharp`, a share of each face) to worn (a rounding radius of
// `worn` die radii, so every die type looks as worn), at most `most` of the face.
const BEVEL = { sharp: 0.006, worn: 0.14, most: 0.3 }
// A rounder rim takes room from the face, so the label is drawn a little larger than the face shrinks:
// at LABEL_KEEP 0.4 a face at 80% of its classic size keeps 91% of its number's size. Not on a d4,
// whose numbers sit in the corners.
const LABEL_KEEP = 0.4
// Arc segments: one per ARC_STEP of the angle between two faces, fewer on small rims.
const ARC_STEP = Math.PI / 12
// dish 0 to 1: which dice get concave faces, how far across the face the dish reaches (the rest is a
// flat rim the die rests on), its depth at 1 as a share of the face's inradius, how round it is (2 is a
// circle on a square face) and the grid it is drawn on (levels per side of each face triangle).
export const DISH_TYPES = ["d6", "d8", "d12", "d20"]
const DISH = { extent: 0.84, depth: 0.22, power: 2, levels: { d6: 16, d8: 14, d12: 9, d20: 11 } }

const clamp01 = x => Math.max(0, Math.min(1, x))
const step = x => Math.round(clamp01(x) * 100) / 100
const given = x => x !== undefined && x !== null && x !== "" && Number.isFinite(Number(x))

// { edges, dish } as the factory caches it, or null for the classic die. edges left out keeps the
// classic flat chamfer; dish 0 keeps faces flat.
export function shapeOf(shape) {
	if (!shape || typeof shape !== "object") return null
	const edges = given(shape.edges) ? step(Number(shape.edges)) : null
	const dish = given(shape.dish) ? step(Number(shape.dish)) : 0
	if (edges === null && dish === 0) return null
	return { edges, dish }
}

export const shapeKey = shape => `${shape.edges ?? "classic"}|${shape.dish}`

// The rendered mesh of a die with rounded or sharp edges and dished faces. The physics shape stays the
// plain polyhedron, which every face's flat rim still lies on, so a shaped die tumbles, rests and reads
// its face like a classic one. Faces keep the classic label layout (the same corners on the label's
// circle), so numbers sit where they always do and follow a dish down into it.
//
// Rounding is the polyhedron shrunk by the rim's size and swept by a ball (a Minkowski sum): each face
// is its classic chamfered face, each edge a strip of arcs from one face's direction to the other's, and
// each corner a patch of the directions between them, all with smooth normals. Without rounding (edges
// left out) the bevels and corners are the classic flat ones. A dish lowers each face's middle along
// its normal, with normals from the slope.
//
// Triangles of a face share one group (one draw call), and every die's bevels and corners another.
// Dice are drawn without depth testing, so the dish groups come first: where a face's own rim hides
// part of its dish at a grazing angle, the rim draws over it. `faceNormals` and `facePoints` give each
// group's face plane for reading the face that is up.
export function buildShaped(diceShape, radius, shape) {
	const { vertices, faces } = DICE_GEOM[diceShape]
	const params = GEOM_PARAMS[diceShape]
	const rounded = shape.edges !== null
	const dish = DISH_TYPES.includes(diceShape) ? shape.dish : 0

	const corners = vertices.map(v => new THREE.Vector3().fromArray(v).normalize().multiplyScalar(radius))
	const inradius = Math.abs(newell(faces[0].slice(0, -1).map(i => corners[i])).dot(corners[faces[0][0]])) / radius
	const c = rounded ? 1 - Math.min(BEVEL.most, BEVEL.sharp + (BEVEL.worn / inradius - BEVEL.sharp) * shape.edges) : params.chamfer
	const labelScale = diceShape == "d4" ? 1 : Math.pow(c / params.chamfer, 1 - LABEL_KEEP)
	const polys = faces.map(face => {
		const ids = face.slice(0, -1)
		const center = ids.reduce((sum, i) => sum.add(corners[i]), new THREE.Vector3()).divideScalar(ids.length)
		const normal = newell(ids.map(i => corners[i]))
		if (normal.dot(center) < 0) normal.negate()
		const offset = center.clone().multiplyScalar(1 - c)
		const points = ids.map(i => corners[i].clone().multiplyScalar(c).add(offset))
		return { ids, label: face[face.length - 1], center, normal, offset, points, uvs: faceUVs(diceShape, ids.length, params, labelScale) }
	})

	const segments = rounded ? arcSegments(polys, (1 - c) * polys[0].center.length() / radius) : 1
	const dished = [], flat = [], edge = []
	for (const poly of polys) {
		const part = dish > 0 ? dishFace(poly, dish, DISH.levels[diceShape]) : flatFace(poly)
		if (part.dish.length) dished.push({ poly, tris: part.dish })
		flat.push({ poly, tris: part.flat })
	}
	for (const [a, b, i0, i1] of sharedEdges(polys)) edge.push(...strip(a, b, i0, i1, corners, c, segments, rounded))
	for (let v = 0; v < corners.length; v++) edge.push(...cornerPatch(v, polys, corners, c, segments, rounded))

	const geom = assemble([
		...dished.map(({ poly, tris }) => ({ tris, index: poly.label + 1, poly })),
		...flat.map(({ poly, tris }) => ({ tris, index: poly.label + 1, poly })),
		{ tris: edge, index: 0, poly: null },
	], radius)
	geom.name = "d" + faces.length
	return geom
}

function newell(points) {
	const n = new THREE.Vector3()
	for (let k = 0; k < points.length; k++) {
		const a = points[k], b = points[(k + 1) % points.length]
		n.x += (a.y - b.y) * (a.z + b.z)
		n.y += (a.z - b.z) * (a.x + b.x)
		n.z += (a.x - b.x) * (a.y + b.y)
	}
	return n.normalize()
}

// The classic layout: corner k of a face on the label's circle, or the d10's kite, scaled about the
// label's middle (under 1 draws the label larger on the face).
function faceUVs(diceShape, count, { tab, af }, scale = 1) {
	const w = 0.65, h = 0.85
	const v0 = 1 - h, v1 = 1 - (0.895 / 1.105) * h, v2 = 1
	const uvs = diceShape == "d10"
		? [[0.5 - w / 2, v1], [0.5, v0], [0.5 + w / 2, v1], [0.5, v2]]
		: Array.from({ length: count }, (_, k) => circleUV(k, count, tab, af))
	return uvs.map(uv => uv.map(x => 0.5 + (x - 0.5) * scale))
}

function circleUV(k, count, tab = 0, af = 0) {
	const a = Math.PI * 2 / count * k + af
	return [(Math.cos(a) + 1 + tab) / 2 / (1 + tab), (Math.sin(a) + 1 + tab) / 2 / (1 + tab)]
}

const vertex = (p, n, uv) => ({ p, n, uv })

function flatTri(a, b, c) {
	const n = new THREE.Vector3().subVectors(c.p, b.p).cross(new THREE.Vector3().subVectors(a.p, b.p)).normalize()
	return [vertex(a.p, n, a.uv), vertex(b.p, n, b.uv), vertex(c.p, n, c.uv)]
}

// A fan from the face's first corner, as the classic die draws it.
function flatFace({ points, uvs }) {
	const tris = []
	for (let j = 0; j < points.length - 2; j++) {
		tris.push(flatTri(...[0, j + 1, j + 2].map(k => ({ p: points[k], uv: uvs[k] }))))
	}
	return { dish: [], flat: tris }
}

// The face's fan triangles on a grid, each grid point lowered by the dish's height there. Its middle
// is where the label's middle is; its outline follows the face (a circle on a d6, a rounded triangle on
// a d20), out to DISH.extent of the way to the edges.
function dishFace(poly, dish, levels) {
	const { points, uvs, normal } = poly
	const middle = pointAtUV(points, uvs, [0.5, 0.5]) || poly.points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(points.length)
	const t1 = new THREE.Vector3().subVectors(points[0], middle).projectOnPlane(normal).normalize()
	const t2 = new THREE.Vector3().crossVectors(normal, t1)
	const flat = p => { const d = new THREE.Vector3().subVectors(p, middle); return [d.dot(t1), d.dot(t2)] }
	const sides = points.map((p, k) => {
		const [ax, ay] = flat(p), [bx, by] = flat(points[(k + 1) % points.length])
		let mx = by - ay, my = ax - bx
		const l = Math.hypot(mx, my)
		mx /= l; my /= l
		let d = ax * mx + ay * my
		if (d < 0) { mx = -mx; my = -my; d = -d }
		return [mx, my, d]
	})
	const inradius = Math.min(...sides.map(s => s[2]))
	const depth = dish * DISH.depth * inradius
	const height = (x, y) => {
		let sum = 0
		for (const [mx, my, d] of sides) {
			const g = (x * mx + y * my) / d
			if (g > 0) sum += Math.pow(g, DISH.power)
		}
		const u = Math.pow(sum, 1 / DISH.power) / DISH.extent
		return u >= 1 ? 0 : depth * Math.pow(1 - u * u, 1.5)
	}
	const eps = inradius * 1e-3
	const lower = (p, uv) => {
		const [x, y] = flat(p)
		const h = height(x, y)
		const hx = (height(x + eps, y) - height(x - eps, y)) / (2 * eps)
		const hy = (height(x, y + eps) - height(x, y - eps)) / (2 * eps)
		const n = normal.clone().addScaledVector(t1, hx).addScaledVector(t2, hy).normalize()
		return { p: p.clone().addScaledVector(normal, -h), n, uv, h }
	}
	const dished = [], rim = []
	for (let j = 0; j < points.length - 2; j++) {
		const [ka, kb, kc] = [0, j + 1, j + 2]
		const grid = []
		for (let i = 0; i <= levels; i++) {
			grid.push([])
			for (let k = 0; k <= levels - i; k++) {
				const wb = i / levels, wc = k / levels, wa = 1 - wb - wc
				const p = new THREE.Vector3().addScaledVector(points[ka], wa).addScaledVector(points[kb], wb).addScaledVector(points[kc], wc)
				const uv = [0, 1].map(e => uvs[ka][e] * wa + uvs[kb][e] * wb + uvs[kc][e] * wc)
				grid[i].push(lower(p, uv))
			}
		}
		const put = tri => (tri.some(v => v.h > 0) ? dished : rim).push(tri.map(({ p, n, uv }) => vertex(p, n, uv)))
		for (let i = 0; i < levels; i++) {
			for (let k = 0; k < levels - i; k++) {
				put([grid[i][k], grid[i + 1][k], grid[i][k + 1]])
				if (k < levels - i - 1) put([grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1]])
			}
		}
	}
	return { dish: dished, flat: rim }
}

function pointAtUV(points, uvs, [u, v]) {
	for (let j = 0; j < points.length - 2; j++) {
		const [a, b, c] = [uvs[0], uvs[j + 1], uvs[j + 2]]
		const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
		const wa = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / det
		const wb = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / det
		const wc = 1 - wa - wb
		if (wa >= -1e-6 && wb >= -1e-6 && wc >= -1e-6) {
			return new THREE.Vector3().addScaledVector(points[0], wa).addScaledVector(points[j + 1], wb).addScaledVector(points[j + 2], wc)
		}
	}
	return null
}

// Segments per arc: one per ARC_STEP of the widest angle between two faces, at most 2 on a small rim.
function arcSegments(polys, rim) {
	let widest = 0
	for (const [a, b] of sharedEdges(polys)) widest = Math.max(widest, a.normal.angleTo(b.normal))
	const segments = Math.max(1, Math.ceil(widest / ARC_STEP))
	return rim < 0.015 ? Math.min(2, segments) : segments
}

// Pairs of faces that share an edge, with the edge's two corners.
function sharedEdges(polys) {
	if (polys.edges) return polys.edges
	const edges = []
	for (let i = 0; i < polys.length - 1; i++) {
		for (let j = i + 1; j < polys.length; j++) {
			const shared = polys[i].ids.filter(id => polys[j].ids.includes(id))
			if (shared.length == 2) edges.push([polys[i], polys[j], shared[0], shared[1]])
		}
	}
	polys.edges = edges
	return edges
}

// A point of the rounded surface: the shrunk corner plus a blend of face offsets, normal along it.
function swept(base, offsets, weights) {
	const dir = new THREE.Vector3(), length = { value: 0 }
	offsets.forEach((o, k) => {
		dir.addScaledVector(o.clone().normalize(), weights[k])
		length.value += o.length() * weights[k]
	})
	dir.normalize()
	return { p: base.clone().addScaledVector(dir, length.value), n: dir }
}

// Triangles always face out (the die is convex about its centre).
function outward(tri) {
	const [a, b, c] = tri
	const n = new THREE.Vector3().subVectors(b.p, a.p).cross(new THREE.Vector3().subVectors(c.p, a.p))
	return n.dot(new THREE.Vector3().add(a.p).add(b.p).add(c.p)) < 0 ? [a, c, b] : tri
}

function strip(a, b, i0, i1, corners, c, segments, rounded) {
	const k0 = a.ids.indexOf(i0), k1 = a.ids.indexOf(i1)
	const m0 = b.ids.indexOf(i0), m1 = b.ids.indexOf(i1)
	if (!rounded) {
		const quad = [a.points[k0], b.points[m0], b.points[m1], a.points[k1]].map((p, k) => ({ p, uv: circleUV(k, 4) }))
		return [flatTri(...outward([quad[0], quad[1], quad[2]])), flatTri(...outward([quad[0], quad[2], quad[3]]))]
	}
	const base0 = corners[i0].clone().multiplyScalar(c), base1 = corners[i1].clone().multiplyScalar(c)
	const row = (base, side) => Array.from({ length: segments + 1 }, (_, s) => {
		const t = s / segments
		const { p, n } = swept(base, [a.offset, b.offset], [1 - t, t])
		return vertex(p, n, [t, side])
	})
	const r0 = row(base0, 0), r1 = row(base1, 1)
	const tris = []
	for (let s = 0; s < segments; s++) {
		tris.push(outward([r0[s], r0[s + 1], r1[s + 1]]), outward([r0[s], r1[s + 1], r1[s]]))
	}
	return tris
}

// The faces around corner v in order, then the classic flat corner, or a patch of sectors from the
// corner's middle direction to each pair of neighbouring faces.
function cornerPatch(v, polys, corners, c, segments, rounded) {
	const around = polys.filter(poly => poly.ids.includes(v))
	if (around.length < 3) return []
	const axis = corners[v].clone().normalize()
	const t1 = new THREE.Vector3().subVectors(around[0].center, corners[v]).projectOnPlane(axis).normalize()
	const t2 = new THREE.Vector3().crossVectors(axis, t1)
	const angle = poly => { const d = new THREE.Vector3().subVectors(poly.center, corners[v]).projectOnPlane(axis); return Math.atan2(d.dot(t2), d.dot(t1)) }
	around.sort((p, q) => angle(p) - angle(q))
	if (!rounded) {
		const ring = around.map((poly, k) => ({ p: poly.points[poly.ids.indexOf(v)], uv: circleUV(k, around.length) }))
		const tris = []
		for (let k = 1; k < ring.length - 1; k++) tris.push(flatTri(...outward([ring[0], ring[k], ring[k + 1]])))
		return tris
	}
	const base = corners[v].clone().multiplyScalar(c)
	const tris = []
	const n = around.length
	const middle = new THREE.Vector3()
	around.forEach(poly => middle.add(poly.offset.clone().normalize()))
	middle.normalize().multiplyScalar(around.reduce((s, poly) => s + poly.offset.length(), 0) / n)
	for (let k = 0; k < n; k++) {
		const offsets = [middle, around[k].offset, around[(k + 1) % n].offset]
		const grid = []
		for (let i = 0; i <= segments; i++) {
			grid.push([])
			for (let j = 0; j <= segments - i; j++) {
				const wa = i / segments, wb = j / segments
				const { p, n: normal } = swept(base, offsets, [1 - wa - wb, wa, wb])
				grid[i].push(vertex(p, normal, [0.5 + 0.4 * wa, 0.5 + 0.4 * wb]))
			}
		}
		for (let i = 0; i < segments; i++) {
			for (let j = 0; j < segments - i; j++) {
				tris.push(outward([grid[i][j], grid[i + 1][j], grid[i][j + 1]]))
				if (j < segments - i - 1) tris.push(outward([grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]))
			}
		}
	}
	return tris
}

// One indexed geometry: vertices welded where position, normal and UV match, one group per part.
function assemble(parts, radius) {
	const positions = [], normals = [], uvs = [], index = []
	const seen = new Map()
	const q = x => Math.round(x * 1e4)
	const pq = x => Math.round(x / radius * 1e5)
	const geom = new THREE.BufferGeometry()
	geom.faceNormals = []
	geom.facePoints = []
	for (const { tris, index: materialIndex, poly } of parts) {
		if (!tris.length) continue
		const start = index.length
		for (const tri of tris) {
			for (const { p, n, uv } of tri) {
				const key = `${pq(p.x)},${pq(p.y)},${pq(p.z)},${q(n.x)},${q(n.y)},${q(n.z)},${q(uv[0])},${q(uv[1])}`
				let id = seen.get(key)
				if (id === undefined) {
					id = positions.length / 3
					seen.set(key, id)
					positions.push(p.x, p.y, p.z)
					normals.push(n.x, n.y, n.z)
					uvs.push(uv[0], uv[1])
				}
				index.push(id)
			}
		}
		geom.addGroup(start, index.length - start, materialIndex)
		geom.faceNormals.push(poly ? poly.normal.clone() : new THREE.Vector3())
		geom.facePoints.push(poly ? poly.points[0].clone() : new THREE.Vector3())
	}
	geom.setIndex(index)
	geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
	geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
	geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
	geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius)
	return geom
}
