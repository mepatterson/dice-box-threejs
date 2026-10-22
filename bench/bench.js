// Page side of the bench. bench/run.mjs loads this page with ?bundle=<url> and drives it.

const VALUES = {
	d4: range(1, 4),
	d6: range(1, 6),
	d8: range(1, 8),
	d10: range(1, 10),
	d12: range(1, 12),
	d20: range(1, 20),
	d100: range(10, 100, 10),
}
const TYPES = Object.keys(VALUES)

export const APP_CONFIG = {
	theme_customColorset: { name: "ember-glass", foreground: "#F2743B", background: "#3A2418", outline: "#1A0E07", texture: "none" },
	theme_material: "glass",
	sounds: false,
	shadows: true,
	strength: 1.6,
	baseScale: 140,
}

function range(min, max, step = 1) {
	const out = []
	for (let v = min; v <= max; v += step) out.push(v)
	return out
}

function mulberry32(seed) {
	return function () {
		seed |= 0
		seed = (seed + 0x6d2b79f5) | 0
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const params = new URLSearchParams(location.search)
Math.random = mulberry32(Number(params.get("seed") || 1))
if (params.get("light")) document.body.classList.add("light")
if (params.get("plain")) document.querySelector("main").hidden = true

const gpu = trackTextures()
const media = trackMedia()
const { default: DiceBox } = await import(params.get("bundle"))

// Counts the bytes of every live WebGL texture (all mip levels and cube faces), so builds can be
// compared on GPU texture memory without reaching into their caches.
function trackTextures() {
	const BYTES = { 0x8058: 4, 0x8c43: 4, 0x8229: 1, 0x822b: 2, 0x881a: 8, 0x8814: 16, 0x8051: 3, 0x822d: 2, 0x822f: 4, 0x81a6: 4, 0x81a5: 2, 0x88f0: 4, 0x8cac: 4, 0x1908: 4, 0x1907: 3, 0x1909: 1, 0x1906: 1 }
	const sizes = new Map()
	const getContext = HTMLCanvasElement.prototype.getContext
	HTMLCanvasElement.prototype.getContext = function (type, ...args) {
		const gl = getContext.call(this, type, ...args)
		if (!gl || type !== "webgl2" || gl.__tracked) return gl
		gl.__tracked = true
		let unit = 0
		const bound = new Map()
		const target = t => (t >= 0x8515 && t <= 0x851a ? 0x8513 : t)
		const current = t => bound.get(`${unit}|${target(t)}`)
		const set = (tex, key, bytes) => {
			if (!tex) return
			if (!sizes.has(tex)) sizes.set(tex, new Map())
			sizes.get(tex).set(key, bytes)
		}
		const wrap = (name, fn) => {
			const original = gl[name].bind(gl)
			gl[name] = (...a) => { fn(...a); return original(...a) }
		}
		wrap("activeTexture", u => { unit = u })
		wrap("bindTexture", (t, tex) => bound.set(`${unit}|${t}`, tex))
		wrap("deleteTexture", tex => sizes.delete(tex))
		wrap("texStorage2D", (t, levels, format, w, h) => {
			let bytes = 0
			for (let l = 0; l < levels; l++) bytes += Math.max(1, w >> l) * Math.max(1, h >> l) * (BYTES[format] || 4)
			set(current(t), "storage", bytes * (t === 0x8513 ? 6 : 1))
		})
		wrap("texImage2D", (t, level, format, ...rest) => {
			let w, h
			if (rest.length >= 5) [w, h] = rest
			else { const src = rest[2]; w = src.videoWidth || src.width; h = src.videoHeight || src.height }
			set(current(t), `${t}|${level}`, w * h * (BYTES[format] || 4))
		})
		return gl
	}
	return { bytes: () => [...sizes.values()].reduce((sum, m) => sum + [...m.values()].reduce((a, b) => a + b, 0), 0), count: () => sizes.size }
}

// Counts audio elements made and played, so a build can show it loads no sound of its own.
function trackMedia() {
	const counts = { made: 0, played: 0 }
	const Original = window.Audio
	window.Audio = function (...a) { counts.made++; return new Original(...a) }
	const play = HTMLMediaElement.prototype.play
	HTMLMediaElement.prototype.play = function (...a) { counts.played++; return play.apply(this, a) }
	return counts
}

// Twelve player themes: glass, plastic, metal and wood, plain and with every procedural texture.
const THEMES = [
	{ name: "t-ember", foreground: "#F2743B", background: "#3A2418", outline: "#1A0E07", material: "glass" },
	{ name: "t-ivory", foreground: "#3B2414", background: "#E8DCC4", outline: "none", texture: "bone", font: "Georgia, serif", fontWeight: 700 },
	{ name: "t-amethyst", foreground: "#F6E7C1", background: "#4A2363", outline: "#1E0B2A", texture: "swirl", accent: "#D9B45A" },
	{ name: "t-granite", foreground: "#ffffff", background: "#5A5A5A", outline: "#000000", texture: "stone" },
	{ name: "t-black-pearl", foreground: "#ffffff", background: "#000000", outline: "#000000", accent: "#f250d4", texture: "pearl", material: "glass", glass_opacity: 0.6 },
	{ name: "t-black-opal", foreground: "#ffffff", background: "#000000", outline: "#000000", texture: "opal", material: "glass", glass_opacity: 0.6 },
	{ name: "t-obsidian", foreground: "#E8C872", background: "#0B0B0D", outline: "#000000", texture: "obsidian", accent: "#D4AF37" },
	{ name: "t-glitter", foreground: "#ffffff", background: "#5DA9E9", outline: "#0B2545", texture: "sparkles", material: "glass", glass_opacity: 0.5 },
	{ name: "t-gold", foreground: "#2B1D0E", background: "#C9A227", outline: "none", material: "metal" },
	{ name: "t-gunmetal", foreground: "#E8E8E8", background: "#3B444B", outline: "none", material: "brushedmetal", font: "'Courier New', monospace", fontWeight: 700 },
	{ name: "t-walnut", foreground: "#F3E2C7", background: "#6B4226", outline: "#2A160A", material: "wood" },
	{ name: "t-sapphire", foreground: "#ffffff", background: "#2A6FDB", outline: "#000000", material: "glass", glass_opacity: 0.6, iridescence: 0.8, glass_edges: 0.7 },
]

// A player's throw: one to three dice, mostly d20s.
const WEIGHTED = ["d20", "d20", "d20", "d20", "d20", "d6", "d6", "d8", "d4", "d10", "d12", "d100"]
function playerThrow(rand) {
	const n = 1 + Math.floor(rand() * 3)
	const dice = Array.from({ length: n }, () => pick(rand, WEIGHTED))
	const byType = {}
	dice.forEach(t => (byType[t] = byType[t] || []).push(pick(rand, VALUES[t])))
	const sets = Object.entries(byType).map(([type, values]) => ({ type, values }))
	return { notation: sets.map(s => `${s.values.length}${s.type}`).join("+") + "@" + sets.flatMap(s => s.values).join(","), wanted: sets.flatMap(s => s.values) }
}

function programsByType(box) {
	const out = {}
	for (const p of box.renderer.info.programs || []) out[p.name] = (out[p.name] || 0) + 1
	return out
}

// One throw in a theme. Builds with per-throw themes take it as an option and may run throws
// concurrently; older builds switch the box's theme first and run one throw at a time.
async function themedThrow(box, theme, notation, perThrow) {
	let result
	if (perThrow) result = await box.add(notation, { colorset: theme })
	else {
		await box.updateConfig({ theme_customColorset: theme })
		result = await box.add(notation)
	}
	return Array.isArray(result) ? result : result.sets.flatMap(s => s.rolls)
}

function checkThrow(box, req, result, rec) {
	const ids = result.map(r => r.id)
	req.wanted.forEach((v, k) => {
		if (Number(result[k]?.value) !== v) rec.failures.push({ kind: "json", wanted: v, got: result[k]?.value })
		const mesh = box.diceList[ids[k]]
		const face = mesh ? Number(mesh.getFaceValue().value) : NaN
		if (face !== v) rec.failures.push({ kind: "face", wanted: v, got: face })
	})
	rec.checks += req.wanted.length * 2
	return ids
}

function pick(rand, list) {
	return list[Math.floor(rand() * list.length)]
}

// One request: up to two distinct die types (sets with the same type would merge and reorder),
// one to four dice each, then sometimes one or two exploding add() calls.
function makeRequest(rand, i) {
	const types = [...TYPES].sort(() => rand() - 0.5).slice(0, 1 + Math.floor(rand() * 2))
	// make sure every type shows up early
	if (i < TYPES.length) types[0] = TYPES[i]
	const sets = [...new Set(types)].map(type => {
		const num = 1 + Math.floor(rand() * 4)
		return { type, values: Array.from({ length: num }, () => pick(rand, VALUES[type])) }
	})
	const notation = sets.map(s => `${s.values.length}${s.type}`).join("+") + "@" + sets.flatMap(s => s.values).join(",")
	const adds = []
	if (rand() < 0.35) {
		const n = 1 + Math.floor(rand() * 2)
		for (let k = 0; k < n; k++) {
			const type = pick(rand, ["d6", "d8", "d10", "d12", "d20", "d4"])
			adds.push({ type, value: pick(rand, VALUES[type]) })
		}
	}
	return { notation, sets, adds }
}

// How far (CSS px) the furthest die vertex pokes outside the box, using the real geometry.
function overshoot(box) {
	const w = box.container.clientWidth
	const h = box.container.clientHeight
	let worst = 0
	box.camera.updateMatrixWorld()
	for (const mesh of box.diceList) {
		if (!mesh.parent) continue
		mesh.updateMatrixWorld()
		const pos = mesh.geometry.getAttribute("position")
		const v = mesh.position.clone()
		for (let i = 0; i < pos.count; i += 3) {
			v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(box.camera)
			const x = ((v.x + 1) / 2) * w
			const y = ((1 - v.y) / 2) * h
			worst = Math.max(worst, -x, x - w, -y, y - h)
		}
	}
	return Math.max(0, worst)
}

function instrument(box) {
	const stats = { renders: [], frames: [] }
	const renderer = box.renderer
	const render = renderer.render.bind(renderer)
	renderer.render = (scene, camera) => {
		const t0 = performance.now()
		render(scene, camera)
		const dice = box.diceList.filter(m => m.parent).length
		stats.renders.push([t0, performance.now() - t0, dice, dice ? overshoot(box) : 0])
	}
	const tick = t => {
		stats.frames.push(t)
		requestAnimationFrame(tick)
	}
	requestAnimationFrame(tick)
	return stats
}

function window_(list, from, to) {
	return list.filter(t => t >= from && t <= to)
}

function avg(list) {
	return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0
}

function rendererInfo(box) {
	const info = box.renderer.info
	return { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : null }
}

function faceValues(box) {
	return box.diceList.map(mesh => Number(mesh.getFaceValue().value))
}

async function timed(box, stats, fn) {
	const t0 = performance.now()
	const result = await fn()
	const t1 = performance.now()
	const renders = stats.renders.filter(([t, , dice]) => t >= t0 && t <= t1 && dice > 0)
	const frames = window_(stats.frames, t0, t1)
	const intervals = frames.slice(1).map((t, i) => t - frames[i])
	return {
		result,
		ms: t1 - t0,
		firstRenderMs: renders.length ? renders[0][0] + renders[0][1] - t0 : null,
		renders: renders.length,
		avgRenderMs: avg(renders.map(([, d]) => d)),
		maxRenderMs: renders.length ? Math.max(...renders.map(([, d]) => d)) : 0,
		avgFrameMs: avg(intervals),
		maxOvershootPx: Math.max(0, ...renders.filter(([t]) => t > t0 + 600).map(r => r[3])),
		restOvershootPx: overshoot(box),
	}
}

// Records every throw's dice, poses and contacts as it is simulated: which dice touch the table,
// the walls or each other after each step, and how vertical each die pair's contact is.
function captureThrows(box) {
	if (box.captured) return box.captured
	const captured = box.captured = { throws: [], current: null }
	const step = box.world.step.bind(box.world)
	box.world.step = (...a) => {
		step(...a)
		const cur = captured.current
		if (!cur) return
		const desk = box.box_body.desk
		const touches = { desk: new Set(), wall: new Set(), pairs: new Map() }
		for (const c of box.world.contacts) {
			const i = cur.index.get(c.bi), j = cur.index.get(c.bj)
			if (i !== undefined && j !== undefined) {
				const key = i < j ? `${i}|${j}` : `${j}|${i}`
				touches.pairs.set(key, Math.max(touches.pairs.get(key) ?? 0, Math.abs(c.ni.z)))
			} else if (i !== undefined || j !== undefined) {
				const other = i !== undefined ? c.bj : c.bi
				;(other === desk ? touches.desk : touches.wall).add(i ?? j)
			}
		}
		cur.steps.push(touches)
	}
	const simulate = box.simulate.bind(box)
	box.simulate = (dice, ...a) => {
		const cur = { dice, index: new Map(dice.map((m, j) => [m.body, j])), steps: [{ desk: new Set(), wall: new Set(), pairs: new Map() }] }
		captured.current = cur
		try {
			const out = simulate(dice, ...a)
			cur.frames = out.frames
			captured.throws.push(cur)
			return out
		} finally { captured.current = null }
	}
	return captured
}

// What one captured throw did: where each die was early on and at rest, measured across the box
// from the wall it came in from (0) to the far wall (1), when it first touched the table, die-on-die
// contacts, and which dice rest touching or on top of another.
function throwMetrics(box, cur) {
	const dt = box.framerate
	const n = cur.dice.length
	const halfW = box.display.containerWidth * box.wallScale
	const halfH = box.display.containerHeight * box.wallScale
	const frames = cur.frames
	const at = (f, j) => frames[Math.max(0, Math.min(frames.length - 1, f))].subarray(j * 7, j * 7 + 7)
	const r = cur.dice.map(m => m.geometry.boundingSphere.radius)
	const entry = Math.sign(avg(cur.dice.map((m, j) => at(0, j)[0]))) || 1
	const across = x => (entry * halfW - x) * entry / (2 * halfW)
	const last = frames.length - 1
	const lastMove = cur.dice.map((m, j) => {
		for (let f = last; f > 0; f--) {
			const a = at(f, j), b = at(f - 1, j)
			if (a.some((v, k) => Math.abs(v - b[k]) > 1e-4)) return f
		}
		return 0
	})
	const land = cur.dice.map((m, j) => {
		const s = cur.steps.findIndex(t => t.desk.has(j))
		return s < 0 ? null : s
	})
	let early = 0, all = 0
	const lastContact = new Map()
	let prev = new Map()
	cur.steps.forEach((t, s) => {
		for (const [key, vertical] of t.pairs) {
			if (!prev.has(key)) {
				all++
				if (s * dt <= 0.3) early++
			}
			lastContact.set(key, { s, vertical })
		}
		prev = t.pairs
	})
	const touching = new Set(), stacked = new Set()
	let restingPairs = 0
	for (const [key, { s, vertical }] of lastContact) {
		const [i, j] = key.split("|").map(Number)
		if (s < Math.max(lastMove[i], lastMove[j]) - 2) continue
		restingPairs++
		touching.add(i).add(j)
		if (vertical > 0.5) stacked.add(at(last, i)[2] > at(last, j)[2] ? i : j)
	}
	const rest = cur.dice.map((m, j) => at(last, j))
	const restAcross = rest.map(p => across(p[0]))
	const nearest = rest.map((p, i) => Math.min(...rest.map((q, j) => (i === j ? Infinity : Math.hypot(p[0] - q[0], p[1] - q[1]) / r[i]))))
	const acrossAt = ms => cur.dice.map((m, j) => across(at(Math.round(ms / 1000 / dt), j)[0]))
	// dice drawn over each other from above (centers closer than 1.6 radii across the table)
	const overlapping = ms => {
		const f = Math.round(ms / 1000 / dt)
		let pairs = 0
		for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
			const a = at(f, i), b = at(f, j)
			if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.8 * (r[i] + r[j])) pairs++
		}
		return pairs
	}
	const atWall = ms => cur.dice.filter((m, j) => halfW - Math.abs(at(Math.round(ms / 1000 / dt), j)[0]) < 1.25 * r[j]).length
	// Seen from the camera straight above, once a die is in: how much bigger it looks at its highest
	// (perspective), and how far (CSS px) its bounding sphere pokes past the canvas edge.
	const camera = box.camera.position.z
	const px = box.container.clientWidth / (2 * box.display.containerWidth)
	let swell = 1, poke = 0
	cur.dice.forEach((m, j) => {
		let entered = false
		for (const f of frames) {
			const [x, y, z] = f.subarray(j * 7, j * 7 + 3)
			entered ||= Math.abs(x) <= halfW - r[j]
			if (!entered) continue
			const s = camera / (camera - z)
			swell = Math.max(swell, s)
			poke = Math.max(poke, ((Math.abs(x) + r[j]) * s - box.display.containerWidth) * px, ((Math.abs(y) + r[j]) * s - box.display.containerHeight) * px)
		}
	})
	return {
		swell,
		poke,
		n,
		radius: avg(r),
		landMs: land.filter(s => s !== null).map(s => s * dt * 1000),
		landAcross: land.map((s, j) => (s === null ? null : across(at(s, j)[0]))).filter(x => x !== null),
		across100: acrossAt(100), across300: acrossAt(300), across600: acrossAt(600),
		peakHeight: Math.max(...cur.dice.map((m, j) => Math.max(...frames.map(f => f[j * 7 + 2] / r[j])))),
		contactsEarly: early,
		contactsAll: all,
		restingPairs,
		touching: touching.size,
		stacked: stacked.size,
		outside: rest.filter(p => Math.abs(p[0]) > halfW || Math.abs(p[1]) > halfH).length,
		overlap: [100, 200, 300, 450, 600].map(overlapping),
		atWall: [100, 200, 300, 450, 600].map(atWall),
		nearFar: rest.filter((p, j) => Math.abs(p[0] + entry * halfW) < 1.25 * r[j]).length,
		nearEntry: rest.filter((p, j) => Math.abs(p[0] - entry * halfW) < 1.25 * r[j]).length,
		entryThird: restAcross.filter(x => x < 1 / 3).length,
		farThird: restAcross.filter(x => x > 2 / 3).length,
		restAcross,
		restSpreadX: (Math.max(...rest.map(p => p[0])) - Math.min(...rest.map(p => p[0]))) / (2 * halfW),
		restSpreadY: (Math.max(...rest.map(p => p[1])) - Math.min(...rest.map(p => p[1]))) / (2 * halfH),
		nearestNeighbor: n > 1 ? avg(nearest) : null,
		settleMs: last * dt * 1000,
	}
}

