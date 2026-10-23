// Benchmark and correctness harness.
//
//   node bench/run.mjs                                   # current dist build, every profile
//   node bench/run.mjs main=bench/baseline/main.es.js branch=dist/dice-box-threejs.es.js
//
// Options:
//   --profiles=phone,laptop     run only these profiles (see PROFILES)
//   --rolls=50                  override the roll count of every profile
//   --seed=42                   request generator seed
//   --no-shots / --shots-only   skip or only take the showcase screenshots
//   --multi                     multi-theme memory, crowd frame times and first-throw latency instead
//   --multi --table             only a screenshot of eight players' dice thrown at once
//   --impacts                   what onImpact reports per throw size, concurrent throws and audio made
//   --impacts --raw             also the impact speeds before normalizing (to tune impact.min and full)
//   --on-impact                 run the profiles with an onImpact listener attached
//   --spread                    where side throws of 2, 5 and 10 dice land, rest and tilt (--physics=default|heavy)
//   --spread --shots            contact sheets of side throws (--notations=2d20,10d6 --seeds=5,6)
//   --shapes                    contact sheets of every die type in each shape (edges, dish) and material
//   --browser=webkit            run in WebKit instead of Chrome
//
// The dice box is a full-viewport overlay (position: fixed; inset: 0) over page content, the way
// an app that animates server-decided rolls would mount it. Chrome runs headless with
// SwiftShader (software GL), so absolute frame and render times are far slower than a real GPU
// and grow with pixel count. Compare builds against each other at the same profile, not against
// a budget.

import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { gzipSync, brotliCompressSync } from "node:zlib"
import { extname, join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, webkit } from "playwright"

const PROFILES = {
	phone: { width: 390, height: 844, dpr: 3, rolls: 50 },
	laptop: { width: 1440, height: 900, dpr: 2, rolls: 50 },
	desktop: { width: 1920, height: 1080, dpr: 1, rolls: 50 },
	half: { width: 900, height: 600, dpr: 2, rolls: 20 },
	tray: { width: 390, height: 400, dpr: 3, rolls: 20 },
	// the window is resized during and between rolls (full width, then half, then full...)
	resize: { width: 1280, height: 720, dpr: 2, rolls: 16, resize: [[1280, 720], [640, 720], [1280, 720], [900, 600]] },
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = join(root, "bench", "out")

const flags = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith("--")).map(a => {
	const [k, v] = a.slice(2).split("=")
	return [k, v ?? true]
}))
const builds = process.argv.slice(2).filter(a => !a.startsWith("--")).map(a => {
	// label=path#key=value&key=value passes config overrides, e.g. branch-pr1=dist/x.js#maxPixelRatio=1
	const [spec, hash = ""] = a.split("#")
	const [label, path] = spec.includes("=") ? spec.split("=") : ["current", spec]
	const overrides = Object.fromEntries([...new URLSearchParams(hash)].map(([k, v]) => [k, parseOverride(v)]))
	return { label, path: resolve(path), overrides }
})
if (!builds.length) builds.push({ label: "current", path: join(root, "dist", "dice-box-threejs.es.js") })

function parseOverride(v) {
	try { return JSON.parse(v) } catch { return v }
}

const profileNames = flags.profiles ? String(flags.profiles).split(",") : Object.keys(PROFILES)
const seed = Number(flags.seed || 42)
// --physics=heavy: heavier, quicker-settling dice with soft walls, for every mode (--spread uses it unless
// --physics=default). Build overrides (#gravity_multiplier=600) go on top.
const PHYSICS = {
	default: {},
	heavy: { gravity_multiplier: 480, strength: 1.8, friction: 0.75, damping: 0.25, settleTime: 0.25, restitution: { desk: 0.3, wall: 0.45, dice: 0.35 } },
}
const physicsFlag = PHYSICS[flags.physics] ?? {}
// Viewports for --spread: phone, tablet, tablet beside another app, and a short box
const SPREAD_SIZES = { phone: [390, 844], tablet: [820, 1180], "tablet-half": [600, 1000], "phone-landscape": [844, 390] }

// Colorsets for shape sheets that aren't glass: gold metal and grey stone.
const THEMES_FOR_SHOTS = {
	metal: { foreground: "#2B1D0E", background: "#C9A227", outline: "none", material: "metal" },
	stone: { foreground: "#ffffff", background: "#5A5A5A", outline: "#000000", texture: "stone" },
}

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".webp": "image/webp", ".png": "image/png", ".mp3": "audio/mpeg" }

function serve() {
	const server = createServer(async (req, res) => {
		const url = new URL(req.url, "http://x")
		try {
			let file
			const m = url.pathname.match(/^\/bundle\/(\d+)\.js$/)
			if (m) file = builds[Number(m[1])].path
			else if (url.pathname.startsWith("/bench/")) file = join(root, url.pathname)
			else file = join(root, "public", url.pathname)
			const body = await readFile(file)
			res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" })
			res.end(body)
		} catch {
			res.writeHead(404)
			res.end()
		}
	})
	return new Promise(r => server.listen(0, () => r(server)))
}

