// Side-by-side and brightness stats for two bench screenshots.
//   node bench/compare.mjs bench/out/main-ember.png bench/out/current-ember.png [out.png]

import { readFileSync } from "node:fs"
import { chromium } from "playwright"

const [a, b, out = "bench/out/compare.png"] = process.argv.slice(2)
const url = path => `data:image/png;base64,${readFileSync(path).toString("base64")}`

const browser = await chromium.launch({ channel: "chrome", headless: true })
const page = await browser.newPage()
const stats = await page.evaluate(async ([a, b]) => {
	const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src })
	const [ia, ib] = await Promise.all([load(a), load(b)])
	const w = ia.width, h = ia.height
	const canvas = document.createElement("canvas")
	canvas.width = w * 2 + 10
	canvas.height = h
	const ctx = canvas.getContext("2d")
	ctx.drawImage(ia, 0, 0)
	ctx.drawImage(ib, w + 10, 0)
	const da = ctx.getImageData(0, 0, w, h).data
	const db = ctx.getImageData(w + 10, 0, w, h).data
	const bg = [da[0], da[1], da[2]]
	const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
	let n = 0, la = 0, lb = 0, diff = 0, maxA = 0, maxB = 0
	for (let i = 0; i < da.length; i += 4) {
		const off = Math.abs(da[i] - bg[0]) + Math.abs(da[i + 1] - bg[1]) + Math.abs(da[i + 2] - bg[2])
		if (off < 30) continue
		n++
		const x = luma(da, i), y = luma(db, i)
		la += x; lb += y; diff += Math.abs(x - y)
		maxA = Math.max(maxA, x); maxB = Math.max(maxB, y)
	}
	document.body.appendChild(canvas)
	return { pixels: n, meanLumaA: la / n, meanLumaB: lb / n, meanAbsDiff: diff / n, maxA, maxB, dataUrl: canvas.toDataURL() }
}, [url(a), url(b)])
const { dataUrl, ...rest } = stats
await page.close()
await browser.close()
const { writeFileSync } = await import("node:fs")
writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"))
console.log(JSON.stringify(rest, (k, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v)))
