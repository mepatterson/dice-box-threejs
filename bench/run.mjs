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
import { chromium } from "playwright"

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
	const overrides = Object.fromEntries([...new URLSearchParams(hash)].map(([k, v]) => [k, isNaN(Number(v)) ? v : Number(v)]))
	return { label, path: resolve(path), overrides }
})
if (!builds.length) builds.push({ label: "current", path: join(root, "dist", "dice-box-threejs.es.js") })

const profileNames = flags.profiles ? String(flags.profiles).split(",") : Object.keys(PROFILES)
const seed = Number(flags.seed || 42)

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
	const { context, page } = await openPage(browser, port, index, profile)
	const cdp = await context.newCDPSession(page)
	const report = { profile: name, ...profile }
	report.heapBeforeInit = await heap(cdp)
	report.init = await page.evaluate(o => bench.init(undefined, o), builds[index].overrides)
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
	const col = Math.min(34, Math.max(24, ...rows.flatMap(r => Object.values(r.values).map(v => String(v).length + 1))))
	console.log(`\n${title}`)
	console.log("".padEnd(width) + rows.map(r => ` | ${r.label.padEnd(col)}`).join(""))
	for (const [i, k] of keys.entries()) console.log(k.padEnd(width) + rows.map(r => ` | ${String(Object.values(r.values)[i]).padEnd(col)}`).join(""))
}

const server = await serve()
const port = server.address().port
const browser = await chromium.launch({
	channel: "chrome",
	headless: true,
	args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
})

if (flags.multi) {
	await runMulti()
	process.exit(0)
}

async function multiPage(index, profile, query = "") {
	const { context, page } = await openPage(browser, port, index, profile, query)
	const cdp = await context.newCDPSession(page)
	await page.evaluate(o => bench.init(undefined, o), builds[index].overrides)
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
