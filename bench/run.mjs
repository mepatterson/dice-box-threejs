// Benchmark and correctness harness.
//
//   node bench/run.mjs                                   # current dist build
//   node bench/run.mjs main=/path/a.es.js branch=dist/dice-box-threejs.es.js
//
// Options: --rolls=50 --dpr=1 --seed=42 --no-shots --shots-only
//
// Chrome runs headless with SwiftShader (software GL), so absolute frame and render times are
// far slower than a real GPU. Compare builds against each other, not against a budget.

import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { gzipSync, brotliCompressSync } from "node:zlib"
import { extname, join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = join(root, "bench", "out")

const flags = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith("--")).map(a => {
	const [k, v] = a.slice(2).split("=")
	return [k, v ?? true]
}))
const builds = process.argv.slice(2).filter(a => !a.startsWith("--")).map(a => {
	const [label, path] = a.includes("=") ? a.split("=") : ["current", a]
	return { label, path: resolve(path) }
})
if (!builds.length) builds.push({ label: "current", path: join(root, "dist", "dice-box-threejs.es.js") })

const rolls = Number(flags.rolls || 50)
const dpr = Number(flags.dpr || 1)
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

async function openPage(browser, port, index, query = "") {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr })
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

async function runBuild(browser, port, index) {
	const build = builds[index]
	console.log(`\n== ${build.label}: ${build.path}`)
	const report = { label: build.label, size: sizes(build.path) }

	if (flags["shots-only"]) {
		await screenshots(browser, port, index)
		return null
	}

	const { context, page } = await openPage(browser, port, index)
	const cdp = await context.newCDPSession(page)
	report.heapBeforeInit = await heap(cdp)
	report.init = await page.evaluate(() => bench.init())
	report.heapAfterInit = await heap(cdp)
	report.infoAfterInit = await page.evaluate(() => bench.rendererInfo())

	const records = await page.evaluate(([n, s]) => bench.correctness(n, s), [rolls, seed])
	report.heapAfterRolls = await heap(cdp)
	report.infoAfterRolls = await page.evaluate(() => bench.rendererInfo())
	report.records = records
	await context.close()

	if (!flags["no-shots"]) await screenshots(browser, port, index)
	return report
}

async function screenshots(browser, port, index) {
	const build = builds[index]
	{
		await mkdir(outDir, { recursive: true })
		const shots = [
			{ name: "ember", query: "", config: null },
			{ name: "ember-light", query: "&light=1", config: null },
			{ name: "white-glass", query: "", config: { assetPath: "/", theme_colorset: "white", theme_material: "glass", baseScale: 140, strength: 1.6 } },
			{ name: "fire-metal", query: "", config: { assetPath: "/", theme_colorset: "fire", baseScale: 140, strength: 1.6 } },
		]
		for (const shot of shots) {
			const { context, page } = await openPage(browser, port, index, shot.query + "&seed=3")
			await page.evaluate(c => bench.init(c || undefined), shot.config)
			await page.evaluate(() => bench.showcase("1d4+1d6+1d8+1d10+1d12+2d20@3,5,7,9,11,17,20", 11))
			await page.waitForTimeout(150)
			await page.locator("#dice-box").screenshot({ path: join(outDir, `${build.label}-${shot.name}.png`) })
			await context.close()
		}
	}
}

function summarize(r) {
	const recs = r.records
	const checks = recs.reduce((a, x) => a + x.checks, 0)
	const failures = recs.flatMap(x => x.failures)
	const warm = recs.slice(1)
	return {
		"bundle raw": kb(r.size.raw),
		"bundle gzip -9": kb(r.size.gzip),
		"bundle brotli": kb(r.size.brotli),
		"initialize()": ms(r.init.initMs),
		"first roll: call to first frame drawn": ms(recs[0].firstRenderMs),
		"first roll: call to resolve": ms(recs[0].ms),
		"warm rolls: call to first frame drawn (avg)": ms(avg(warm.map(x => x.firstRenderMs))),
		"warm rolls: call to resolve (avg)": ms(avg(warm.map(x => x.ms))),
		"add(): call to resolve (avg)": ms(avg(recs.flatMap(x => x.addMs))),
		"frame interval during roll (avg)": ms(avg(recs.map(x => x.avgFrameMs))),
		"renderer.render() cost (avg)": ms(avg(recs.map(x => x.avgRenderMs))),
		"renderer.render() cost (worst)": ms(Math.max(...recs.map(x => x.maxRenderMs))),
		"renders per roll (avg)": avg(recs.map(x => x.renders)).toFixed(1),
		"JS heap after init": kb(r.heapAfterInit),
		[`JS heap after ${recs.length} rolls`]: kb(r.heapAfterRolls),
		"geometries / textures / programs after init": `${r.infoAfterInit.geometries} / ${r.infoAfterInit.textures} / ${r.infoAfterInit.programs}`,
		[`geometries / textures / programs after ${recs.length} rolls`]: `${r.infoAfterRolls.geometries} / ${r.infoAfterRolls.textures} / ${r.infoAfterRolls.programs}`,
		"predetermined checks passed": `${checks - failures.length} / ${checks} (${(((checks - failures.length) / checks) * 100).toFixed(1)}%)`,
		"failures by kind/type": Object.entries(failures.reduce((acc, f) => {
			const k = `${f.kind}:${f.type ?? "-"}${f.add ? "(add)" : ""}`
			acc[k] = (acc[k] || 0) + 1
			return acc
		}, {})).map(([k, v]) => `${k}=${v}`).join(" ") || "none",
	}
}

const server = await serve()
const port = server.address().port
const browser = await chromium.launch({
	channel: "chrome",
	headless: true,
	args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
})

const reports = []
for (let i = 0; i < builds.length; i++) reports.push(await runBuild(browser, port, i))
await browser.close()
server.close()

if (flags["shots-only"]) process.exit(0)
await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, "report.json"), JSON.stringify(reports, null, 2))

const summaries = reports.map(summarize)
const keys = Object.keys(summaries[0])
const width = Math.max(...keys.map(k => k.length))
console.log(`\nSoftware GL (SwiftShader), dpr ${dpr}, ${rolls} rolls, seed ${seed}. Compare builds relatively.\n`)
console.log("".padEnd(width) + reports.map(r => ` | ${r.label.padEnd(22)}`).join(""))
for (const [i, k] of keys.entries()) {
	console.log(k.padEnd(width) + summaries.map(s => ` | ${String(Object.values(s)[i]).padEnd(22)}`).join(""))
}
console.log(`\nFull report: ${join(outDir, "report.json")}`)