function sizes(path) {
	const buf = readFileSync(path)
	return { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, brotli: brotliCompressSync(buf).length }
}

const avg = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0)
const kb = n => `${(n / 1024).toFixed(1)} KiB`
const ms = n => (n == null ? "-" : `${n.toFixed(1)} ms`)

async function heap(cdp) {
	await cdp.send("HeapProfiler.collectGarbage")
	await cdp.send("HeapProfiler.collectGarbage")
	const { usedSize } = await cdp.send("Runtime.getHeapUsage")
	return usedSize
}

async function openPage(browser, port, index, profile, query = "") {
	const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr })
	const page = await context.newPage()
	page.on("pageerror", e => console.error(`  page error: ${e.message}`))
	page.on("console", m => {
		if ((m.type() === "error" || m.type() === "warning") && !/ReadPixels|Failed to load resource/.test(m.text())) console.error(`  console ${m.type()}: ${m.text()}`)
	})
	page.on("response", r => { if (r.status() >= 400 && !r.url().endsWith("favicon.ico")) console.error(`  ${r.status()} ${r.url()}`) })
	await page.goto(`http://localhost:${port}/bench/index.html?bundle=/bundle/${index}.js${query}`)
	await page.waitForFunction(() => window.benchReady === true)
	return { context, page }
}

async function runProfile(browser, port, index, name) {
	const profile = PROFILES[name]
	const rolls = Number(flags.rolls || profile.rolls)
	const { context, page } = await openPage(browser, port, index, profile, flags["on-impact"] ? "&impacts=1" : "")
	const cdp = await context.newCDPSession(page)
	const report = { profile: name, ...profile }
	report.heapBeforeInit = await heap(cdp)
	report.init = await page.evaluate(o => bench.init(undefined, o), { ...physicsFlag, ...builds[index].overrides })
	report.heapAfterInit = await heap(cdp)
	report.infoAfterInit = await page.evaluate(() => bench.rendererInfo())

	let resizing = Boolean(profile.resize)
	const resizer = resizing && (async () => {
		let i = 0
		while (resizing) {
			await page.waitForTimeout(700)
			if (!resizing) break
			const [width, height] = profile.resize[++i % profile.resize.length]
			await page.setViewportSize({ width, height })
		}
	})()
	report.records = await page.evaluate(([n, s]) => bench.correctness(n, s), [rolls, seed])
	resizing = false
	await resizer
	if (profile.resize) {
		await page.setViewportSize({ width: profile.width, height: profile.height })
		await page.waitForTimeout(300)
	}
	report.canvas = await page.evaluate(() => bench.canvasSize())
	report.heapAfterRolls = await heap(cdp)
	report.infoAfterRolls = await page.evaluate(() => bench.rendererInfo())
	report.idle = await page.evaluate(() => bench.idleAndClear())
	report.dispose = await page.evaluate(() => bench.dispose())
	await context.close()
	return report
}

// The overlay must leave the page untouched outside the dice and their shadows.
async function transparency(page, file) {
	await page.screenshot({ path: file })
	const shown = await page.screenshot()
	await page.evaluate(() => { document.querySelector("#dice-box canvas").style.visibility = "hidden" })
	const hidden = await page.screenshot()
	await page.evaluate(() => { document.querySelector("#dice-box canvas").style.visibility = "" })
	return page.evaluate(async ([a, b]) => {
		const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src })
		const [ia, ib] = await Promise.all([load(a), load(b)])
		const c = document.createElement("canvas")
		c.width = ia.width
		c.height = ia.height
		const ctx = c.getContext("2d", { willReadFrequently: true })
		ctx.drawImage(ia, 0, 0)
		const da = ctx.getImageData(0, 0, c.width, c.height).data
		ctx.drawImage(ib, 0, 0)
		const db = ctx.getImageData(0, 0, c.width, c.height).data
		let changed = 0, darker = 0
		for (let i = 0; i < da.length; i += 4) {
			const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])
			if (d > 6) changed++
			if (da[i] + da[i + 1] + da[i + 2] < db[i] + db[i + 1] + db[i + 2] - 6) darker++
		}
		const corner = (x, y) => { const i = (y * c.width + x) * 4; return [da[i] - db[i], da[i + 1] - db[i + 1], da[i + 2] - db[i + 2]].every(v => v === 0) }
		return { changedPct: (changed / (da.length / 4)) * 100, darkerPct: (darker / (da.length / 4)) * 100, cornersUntouched: corner(2, 2) && corner(c.width - 3, 2) && corner(2, c.height - 3) && corner(c.width - 3, c.height - 3) }
	}, [`data:image/png;base64,${shown.toString("base64")}`, `data:image/png;base64,${hidden.toString("base64")}`])
}