// Waits for a throw to be simulated, then jumps its playback to the end.
async function skipPlayback(box, captured, start) {
	const before = captured.throws.length
	const rolling = start()
	while (captured.throws.length === before) await new Promise(r => setTimeout(r, 1))
	for (const t of box.throws) t.startStep = -t.frames.length
	return rolling
}

window.bench = {
	rendererInfo: () => rendererInfo(window.box),

	// Throws each notation `runs` times and measures where the dice go (throwMetrics). Playback
	// jumps to the end of each throw once it is simulated, since only the recording is measured.
	async spread({ notations = ["2d20", "5d20", "10d20", "2d6", "5d6", "10d6"], runs = 8, seed = 31, options = {} } = {}) {
		const box = window.box
		const captured = captureThrows(box)
		Math.random = mulberry32(seed)
		const out = {}
		for (const notation of notations) {
			const rows = []
			for (let i = 0; i < runs; i++) {
				const before = captured.throws.length
				await skipPlayback(box, captured, () => box.roll(notation, options))
				rows.push(throwMetrics(box, captured.throws[before]))
			}
			out[notation] = rows
		}
		box.clearDice()
		return out
	},

	// Throws one notation and keeps its recording, so poseAt can show it at any moment.
	async keepThrow(notation, seed = 5, options = {}) {
		const box = window.box
		const captured = captureThrows(box)
		Math.random = mulberry32(seed)
		const before = captured.throws.length
		await skipPlayback(box, captured, () => box.roll(notation, options))
		window.kept = captured.throws[before]
		return { frames: window.kept.frames.length, metrics: throwMetrics(box, window.kept) }
	},

	poseAt(ms) {
		const box = window.box
		const cur = window.kept
		const f = Math.min(cur.frames.length - 1, Math.round(ms / 1000 / box.framerate))
		const poses = cur.frames[f]
		cur.dice.forEach((mesh, j) => {
			mesh.position.set(poses[j * 7], poses[j * 7 + 1], poses[j * 7 + 2])
			mesh.quaternion.set(poses[j * 7 + 3], poses[j * 7 + 4], poses[j * 7 + 5], poses[j * 7 + 6])
		})
		box.renderer.render(box.scene, box.camera)
		return f
	},
	gpuBytes: () => gpu.bytes(),

	// `throws` throws cycling through the first `themes` themes; the dice of the last `keep` throws
	// stay on the table. With `wave` > 1 (and a build that supports it) that many throws start at once.
	async multi({ themes = 4, throws = 12, keep = 4, wave = 1, seed = 5, samples = 0, distinct = false } = {}) {
		const box = window.box
		const perThrow = typeof box.preloadTheme === "function"
		const rand = mulberry32(seed)
		const rec = { checks: 0, failures: [], firstUseMs: [], warmMs: [], samples: [] }
		const seen = new Set()
		const table = []
		const themeAt = i => distinct ? { ...THEMES[i % THEMES.length], name: `d${i}`, background: `#${((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, "0")}` } : THEMES[i % themes]
		for (let i = 0; i < throws; i += perThrow ? wave : 1) {
			const batch = []
			for (let k = i; k < Math.min(throws, i + (perThrow ? wave : 1)); k++) batch.push({ theme: themeAt(k), req: playerThrow(rand) })
			const results = await Promise.all(batch.map(async ({ theme, req }, k) => {
				if (k) await new Promise(r => setTimeout(r, 40 + rand() * 200))
				const first = !seen.has(theme.name)
				seen.add(theme.name)
				const t0 = performance.now()
				const result = await themedThrow(box, theme, req.notation, perThrow)
				return { req, result, first, ms: performance.now() - t0 }
			}))
			for (const { req, result, first, ms } of results) {
				table.push(checkThrow(box, req, result, rec))
				;(first ? rec.firstUseMs : rec.warmMs).push(ms)
			}
			while (table.length > keep) await box.remove(table.shift())
			if (samples && (i % samples === 0 || i + wave >= throws)) rec.samples.push({ throw: i, gpu: gpu.bytes(), textures: box.renderer.info.memory.textures, programs: box.renderer.info.programs.length })
		}
		rec.gpuBytes = gpu.bytes()
		rec.glTextures = gpu.count()
		rec.info = rendererInfo(box)
		rec.programs = programsByType(box)
		rec.diceOnTable = box.diceList.filter(m => m.parent).length
		return rec
	},

	// `players` players throw two dice each at nearly the same time. Builds without concurrent throws
	// throw all of them as one roll instead, which moves the same number of dice.
	async crowd({ players = 4, seed = 9 } = {}) {
		const box = window.box
		const stats = window.stats
		const perThrow = typeof box.preloadTheme === "function"
		const rand = mulberry32(seed)
		const reqs = Array.from({ length: players }, () => {
			const a = pick(rand, ["d20", "d6", "d8", "d12"]), b = "d20"
			const va = pick(rand, VALUES[a]), vb = pick(rand, VALUES[b])
			return a === b ? { notation: `2d20@${va},${vb}`, wanted: [va, vb] } : { notation: `1${a}+1d20@${va},${vb}`, wanted: [va, vb] }
		})
		const rec = { checks: 0, failures: [] }
		if (perThrow) for (let k = 0; k < players; k++) await box.preloadTheme(THEMES[k % THEMES.length], ["d20", "d6", "d8", "d12"])
		const run = await timed(box, stats, async () => {
			if (!perThrow) return [await box.roll(reqs.map(r => r.notation.split("@")[0]).join("+") + "@" + reqs.flatMap(r => r.wanted).join(","))]
			box.clearDice()
			return Promise.all(reqs.map(async (req, k) => {
				if (k) await new Promise(r => setTimeout(r, k * 60))
				return { req, result: await box.roll(req.notation, { colorset: THEMES[k % THEMES.length], clear: false }) }
			}))
		})
		if (perThrow) for (const { req, result } of run.result) {
			const flat = result.sets.flatMap(s => s.rolls)
			checkThrow(box, req, flat, rec)
		}
		const { result, ...timing } = run
		const sims = window.simMs.slice(-players)
		return { ...timing, ...rec, dice: box.diceList.filter(m => m.parent).length, simMs: sims.length ? Math.max(...sims) : null, simAvgMs: sims.length ? avg(sims) : null }
	},

	// Eight players' dice, two or three each, thrown within half a second of each other.
	async table({ players = 8, seed = 21 } = {}) {
		const box = window.box
		Math.random = mulberry32(seed)
		const rand = mulberry32(seed)
		const themes = THEMES.slice(0, players)
		for (const theme of themes) await box.preloadTheme(theme, ["d20", "d6", "d8"])
		box.clearDice()
		const throws = await Promise.all(themes.map(async (theme, k) => {
			await new Promise(r => setTimeout(r, k * 70))
			const req = playerThrow(rand)
			return { req, result: await box.roll(req.notation, { colorset: theme, clear: false, throwFrom: k % 2 ? "left" : "right" }) }
		}))
		return throws.every(({ req, result }) => result.sets.flatMap(s => s.rolls.map(r => r.value)).join() === req.wanted.join())
	},

	// Call to first frame for each theme's first throw, and how long preloadTheme takes where it exists.
	async latency({ seed = 3 } = {}) {
		const box = window.box
		const perThrow = typeof box.preloadTheme === "function"
		const rand = mulberry32(seed)
		const out = []
		for (const theme of THEMES) {
			const row = { theme: theme.name }
			if (perThrow && params.get("preload")) {
				const t = performance.now()
				await box.preloadTheme(theme, ["d20"])
				row.preloadMs = performance.now() - t
			}
			const v = pick(rand, VALUES.d20)
			const before = window.stats.renders.length
			const programs = box.renderer.info.programs.length
			const t0 = performance.now()
			const result = await themedThrow(box, theme, `1d20@${v}`, perThrow)
			const firstRender = window.stats.renders.slice(before).find(([t, , dice]) => t >= t0 && dice > 0)
			row.firstFrameMs = firstRender ? firstRender[0] + firstRender[1] - t0 : null
			row.newPrograms = box.renderer.info.programs.length - programs
			row.ok = Number(result[0].value) === v
			await box.remove([result[0].id])
			out.push(row)
		}
		return out
	},

	async init(config = APP_CONFIG, overrides = {}) {
		const t0 = performance.now()
		const box = new DiceBox("#dice-box", { ...config, ...overrides })
		await box.initialize()
		window.box = box
		window.stats = instrument(box)
		window.simMs = []
		window.recorded = 0
		window.reported = 0
		if (params.get("impacts") && "onImpact" in box) box.onImpact = () => { window.reported++ }
		if (typeof box.simulate === "function") {
			const simulate = box.simulate.bind(box)
			box.simulate = (...a) => {
				const t = performance.now()
				try {
					const out = simulate(...a)
					window.recorded += out.impacts ? out.impacts.steps.length : 0
					return out
				} finally { window.simMs.push(performance.now() - t) }
			}
		}
		return { initMs: performance.now() - t0 }
	},

	// Runs `rolls` predetermined rolls and checks both the results JSON and the face each die
	// actually shows (read back from its final orientation).
	async correctness(rolls = 50, seed = 42) {
		const box = window.box
		const stats = window.stats
		const rand = mulberry32(seed)
		const records = []
		for (let i = 0; i < rolls; i++) {
			const req = makeRequest(rand, i)
			const rec = { notation: req.notation, adds: req.adds.map(a => `1${a.type}@${a.value}`), failures: [] }
			const roll = await timed(box, stats, () => box.roll(req.notation))
			const { result, ...timing } = roll
			Object.assign(rec, timing)

			const wanted = req.sets.flatMap(s => s.values)
			const reported = roll.result.sets.flatMap(s => s.rolls.map(r => Number(r.value)))
			const shown = faceValues(box)
			wanted.forEach((v, k) => {
				const type = req.sets.flatMap(s => s.values.map(() => s.type))[k]
				if (reported[k] !== v) rec.failures.push({ kind: "json", type, wanted: v, got: reported[k] })
				if (shown[k] !== v) rec.failures.push({ kind: "face", type, wanted: v, got: shown[k] })
			})

			rec.addMs = []
			for (const add of req.adds) {
				const before = box.diceList.length
				const res = await timed(box, stats, () => box.add(`1${add.type}@${add.value}`))
				rec.addMs.push(res.ms)
				rec.restOvershootPx = Math.max(rec.restOvershootPx, res.restOvershootPx)
				rec.maxOvershootPx = Math.max(rec.maxOvershootPx, res.maxOvershootPx)
				const got = Number(res.result[0]?.value)
				if (got !== add.value) rec.failures.push({ kind: "json", type: add.type, add: true, wanted: add.value, got })
				const face = faceValues(box)
				if (face[before] !== add.value) rec.failures.push({ kind: "face", type: add.type, add: true, wanted: add.value, got: face[before] })
				// the dice already on the table must not have changed
				for (let k = 0; k < wanted.length; k++) {
					if (face[k] !== wanted[k]) rec.failures.push({ kind: "disturbed", wanted: wanted[k], got: face[k] })
				}
			}
			rec.checks = wanted.length * 2 + req.adds.length * 2
			records.push(rec)
		}
		box.clearDice()
		return records
	},

	// What onImpact reports for throws of each notation, `runs` times each: impacts per throw, how many
	// are die-on-die, their speeds, the shortest gap between two reports of one throw, `at`, and whether
	// every recorded impact was reported (one due more than a quarter second before its frame ran, as
	// after a stall, is dropped). Then two throws in different colorsets at once, the second with its
	// own listener, and a check
	// that no audio element was made or played.
	async impacts({ notations = ["1d20", "2d20", "10d6"], runs = 6, impact = {}, seed = 13, raw = false } = {}) {
		const box = window.box
		if (!("onImpact" in box)) return { supported: false }
		Math.random = mulberry32(seed)
		Object.assign(box.impact, impact)
		const stats = window.stats
		const out = { supported: true, throws: {}, raw: [] }
		const watch = () => {
			const hits = []
			box.onImpact = hit => hits.push({ ...hit, t: performance.now() })
			window.recorded = 0
			return hits
		}
		for (const notation of notations) {
			const rows = []
			for (let i = 0; i < runs; i++) {
				const hits = watch()
				const run = await timed(box, stats, () => box.roll(notation))
				const gaps = hits.slice(1).map((h, k) => h.t + h.at * 1000 - hits[k].t - hits[k].at * 1000)
				if (raw) out.raw.push(...hits.map(h => Math.round(h.speed * box.impact.full)))
				rows.push({
					reported: hits.length, recorded: window.recorded, die: hits.filter(h => h.die).length,
					speeds: hits.map(h => h.speed), at: hits.map(h => h.at), x: hits.map(h => h.x),
					minGapMs: gaps.length ? Math.min(...gaps) : null, avgFrameMs: run.avgFrameMs, simMs: window.simMs.at(-1),
					inRange: hits.every(h => h.speed >= 0 && h.speed <= 1 && h.x >= 0 && h.x <= 1 && h.at >= 0 && h.at < 0.05 && typeof h.die === "boolean"),
				})
			}
			out.throws[notation] = rows
		}
		// a first throw in each colorset, so a shader compile stalling playback (and dropping its late
		// impacts) doesn't count against the concurrent throws
		await box.roll("1d20", { colorset: THEMES[0] })
		await box.roll("1d6", { colorset: THEMES[8] })
		const hits = watch()
		const own = []
		box.clearDice()
		await Promise.all([
			box.roll("2d20", { colorset: THEMES[0], clear: false }),
			new Promise(r => setTimeout(r, 120)).then(() => box.roll("3d6", { colorset: THEMES[8], clear: false, throwFrom: "left", onImpact: hit => own.push(hit) })),
		])
		out.concurrent = { reported: hits.length + own.length, own: own.length, recorded: window.recorded, die: hits.filter(h => h.die).length + own.filter(h => h.die).length }
		box.onImpact = null
		box.clearDice()
		out.audio = { ...media }
		return out
	},

	// Renders while nothing moves, then a fade-out clear if the build has one.
	async idleAndClear() {
		const box = window.box
		await box.roll("2d20@14,6")
		const t0 = performance.now()
		await new Promise(r => setTimeout(r, 1500))
		const idleRenders = window.stats.renders.filter(([t]) => t > t0).length
		const before = rendererInfo(box)
		const t1 = performance.now()
		const fading = box.clearDice({ fade: 300 })
		const hasFade = fading && typeof fading.then === "function"
		if (hasFade) await fading
		const fadeRenders = window.stats.renders.filter(([t]) => t > t1).length
		return { idleRenders, hasFade, fadeMs: performance.now() - t1, fadeRenders, diceLeft: box.diceList.length, opacity: box.renderer.domElement.style.opacity, before, after: rendererInfo(box) }
	},

	async dispose() {
		const box = window.box
		if (typeof box.dispose !== "function") return { supported: false }
		box.dispose()
		return { supported: true, canvasRemoved: !document.querySelector("#dice-box canvas") }
	},

	canvasSize() {
		const c = window.box.renderer.domElement
		return { css: [c.clientWidth, c.clientHeight], px: [c.width, c.height], container: [window.box.container.clientWidth, window.box.container.clientHeight], pixelRatio: window.box.renderer.getPixelRatio() }
	},

	async showcase(notation, seed = 7) {
		Math.random = mulberry32(seed)
		return (await box.roll(notation)).total
	},
}

window.benchReady = true
