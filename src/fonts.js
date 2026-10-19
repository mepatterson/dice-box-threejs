// Number fonts for dice labels. The page includes the font (a Google Fonts stylesheet or its own
// @font-face); the box only waits for it before drawing labels.

const DIGITS = '0123456789'
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+)$/i
const failed = new Set()
const metrics = new Map()

export function fontOf(colordata) {
	if (!colordata || !colordata.font) return null
	return {
		family: colordata.font,
		weight: colordata.fontWeight || '',
		scale: Number(colordata.fontScale) || 1,
		offset: Number(colordata.fontOffset) || 0,
	}
}

export function fontKey(font) {
	return font ? `${font.family}|${font.weight}|${font.scale}|${font.offset}` : ''
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

let measureContext
function measurer() {
	if (!measureContext) measureContext = document.createElement('canvas').getContext('2d')
	return measureContext
}

// An installed (not web) font changes the width of the test string against both fallbacks.
function installed(family, weight) {
	const first = family.split(',')[0].trim()
	if (GENERIC.test(first.replace(/['"]/g, ''))) return true
	const ctx = measurer()
	const width = font => { ctx.font = font; return ctx.measureText(DIGITS + 'mwi').width }
	return ['monospace', 'serif'].some(fallback => width(`${weight} 72px ${first}, ${fallback}`) != width(`${weight} 72px ${fallback}`))
}

// Resolves true when the face can be drawn on a canvas. A stylesheet that is still loading has not
// declared its faces yet, so the lookup is retried until the timeout, then the box warns and draws
// with the default font. After a timeout the font is only checked, not waited for again.
export async function loadFont(font, timeout = 3000) {
	if (!font || typeof document === 'undefined' || !document.fonts) return true
	const spec = `${font.weight} 48px ${font.family}`.trim()
	const retry = failed.has(spec)
	if (retry) timeout = 50
	const end = performance.now() + timeout
	while (true) {
		const left = end - performance.now()
		try {
			const faces = await Promise.race([document.fonts.load(spec, DIGITS), sleep(Math.max(0, left)).then(() => null)])
			if (faces && faces.length) return true
		} catch {}
		if (installed(font.family, font.weight)) return true
		if (performance.now() >= end) break
		await sleep(100)
	}
	if (retry) return false
	failed.add(spec)
	console.warn(`Unable to load font ${spec}, using the default font`)
	return false
}

// Scale and vertical shift (in font sizes) that make a font's digits as tall as Arial's and centred
// where Arial's are, so the label layout fits any font. Old-style figures have ascenders and
// descenders, so the height is the median digit's. A font wider than Arial is shrunk until the die's
// widest label is at most a little wider than in Arial; a lone digit has more room around it.
export function fontMetrics(font, widest = '20') {
	const key = `${font.family}|${font.weight}|${widest}`
	let m = metrics.get(key)
	if (m) return m
	const ctx = measurer()
	ctx.textBaseline = 'middle'
	const ink = spec => {
		ctx.font = spec
		const box = ctx.measureText(DIGITS)
		const heights = [...DIGITS].map(d => {
			const glyph = ctx.measureText(d)
			return glyph.actualBoundingBoxAscent + glyph.actualBoundingBoxDescent
		}).sort((a, b) => a - b)
		return { up: box.actualBoundingBoxAscent, down: box.actualBoundingBoxDescent, height: heights[5], width: ctx.measureText(widest).width }
	}
	const base = ink('100px Arial')
	const own = ink(`${font.weight} 100px ${font.family}`)
	let scale = base.height / (own.height || 1)
	scale = Math.min(scale, base.width * (widest.length > 1 ? 1.3 : 1.6) / (own.width || 1))
	scale = Math.min(1.4, Math.max(0.6, scale || 1))
	const shift = ((base.down - base.up) - (own.down - own.up) * scale) / 200
	m = { scale, shift }
	metrics.set(key, m)
	return m
}