async function screenshots(browser, port, index) {
	const build = builds[index]
	await mkdir(outDir, { recursive: true })
	const small = { width: 390, height: 400, dpr: 1 }
	const shots = [
		{ name: "ember", profile: small, query: "&plain=1", config: null },
		{ name: "white-glass", profile: small, query: "&plain=1", config: { assetPath: "/", theme_colorset: "white", theme_material: "glass", baseScale: 140, strength: 1.6 } },
		{ name: "fire-metal", profile: small, query: "&plain=1", config: { assetPath: "/", theme_colorset: "fire", baseScale: 140, strength: 1.6 } },
		{ name: "overlay-phone", profile: PROFILES.phone, query: "", config: null },
		{ name: "overlay-laptop-light", profile: PROFILES.laptop, query: "&light=1", config: null },
	]
	const results = {}
	for (const shot of shots) {
		const { context, page } = await openPage(browser, port, index, shot.profile, shot.query + "&seed=3")
		await page.evaluate(([c, o]) => bench.init(c || undefined, o), [shot.config, builds[index].overrides])
		await page.evaluate(() => bench.showcase("1d4+1d6+1d8+1d10+1d12+2d20@3,5,7,9,11,17,20", 11))
		await page.waitForTimeout(150)
		results[shot.name] = await transparency(page, join(outDir, `${build.label}-${shot.name}.png`))
		await context.close()
	}
	return results
}

function summarize(r) {
	const recs = r.records
	const checks = recs.reduce((a, x) => a + x.checks, 0)
	const failures = recs.flatMap(x => x.failures)
	const warm = recs.slice(1)
	return {
		"initialize()": ms(r.init.initMs),
		"first roll: call to first dice frame": ms(recs[0].firstRenderMs),
		"first roll: call to resolve": ms(recs[0].ms),
		"warm: call to first dice frame (avg)": ms(avg(warm.map(x => x.firstRenderMs))),
		"warm: call to resolve (avg)": ms(avg(warm.map(x => x.ms))),
		"add(): call to resolve (avg)": ms(avg(recs.flatMap(x => x.addMs))),
		"frame interval while rolling (avg)": ms(avg(recs.map(x => x.avgFrameMs))),
		"render() cost (avg / worst)": `${ms(avg(recs.map(x => x.avgRenderMs)))} / ${ms(Math.max(...recs.map(x => x.maxRenderMs)))}`,
		"renders per roll (avg)": avg(recs.map(x => x.renders)).toFixed(1),
		"dice outside viewport after 0.6 s (max px)": Math.max(...recs.map(x => x.maxOvershootPx)).toFixed(0),
		"dice outside viewport, at rest (max px)": Math.max(...recs.map(x => x.restOvershootPx)).toFixed(0),
		"canvas px / pixel ratio": `${r.canvas.px.join("x")} @${r.canvas.pixelRatio}`,
		"JS heap after init / after rolls": `${kb(r.heapAfterInit)} / ${kb(r.heapAfterRolls)}`,
		"geom/tex/programs after init": `${r.infoAfterInit.geometries}/${r.infoAfterInit.textures}/${r.infoAfterInit.programs}`,
		"geom/tex/programs after rolls": `${r.infoAfterRolls.geometries}/${r.infoAfterRolls.textures}/${r.infoAfterRolls.programs}`,
		"renders in 1.5 s idle": r.idle.idleRenders,
		"clearDice fade": r.idle.hasFade ? `${r.idle.fadeMs.toFixed(0)} ms, ${r.idle.fadeRenders} renders, ${r.idle.diceLeft} dice left` : "n/a",
		"dispose()": r.dispose.supported ? (r.dispose.canvasRemoved ? "ok" : "canvas left") : "n/a",
		"predetermined checks passed": `${checks - failures.length}/${checks} (${(((checks - failures.length) / checks) * 100).toFixed(1)}%)`,
		"failures by kind:type": Object.entries(failures.reduce((acc, f) => {
			const k = `${f.kind}:${f.type ?? "-"}${f.add ? "(add)" : ""}`
			acc[k] = (acc[k] || 0) + 1
			return acc
		}, {})).map(([k, v]) => `${k}=${v}`).join(" ") || "none",
	}
}

function table(title, rows) {
	const keys = Object.keys(rows[0].values)
	const width = Math.max(...keys.map(k => k.length))
	const col = Math.min(40, Math.max(24, ...rows.flatMap(r => Object.values(r.values).map(v => String(v).length + 1))))
	console.log(`\n${title}`)
	console.log("".padEnd(width) + rows.map(r => ` | ${r.label.padEnd(col)}`).join(""))
	for (const [i, k] of keys.entries()) console.log(k.padEnd(width) + rows.map(r => ` | ${String(Object.values(r.values)[i]).padEnd(col)}`).join(""))
}

