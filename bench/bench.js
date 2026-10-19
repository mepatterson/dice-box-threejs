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

const { default: DiceBox } = await import(params.get("bundle"))

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

	async init(config = APP_CONFIG, overrides = {}) {
		const t0 = performance.now()
		const box = new DiceBox("#dice-box", { ...config, ...overrides })
		await box.initialize()
		window.box = box
		window.stats = instrument(box)
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
