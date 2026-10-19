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

window.bench = {
	rendererInfo: () => rendererInfo(window.box),
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
		if (typeof box.simulate === "function") {
			const simulate = box.simulate.bind(box)
			box.simulate = (...a) => {
				const t = performance.now()
				try { return simulate(...a) } finally { window.simMs.push(performance.now() - t) }
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