const server = await serve()
const port = server.address().port
const browser = flags.browser === "webkit" ? await webkit.launch() : await chromium.launch({
	channel: "chrome",
	headless: true,
	args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
})

if (flags.multi) {
	await runMulti()
	process.exit(0)
}

if (flags.impacts) {
	await runImpacts()
	process.exit(0)
}

if (flags.spread) {
	await runSpread()
	process.exit(0)
}

if (flags.shapes) {
	await runShapes()
	process.exit(0)
}

// Contact sheets of the dice's shapes: per material, a row per shape, each die type as it rests (seen
// from above, as on the table) and turned to show its edges and faces. Physics never changes with the
// shape, so every row lands the same way.
async function runShapes() {
	const SHAPES = { classic: null, sharp: { edges: 0 }, worn: { edges: 1 }, dished: { dish: 1 }, "worn, dished": { edges: 0.6, dish: 1 } }
	const MATERIALS = {
		glass: { foreground: "#ffffff", background: "#878787", outline: "#000000", material: "glass", glass_opacity: 0.85, glass_edges: 0.35, glass_refraction: { dispersion: true } },
		metal: THEMES_FOR_SHOTS.metal,
		stone: THEMES_FOR_SHOTS.stone,
	}
	const [width, height] = [1400, 440]
	const tilt = Number(flags.tilt || 50)
	await mkdir(outDir, { recursive: true })
	const counts = []
	for (let i = 0; i < builds.length; i++) for (const [material, colors] of Object.entries(MATERIALS)) {
		const { context, page } = await openPage(browser, port, i, { width, height, dpr: Number(flags.dpr || 1) }, "&plain=1")
		await page.evaluate(o => bench.init(undefined, o), { assetPath: "/", baseScale: Number(flags.scale || 150), ...builds[i].overrides })
		const rows = []
		for (const [name, shape] of Object.entries(SHAPES)) {
			const colorset = { name: `${material}-${name}`, ...colors, ...(shape && { shape }) }
			const flat = await page.evaluate(o => bench.shapes(o), { colorset })
			const flatPng = (await page.screenshot()).toString("base64")
			const turned = await page.evaluate(o => bench.shapes(o), { colorset, tilt })
			const turnedPng = (await page.screenshot()).toString("base64")
			const wrong = flat.values.filter((v, k) => Number(v) !== flat.faces[k]).length
			rows.push({ name, flatPng, turnedPng, wrong })
			if (flags.each) await writeFile(join(outDir, `shapes-${builds[i].label}-${material}-${name.replace(/\W+/g, "-")}.png`), Buffer.from(turnedPng, "base64"))
			counts.push({ material, name, wrong, calls: turned.calls, geometry: turned.geometry })
		}
		await context.close()
		const sheet = await browser.newPage({ viewport: { width: 1800, height: 800 } })
		await sheet.setContent(`<body style="margin:0;background:#2a2622;color:#ddd;font:14px sans-serif">
			<div style="padding:6px 10px">${builds[i].label}, ${material}: as they rest | turned ${tilt} degrees</div>
			${rows.map(r => `<div style="display:grid;grid-template-columns:120px 1fr 1fr;gap:6px;padding:0 6px 6px;align-items:center"><div>${r.name}${r.wrong ? ` (${r.wrong} wrong)` : ""}</div><img style="width:100%" src="data:image/png;base64,${r.flatPng}"><img style="width:100%" src="data:image/png;base64,${r.turnedPng}"></div>`).join("")}</body>`)
		await sheet.screenshot({ path: join(outDir, `shapes-${builds[i].label}-${material}.png`), fullPage: true })
		await sheet.close()
	}
	await browser.close()
	server.close()
	for (const { material, name, wrong, calls, geometry } of counts) {
		console.log(`${material.padEnd(6)} ${name.padEnd(13)} faces wrong ${wrong}, draw calls ${String(calls).padStart(4)}, triangles ${geometry.map(g => `${g.type} ${g.triangles}`).join(" ")}, KB ${geometry.map(g => (g.bytes / 1024).toFixed(0)).join(" ")}`)
	}
}

// Side throws of several dice: where they land and come to rest, at sizes where an app sizes its
// dice to the viewport. "heavy" is heavier, quicker-settling dice with soft walls.
async function runSpread() {
	const SIZES = SPREAD_SIZES
	const physics = PHYSICS[flags.physics || "heavy"]
	const names = flags.profiles ? String(flags.profiles).split(",") : Object.keys(SIZES)
	if (flags.shots) {
		await spreadShots(names, physics)
		await browser.close()
		server.close()
		return
	}
	const runs = Number(flags.rolls || 8)
	const reports = []
	for (let i = 0; i < builds.length; i++) for (const name of names) {
		const [width, height] = SIZES[name]
		const baseScale = Math.round(Math.min(140, Math.max(105, Math.min(width, height) / 4)))
		const { context, page } = await openPage(browser, port, i, { width, height, dpr: 1 })
		await page.evaluate(o => bench.init(undefined, o), { ...physics, throwFrom: "sides", baseScale, ...builds[i].overrides })
		const r = await page.evaluate(o => bench.spread(o), { runs, seed: Number(flags.seed || 31), ...(flags.notations && { notations: String(flags.notations).split(",") }) })
		reports.push({ label: `${builds[i].label} ${name}`, build: builds[i].label, name, r })
		await context.close()
	}
	await browser.close()
	server.close()
	await mkdir(outDir, { recursive: true })
	await writeFile(join(outDir, "report-spread.json"), JSON.stringify(reports, null, 2))
	const q3 = list => {
		if (!list.length) return "-"
		const sorted = [...list].sort((a, b) => a - b)
		const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
		return `${at(0.1).toFixed(2)} / ${at(0.5).toFixed(2)} / ${at(0.9).toFixed(2)}`
	}
	const per = (rows, key) => `${avg(rows.map(x => x[key])).toFixed(1)} (max ${Math.max(...rows.map(x => x[key]))})`
	for (const notation of Object.keys(reports[0].r)) {
		table(`Side throws, ${notation} (${runs} each; across: 0 = entry wall, 1 = far wall)`, reports.map(({ label, r }) => {
			const rows = r[notation]
			return { label, values: {
				"dice resting outside the walls": per(rows, "outside"),
				"dice resting on another die": per(rows, "stacked"),
				"dice touching another at rest": per(rows, "touching"),
				"dice resting against the entry wall (1.25 r)": per(rows, "nearEntry"),
				"dice resting against the far wall (1.25 r)": per(rows, "nearFar"),
				"dice resting in the entry third": per(rows, "entryThird"),
				"dice resting in the far third": per(rows, "farThird"),
				"rest across p10 / p50 / p90": q3(rows.flatMap(x => x.restAcross)),
				"rest spread across / along (of box)": `${avg(rows.map(x => x.restSpreadX)).toFixed(2)} / ${avg(rows.map(x => x.restSpreadY)).toFixed(2)}`,
				"nearest die at rest (radii, avg)": rows[0].nearestNeighbor == null ? "-" : avg(rows.map(x => x.nearestNeighbor)).toFixed(2),
				"pairs drawn overlapping at 100/200/300/450/600 ms": [0, 1, 2, 3, 4].map(k => avg(rows.map(x => x.overlap[k])).toFixed(1)).join(" "),
				"dice against a side wall, same times": [0, 1, 2, 3, 4].map(k => avg(rows.map(x => x.atWall[k])).toFixed(1)).join(" "),
				"die-on-die contacts in first 300 ms": per(rows, "contactsEarly"),
				"die-on-die contacts, whole throw": per(rows, "contactsAll"),
				"first table touch ms p10 / p50 / p90": q3(rows.flatMap(x => x.landMs)).replace(/\.00/g, ""),
				"first touch, first to last die (ms avg)": avg(rows.map(x => x.landMs.length ? Math.max(...x.landMs) - Math.min(...x.landMs) : 0)).toFixed(0),
				"across at first touch p10 / p50 / p90": q3(rows.flatMap(x => x.landAcross)),
				"across at 100 / 300 / 600 ms (median)": ["across100", "across300", "across600"].map(k => quantileOf(rows.flatMap(x => x[k]), 0.5).toFixed(2)).join(" / "),
				"peak height (radii, max)": Math.max(...rows.map(x => x.peakHeight)).toFixed(1),
				"speed across the table until first touch (median)": quantileOf(rows.flatMap(x => x.airSpeed ?? []), 0.5).toFixed(0),
				"speed down at that touch (median)": quantileOf(rows.flatMap(x => x.landVz ?? []), 0.5).toFixed(0),
				"last die all the way in (ms, max)": Math.max(...rows.map(x => x.allIn)).toFixed(0),
				"once in: biggest swell / px past canvas edge": `${Math.max(...rows.map(x => x.swell)).toFixed(2)}x / ${Math.max(...rows.map(x => x.poke)).toFixed(0)}`,
				"dice resting over 5 deg off flat (per throw)": per(rows, "tilted"),
				"  of those against a die / a wall / nothing": ["tiltedOnDie", "tiltedOnWall", "tiltedAlone"].map(k => rows.reduce((a, x) => a + x[k], 0)).join(" / "),
				"tilt at rest p50 / p90 / max (deg)": tiltQuantiles(rows.flatMap(x => x.tilts)),
				"drawn pose vs recording at rest (deg, max)": Math.max(...rows.map(x => x.replayDrift ?? 0)).toFixed(2),
				"settle (ms avg)": avg(rows.map(x => x.settleMs)).toFixed(0),
				"settle ms p50 / p90 / max": settleQuantiles(rows.map(x => x.settleMs)),
			} }
		}))
	}
	console.log(`\nFull report: ${join(outDir, "report-spread.json")}`)
}

// Contact sheets of side throws: each throw shown at a few moments of its recording, in a row.
async function spreadShots(names, physics) {
	const SIZES = SPREAD_SIZES
	const moments = [0, 100, 200, 300, 450, 600, 900, Infinity]
	const notations = String(flags.notations || "2d20,5d20,10d6").split(",")
	const seeds = String(flags.seeds || "5").split(",").map(Number)
	await mkdir(outDir, { recursive: true })
	for (let i = 0; i < builds.length; i++) for (const name of names) {
		const [width, height] = SIZES[name]
		const baseScale = Math.round(Math.min(140, Math.max(105, Math.min(width, height) / 4)))
		const { context, page } = await openPage(browser, port, i, { width, height, dpr: 1 })
		await page.evaluate(o => bench.init(undefined, o), { ...physics, throwFrom: "sides", baseScale, ...builds[i].overrides })
		for (const notation of notations) for (const seed of seeds) {
			const info = await page.evaluate(([n, s]) => bench.keepThrow(n, s), [notation, seed])
			const frames = []
			for (const ms of moments) {
				const f = await page.evaluate(t => bench.poseAt(t), ms === Infinity ? 1e9 : ms)
				frames.push({ label: ms === Infinity ? `rest ${Math.round(f / 0.06)} ms` : `${ms} ms`, png: (await page.screenshot()).toString("base64") })
			}
			const sheet = await context.newPage()
			const scale = Math.min(1, 1800 / (width * 4))
			await sheet.setContent(`<body style="margin:0;background:#111;color:#ddd;font:14px sans-serif">
				<div style="padding:6px 10px">${builds[i].label} ${name} ${width}x${height}, ${notation}, seed ${seed}: stacked ${info.metrics.stacked}, touching ${info.metrics.touching}, off flat ${info.metrics.tilted}, near entry ${info.metrics.nearEntry}, entry third ${info.metrics.entryThird}</div>
				<div style="display:grid;grid-template-columns:repeat(4,${Math.round(width * scale)}px);gap:6px;padding:6px">${frames.map(f => `<figure style="margin:0"><img style="width:100%;display:block;border:1px solid #444" src="data:image/png;base64,${f.png}"><figcaption>${f.label}</figcaption></figure>`).join("")}</div></body>`)
			await sheet.screenshot({ path: join(outDir, `spread-${builds[i].label}-${name}-${notation}-s${seed}.png`), fullPage: true })
			await sheet.close()
		}
		await context.close()
	}
}

function tiltQuantiles(list) {
	return [0.5, 0.9].map(q => quantileOf(list, q).toFixed(1)).concat(Math.max(...list).toFixed(1)).join(" / ")
}

function settleQuantiles(list) {
	return [0.5, 0.9].map(q => quantileOf(list, q).toFixed(0)).concat(Math.max(...list).toFixed(0)).join(" / ")
}

function quantileOf(list, q) {
	const sorted = [...list].sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN
}

async function runImpacts() {
	const names = flags.profiles ? String(flags.profiles).split(",") : ["laptop", "phone"]
	const reports = []
	for (let i = 0; i < builds.length; i++) for (const name of names) {
		const { context, page } = await multiPage(i, PROFILES[name])
		const r = await page.evaluate(o => bench.impacts(o), { raw: Boolean(flags.raw), runs: Number(flags.rolls || 6), impact: flags.raw ? { min: 0, full: 100000, interval: 0 } : {} })
		reports.push({ label: `${builds[i].label} ${name}`, r })
		await context.close()
	}
	await browser.close()
	server.close()
	await mkdir(outDir, { recursive: true })
	await writeFile(join(outDir, "report-impacts.json"), JSON.stringify(reports, null, 2))
	const spread = list => {
		if (!list.length) return "-"
		const sorted = [...list].sort((a, b) => a - b)
		const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
		return `${at(0.1).toFixed(2)} / ${at(0.5).toFixed(2)} / ${at(0.9).toFixed(2)}`
	}
	const supported = reports.filter(x => x.r.supported)
	for (const notation of Object.keys(supported[0]?.r.throws ?? {})) {
		table(`onImpact, ${notation}`, supported.map(({ label, r }) => {
			const rows = r.throws[notation]
			const counts = rows.map(x => x.reported)
			return { label, values: {
				"impacts per throw (avg, min-max)": `${avg(counts).toFixed(1)} (${Math.min(...counts)}-${Math.max(...counts)})`,
				"die-on-die per throw (avg)": avg(rows.map(x => x.die)).toFixed(1),
				"reported / recorded": `${counts.reduce((a, b) => a + b, 0)} / ${rows.reduce((a, x) => a + x.recorded, 0)}`,
				"speed p10 / p50 / p90": spread(rows.flatMap(x => x.speeds)),
				"at p10 / p50 / p90 (s)": spread(rows.flatMap(x => x.at)),
				"closest two reports (min ms)": ms(Math.min(...rows.map(x => x.minGapMs ?? Infinity))),
				"fields in range": rows.every(x => x.inRange),
				"frame interval (avg)": ms(avg(rows.map(x => x.avgFrameMs))),
				"simulating (avg)": ms(avg(rows.map(x => x.simMs))),
			} }
		}))
	}
	if (supported.length) table("onImpact, 2d20 and 3d6 thrown 120 ms apart in two colorsets", supported.map(({ label, r }) => ({ label, values: {
		"reported / recorded": `${r.concurrent.reported} / ${r.concurrent.recorded}`,
		"to the 3d6 throw's own listener": r.concurrent.own,
		"die-on-die": r.concurrent.die,
		"audio elements made / played": `${r.audio.made} / ${r.audio.played}`,
	} })))
	if (flags.raw) for (const { label, r } of supported) {
		const raw = [...r.raw].sort((a, b) => a - b)
		const at = q => raw[Math.min(raw.length - 1, Math.floor(q * raw.length))]
		console.log(`\n${label} raw impact speeds (${raw.length}): p5 ${at(0.05)} p25 ${at(0.25)} p50 ${at(0.5)} p75 ${at(0.75)} p95 ${at(0.95)} max ${raw.at(-1)}`)
	}
	console.log(`\nFull report: ${join(outDir, "report-impacts.json")}`)
}

async function multiPage(index, profile, query = "") {
	const { context, page } = await openPage(browser, port, index, profile, query)
	const cdp = await context.newCDPSession(page)
	await page.evaluate(o => bench.init(undefined, o), { ...physicsFlag, ...builds[index].overrides })
	return { context, page, cdp }
}

async function runMulti() {
	const names = flags.profiles ? String(flags.profiles).split(",") : ["laptop", "phone"]
	const counts = [[1, 6], [4, 8], [8, 12], [12, 16]]
	const reports = []
	if (flags.table) {
		for (let i = 0; i < builds.length; i++) for (const name of names) {
			const { context, page } = await multiPage(i, PROFILES[name])
			console.log(`${builds[i].label} ${name} table correct: ${await page.evaluate(() => bench.table())}`)
			await page.waitForTimeout(1500)
			await page.screenshot({ path: join(outDir, `${builds[i].label}-table-${name}.png`) })
			await context.close()
		}
		await browser.close()
		server.close()
		return
	}
	for (let i = 0; i < builds.length; i++) {
		const report = { label: builds[i].label, profiles: {} }
		for (const name of names) {
			const profile = PROFILES[name]
			const r = report.profiles[name] = { themes: {}, crowd: {} }
			for (const [themes, throws] of counts) {
				console.log(`== ${builds[i].label} ${name}: ${themes} themes`)
				const { context, page, cdp } = await multiPage(i, profile)
				const heap0 = await heap(cdp)
				const rec = await page.evaluate(o => bench.multi(o), { themes, throws, keep: 4, wave: 4 })
				rec.heapAfter = await heap(cdp)
				rec.heapInit = heap0
				r.themes[themes] = rec
				await context.close()
			}
			for (const players of [4, 8]) {
				console.log(`== ${builds[i].label} ${name}: crowd of ${players}`)
				const { context, page } = await multiPage(i, profile)
				r.crowd[players] = await page.evaluate(o => bench.crowd(o), { players })
				await context.close()
			}
			{
				const { context, page } = await multiPage(i, profile)
				r.latency = await page.evaluate(() => bench.latency())
				await context.close()
			}
			{
				const { context, page } = await multiPage(i, profile, "&preload=1")
				r.latencyPreload = await page.evaluate(() => bench.latency())
				await context.close()
			}
			if (!flags["no-long"]) {
				console.log(`== ${builds[i].label} ${name}: 40 distinct themes`)
				const { context, page, cdp } = await multiPage(i, profile)
				r.long = await page.evaluate(o => bench.multi(o), { throws: 40, keep: 4, wave: 4, samples: 8, distinct: true })
				r.long.heapAfter = await heap(cdp)
				await context.close()
			}
		}
		reports.push(report)
	}
	await browser.close()
	server.close()
	await mkdir(outDir, { recursive: true })
	await writeFile(join(outDir, "report-multi.json"), JSON.stringify(reports, null, 2))
	const mb = n => `${(n / 1048576).toFixed(1)} MB`
	for (const name of names) {
		const p = PROFILES[name]
		table(`Themes in rotation, ${name} ${p.width}x${p.height} @${p.dpr}x (dice of the last 4 throws on the table)`, reports.flatMap(r => counts.map(([k]) => {
			const x = r.profiles[name].themes[k]
			const failed = x.failures.length
			return { label: `${r.label} ${k}`, values: {
				"GPU texture bytes": mb(x.gpuBytes),
				"textures / geometries / programs": `${x.info.textures}/${x.info.geometries}/${x.info.programs}`,
				"JS heap after": mb(x.heapAfter),
				"first throw in a theme (avg)": ms(avg(x.firstUseMs)),
				"warm throw (avg)": ms(avg(x.warmMs)),
				"programs by type": Object.entries(x.programs).map(([k, v]) => `${k.replace(/^Mesh|Material$/g, "")}:${v}`).join(" "),
				"checks passed": `${x.checks - failed}/${x.checks}`,
			} }
		})))
		table(`Crowd, ${name}: players throwing 2 dice each at once`, reports.flatMap(r => [4, 8].map(k => {
			const x = r.profiles[name].crowd[k]
			return { label: `${r.label} ${k}`, values: {
				"frame interval (avg)": ms(x.avgFrameMs),
				"simulating a throw (avg / worst)": x.simMs == null ? "-" : `${ms(x.simAvgMs)} / ${ms(x.simMs)}`,
				"render() (avg / worst)": `${ms(x.avgRenderMs)} / ${ms(x.maxRenderMs)}`,
				"call to all resolved": ms(x.ms),
				"dice": x.dice,
				"checks passed": `${x.checks - x.failures.length}/${x.checks}`,
			} }
		})))
		table(`First 1d20 in each new theme, ${name}: call to first frame (new programs)`, reports.flatMap(r => [["", r.profiles[name].latency], [" preload", r.profiles[name].latencyPreload]].map(([tag, rows]) => ({
			label: r.label + tag,
			values: Object.fromEntries(rows.map(x => [x.theme, `${ms(x.firstFrameMs)}${x.preloadMs != null ? ` (+${x.preloadMs.toFixed(0)} pre)` : ""} p${x.newPrograms}${x.ok ? "" : " WRONG"}`])),
		}))))
		if (!flags["no-long"]) table(`40 distinct themes, ${name}: GPU texture bytes every 8 throws`, reports.map(r => ({
			label: r.label,
			values: Object.fromEntries(r.profiles[name].long.samples.map(s => [`after throw ${s.throw}`, `${mb(s.gpu)} t${s.textures} p${s.programs}`]).concat([["JS heap after", mb(r.profiles[name].long.heapAfter)], ["checks", `${r.profiles[name].long.checks - r.profiles[name].long.failures.length}/${r.profiles[name].long.checks}`]])),
		})))
	}
	console.log(`\nFull report: ${join(outDir, "report-multi.json")}`)
}

const reports = []
for (let i = 0; i < builds.length; i++) {
	const build = builds[i]
	console.log(`== ${build.label}: ${build.path}`)
	const report = { label: build.label, size: sizes(build.path), profiles: [] }
	if (!flags["no-shots"]) report.shots = await screenshots(browser, port, i)
	if (!flags["shots-only"]) {
		for (const name of profileNames) {
			console.log(`   ${name}`)
			report.profiles.push(await runProfile(browser, port, i, name))
		}
	}
	reports.push(report)
}
await browser.close()
server.close()

await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, "report.json"), JSON.stringify(reports, null, 2))

console.log(`\nSoftware GL (SwiftShader), seed ${seed}. Absolute times are not GPU times; compare builds.`)
table("Bundle", reports.map(r => ({ label: r.label, values: { "raw": kb(r.size.raw), "gzip -9": kb(r.size.gzip), "brotli": kb(r.size.brotli) } })))
if (reports[0].shots) {
	for (const name of Object.keys(reports[0].shots)) {
		table(`Overlay transparency: ${name}`, reports.map(r => ({ label: r.label, values: {
			"page pixels changed by dice and shadows": `${r.shots[name].changedPct.toFixed(1)}%`,
			"of which darkened (shadow or die)": `${r.shots[name].darkerPct.toFixed(1)}%`,
			"corners untouched": r.shots[name].cornersUntouched,
		} })))
	}
}
for (const name of profileNames) {
	if (flags["shots-only"]) break
	const p = PROFILES[name]
	table(`Profile ${name}: ${p.width}x${p.height} @${p.dpr}x${p.resize ? ", resized during rolls" : ""}`,
		reports.map(r => ({ label: r.label, values: summarize(r.profiles.find(x => x.profile === name)) })))
}
console.log(`\nFull report: ${join(outDir, "report.json")}`)
