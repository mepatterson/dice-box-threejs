import * as THREE from "three"

// The pixel render style: a colorset with `pixel` draws its dice as chunky pixel art. They still tumble
// with the same physics; only how they are drawn changes.
//
// - Dice in a pixel theme live on PIXEL_LAYER and render into a low-resolution target (`PixelPass`),
//   sized so a die is about `size` pixels across, on a grid fixed to the canvas so it never shimmers.
// - A post pass snaps each pixel to a palette with ordered (Bayer 4x4) dithering between the two nearest
//   colours, dithers glass and shadows into a few alpha steps and draws a one-pixel outline around the
//   dice, then the result is drawn over the canvas with nearest filtering.
// - Their materials light in `bands` flat steps (`pixelShader`) with crisp highlights, so each face
//   reads as one facet, and their labels are drawn small in a bitmap font (`drawPixelLabel`), sampled
//   with nearest filtering.
// - With `edges`, borrowed from three's RenderPixelatedPass: the dice are drawn once more into a normal
//   target at the same low resolution, and where two faces of a die meet (their normals differ, on the
//   nearer side) the pixel lights up a step, while a die's border over another die further back darkens a
//   step, so every crease reads as a bright pixel line, then both snap to the palette like the rest.
// Dice of other themes keep drawing at full resolution in the same frame, under the pixel dice.

export const PIXEL_LAYER = 1
export const MAX_PALETTE = 64

export const PIXEL_DEFAULTS = { size: 40, palette: "auto", dither: 0.35, bands: 3, outline: "auto", fps: 0, fuzz: false, edges: false }

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

// A colorset's pixel options, or null for the classic style. `pixel: true` takes every default.
export function pixelOf(colordata) {
	const option = colordata && colordata.pixel
	if (!option) return null
	const o = option === true ? {} : option
	const number = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : fallback)
	return {
		size: clamp(number(o.size, PIXEL_DEFAULTS.size), 12, 128),
		palette: o.palette ?? PIXEL_DEFAULTS.palette,
		dither: clamp(number(o.dither, PIXEL_DEFAULTS.dither), 0, 1),
		bands: Math.round(clamp(number(o.bands, PIXEL_DEFAULTS.bands), 0, 8)),
		outline: o.outline ?? PIXEL_DEFAULTS.outline,
		fps: number(o.fps, 0) > 0 ? clamp(number(o.fps, 0), 4, 30) : 0,
		fuzz: Boolean(o.fuzz),
		edges: Boolean(o.edges),
	}
}

// --- colour ---------------------------------------------------------------------------------------

const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSRGB = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

export function oklab([r, g, b]) {
	const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	]
}

function fromOklab([L, a, b]) {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	].map(c => clamp(toSRGB(clamp(c, 0, 1)), 0, 1))
}

// Any CSS colour (or [r, g, b] in 0 to 255) as sRGB components 0 to 1.
export function rgbOf(color) {
	if (Array.isArray(color)) return color.slice(0, 3).map(c => clamp(Number(c) / 255, 0, 1))
	const out = {}
	new THREE.Color().setStyle(String(color)).getRGB(out, THREE.SRGBColorSpace)
	return [out.r, out.g, out.b]
}

// A short ramp around a colour, darker and lighter in OKLab with less chroma at the ends and the
// shadows cooler, the way a pixel artist shades.
function ramp(rgb, steps) {
	const [L, a, b] = oklab(rgb)
	const C = Math.hypot(a, b)
	const h = Math.atan2(b, a)
	return steps.map(d => {
		const L2 = clamp(L + d, 0.06, 0.98)
		const C2 = C * clamp(1 - Math.abs(d) * 1.4, 0.25, 1)
		const h2 = h + (d < 0 ? -0.35 : 0.15) * Math.abs(d)
		return fromOklab([L2, C2 * Math.cos(h2), C2 * Math.sin(h2)])
	})
}

// The colours of an image, split by median cut into `count` boxes (each box's mean).
function medianCut(pixels, count) {
	let boxes = [pixels]
	while (boxes.length < count) {
		boxes.sort((p, q) => spread(q) - spread(p))
		const box = boxes.shift()
		if (!box || box.length < 2) break
		const axis = widest(box)
		box.sort((p, q) => p[axis] - q[axis])
		const half = box.length >> 1
		boxes.push(box.slice(0, half), box.slice(half))
	}
	return boxes.filter(box => box.length).map(box => [0, 1, 2].map(k => box.reduce((sum, p) => sum + p[k], 0) / box.length))
}
const range = (box, k) => Math.max(...box.map(p => p[k])) - Math.min(...box.map(p => p[k]))
const spread = box => (box.length < 2 ? 0 : Math.max(range(box, 0), range(box, 1), range(box, 2)))
const widest = box => [0, 1, 2].reduce((best, k) => (range(box, k) > range(box, best) ? k : best), 0)

// Palette colours closer than this (OKLab) are one colour: dithering between near twins reads as noise.
const SPACING = 0.06

function addColor(list, rgb, closest = SPACING) {
	const lab = oklab(rgb)
	if (list.some(entry => Math.hypot(...entry.lab.map((v, k) => v - lab[k])) < closest)) return
	list.push({ rgb, lab })
}

// The palette a theme's dice snap to, as [{ rgb, lab }]. "auto" builds one from the colorset's colours
// and the colours its labels actually show (`samples`, sRGB 0 to 1, from its first label), each with a
// short ramp, plus a near black and a near white. A list of colours is used as given, a number n is n
// levels per channel, and false leaves the colours as rendered.
export function buildPalette(option, colordata, samples = []) {
	if (option === false || option === "none") return []
	const list = []
	if (Array.isArray(option)) {
		option.forEach(color => addColor(list, rgbOf(color), 0.001))
		return list.slice(0, MAX_PALETTE)
	}
	if (Number(option) > 1) {
		const n = Math.min(4, Math.round(Number(option)))
		for (let r = 0; r < n; r++) for (let g = 0; g < n; g++) for (let b = 0; b < n; b++) addColor(list, [r / (n - 1), g / (n - 1), b / (n - 1)], 0.001)
		return list
	}
	const colors = value => (Array.isArray(value) ? value : [value]).filter(c => typeof c === "string" && c && c !== "none")
	const body = colors(colordata.background)
	const label = colors(colordata.foreground)
	const accent = colors(colordata.accent)
	const outline = colors(colordata.outline)
	const wide = [-0.34, -0.2, -0.08, 0, 0.1, 0.22]
	body.forEach(c => ramp(rgbOf(c), wide).forEach(rgb => addColor(list, rgb)))
	label.forEach(c => ramp(rgbOf(c), [-0.12, 0, 0.1]).forEach(rgb => addColor(list, rgb)))
	accent.forEach(c => ramp(rgbOf(c), [-0.2, -0.08, 0, 0.1]).forEach(rgb => addColor(list, rgb)))
	outline.forEach(c => addColor(list, rgbOf(c)))
	if (samples.length) medianCut(samples, 6).forEach(rgb => ramp(rgb, [-0.16, 0, 0.12]).forEach(c => addColor(list, c, SPACING)))
	const [L, a, b] = oklab(rgbOf(body[0] || "#808080"))
	const C = Math.hypot(a, b)
	addColor(list, fromOklab([0.16, a / Math.max(C, 1e-6) * Math.min(C, 0.03), b / Math.max(C, 1e-6) * Math.min(C, 0.03)]))
	addColor(list, fromOklab([0.97, 0.004, 0.012]))
	return list.slice(0, MAX_PALETTE)
}

// --- labels ---------------------------------------------------------------------------------------

// Bitmap digits, row by row: 3x5 for small faces and 5x7 where there is room.
const SMALL = {
	width: 3, height: 5, glyphs: {
		0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111", 4: "101101111001001",
		5: "111100111001111", 6: "111100111101111", 7: "111001001010010", 8: "111101111101111", 9: "111101111001111",
		"+": "000010111010000", "-": "000000111000000", "?": "111001011000010",
	},
}
const LARGE = {
	width: 5, height: 7, glyphs: {
		0: "01110100011001110101110011000101110", 1: "00100011000010000100001000010001110",
		2: "01110100010000100010001000100011111", 3: "11111000100010000010000011000101110",
		4: "00010001100101010010111110001000010", 5: "11111100001111000001000011000101110",
		6: "00110010001000011110100011000101110", 7: "11111000010001000100010000100001000",
		8: "01110100011000101110100011000101110", 9: "01110100011000101111000010001001100",
		"+": "00000001000010011111001000010000000", "-": "00000000000000011111000000000000000",
	},
}

const glyphCache = new Map()

// One character as a bit mask: from the bitmap font, else the system font drawn small and thresholded.
function glyph(ch, font) {
	const key = `${font.height}|${ch}`
	let g = glyphCache.get(key)
	if (g) return g
	const bits = font.glyphs[ch]
	if (bits) g = { width: font.width, height: font.height, bits: Uint8Array.from(bits, b => (b === "1" ? 1 : 0)) }
	else if (ch === " ") g = { width: font.width - 1, height: font.height, bits: new Uint8Array((font.width - 1) * font.height) }
	else g = rasterGlyph(ch, font.height)
	glyphCache.set(key, g)
	return g
}

function rasterGlyph(ch, height) {
	const size = height * 3
	const canvas = document.createElement("canvas")
	canvas.width = canvas.height = size
	const ctx = canvas.getContext("2d", { willReadFrequently: true })
	ctx.font = `bold ${Math.round(height * 1.35)}px sans-serif`
	ctx.textAlign = "left"
	ctx.textBaseline = "middle"
	ctx.fillStyle = "#000"
	ctx.fillText(ch, height * 0.5, size / 2)
	const data = ctx.getImageData(0, 0, size, size).data
	let left = size, right = -1
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[(y * size + x) * 4 + 3] > 110) { left = Math.min(left, x); right = Math.max(right, x) }
	if (right < 0) return { width: 1, height, bits: new Uint8Array(height) }
	const width = right - left + 1
	const top = Math.round(size / 2 - height / 2)
	const bits = new Uint8Array(width * height)
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) bits[y * width + x] = data[((top + y) * size + left + x) * 4 + 3] > 110 ? 1 : 0
	return { width, height, bits }
}

// A label (one or more lines) as a mask of font pixels with a one pixel ring around it: 2 is the
// number, 1 the ring. A lone 6 or 9 gets a dot at its foot so it can't be read upside down.
export function textMask(text, font, dot = true) {
	const lines = String(text).split("\n").map(line => line.trim())
	const rows = lines.map(line => {
		const chars = [...line].map(ch => glyph(ch, font))
		if (dot && lines.length === 1 && (line === "6" || line === "9")) chars.push({ width: 1, height: font.height, bits: Uint8Array.from({ length: font.height }, (_, y) => (y === font.height - 1 ? 1 : 0)) })
		return { chars, width: chars.reduce((sum, g) => sum + g.width, 0) + Math.max(0, chars.length - 1) }
	})
	const width = Math.max(1, ...rows.map(row => row.width)) + 2
	const lineGap = 2
	const height = rows.length * font.height + (rows.length - 1) * lineGap + 2
	const mask = new Uint8Array(width * height)
	rows.forEach((row, r) => {
		let x = 1 + Math.floor((width - 2 - row.width) / 2)
		const y0 = 1 + r * (font.height + lineGap)
		row.chars.forEach(g => {
			for (let y = 0; y < g.height; y++) for (let gx = 0; gx < g.width; gx++) if (g.bits[y * g.width + gx]) mask[(y0 + y) * width + x + gx] = 2
			x += g.width + 1
		})
	})
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		if (mask[y * width + x]) continue
		let near = false
		for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
			const nx = x + dx, ny = y + dy
			if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx] === 2) { near = true; break }
		}
		if (near) mask[y * width + x] = 1
	}
	return { width, height, mask }
}

// The font and its scale (texels per font pixel) for a label `height` texels tall, at least the small
// font at one texel per pixel so a number always reads.
export function fontFor(height) {
	if (height >= LARGE.height * 0.9) return { font: LARGE, scale: Math.max(1, Math.round(height / LARGE.height)) }
	return { font: SMALL, scale: Math.max(1, Math.round(height / SMALL.height)) }
}

// Paints labels into an ImageData (and its bump twin) at `unit` canvas pixels per texel. Each placement is
// { text, x, y, angle, strike } in texels, centre and turn. Colours are [r, g, b, a] 0 to 255 or null to
// leave that part out. A struck placement gets a bar through the number in the fill colour over the ring.
export function paintLabels(image, bump, { placements, font, scale, unit, fill, ring }) {
	const { width, height, data } = image
	const masks = placements.map(p => {
		const m = textMask(p.text, font)
		if (p.strike) strikeMask(m)
		return { ...p, ...m, cos: Math.cos(-p.angle), sin: Math.sin(-p.angle) }
	})
	for (let py = 0; py < height; py++) {
		for (let px = 0; px < width; px++) {
			const tx = (px + 0.5) / unit, ty = (py + 0.5) / unit
			let cell = 0
			for (const m of masks) {
				const dx = tx - m.x, dy = ty - m.y
				const fx = Math.floor((dx * m.cos - dy * m.sin) / scale + m.width / 2)
				const fy = Math.floor((dx * m.sin + dy * m.cos) / scale + m.height / 2)
				if (fx < 0 || fy < 0 || fx >= m.width || fy >= m.height) continue
				cell = Math.max(cell, m.mask[fy * m.width + fx])
			}
			if (!cell) continue
			const color = cell === 2 ? fill : ring
			if (!color) continue
			const i = (py * width + px) * 4
			data[i] = color[0]
			data[i + 1] = color[1]
			data[i + 2] = color[2]
			data[i + 3] = color[3]
			if (bump) {
				bump.data[i] = bump.data[i + 1] = bump.data[i + 2] = 0
				bump.data[i + 3] = 255
			}
		}
	}
}

// A one pixel bar rising across the number, with its own ring.
function strikeMask(m) {
	const { width, height, mask } = m
	const y0 = height - 2, y1 = 1
	for (let x = 0; x < width; x++) {
		const y = Math.round(y0 + (y1 - y0) * (x / Math.max(1, width - 1)))
		mask[y * width + x] = 2
		for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
			const nx = x + dx, ny = y + dy
			if (nx >= 0 && ny >= 0 && nx < width && ny < height && !mask[ny * width + nx]) mask[ny * width + nx] = 1
		}
	}
}

export const rgba = (color, alpha = 1) => {
	if (!color || color === "none") return null
	const [r, g, b] = rgbOf(color)
	return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(alpha * 255)]
}

export function nearestTexture(canvas, colorSpace = THREE.SRGBColorSpace) {
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = colorSpace
	texture.magFilter = THREE.NearestFilter
	texture.minFilter = THREE.NearestFilter
	texture.generateMipmaps = false
	texture.anisotropy = 1
	return texture
}

// --- shading --------------------------------------------------------------------------------------

// Flat toon lighting: the direct light falls in `bands` steps, and highlights are crisp spots of one
// brightness, so each face reads as a single facet. Patches whichever lighting the material uses.
export function pixelShader(shader, bands) {
	if (!bands) return
	const helpers = `
		float pixelBand( float x ) { return x <= 0.0 ? 0.0 : ceil( x * ${bands.toFixed(1)} - 0.2 ) / ${bands.toFixed(1)}; }
		vec3 pixelSpot( vec3 s ) { float m = max( s.r, max( s.g, s.b ) ); return m <= 0.0 ? vec3( 0.0 ) : s * ( min( floor( m * 4.0 + 0.35 ) / 4.0, 1.25 ) / m ); }
	`
	const direct = "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );"
	const banded = "float dotNL = pixelBand( saturate( dot( geometryNormal, directLight.direction ) ) );"
	const patch = (chunk, extra = []) => {
		let text = helpers + THREE.ShaderChunk[chunk].replace(direct, banded)
		extra.forEach(([from, to]) => { text = text.replace(from, to) })
		return text
	}
	const chunks = {
		lights_physical_pars_fragment: [
			["reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;", "reflectedLight.directSpecular += pixelSpot( irradiance * specularBRDF * material.multiScatteringCompensation );"],
			["clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );", "clearcoatSpecularDirect += pixelSpot( ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material ) );"],
		],
		lights_phong_pars_fragment: [
			["reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong(", "reflectedLight.directSpecular += pixelSpot( irradiance ) * BRDF_BlinnPhong("],
		],
		lights_lambert_pars_fragment: [],
	}
	for (const [chunk, extra] of Object.entries(chunks)) {
		const include = `#include <${chunk}>`
		if (shader.fragmentShader.includes(include)) shader.fragmentShader = shader.fragmentShader.replace(include, patch(chunk, extra))
	}
}

// --- the pass -------------------------------------------------------------------------------------

const QUAD_VERTEX = "void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }"

const POST_FRAGMENT = `
	uniform sampler2D tColor;
	uniform sampler2D tDepth;
	uniform vec3 paletteLab[ ${MAX_PALETTE} ];
	uniform vec3 paletteRGB[ ${MAX_PALETTE} ];
	uniform int paletteSize;
	uniform float dither;
	uniform vec4 outline;
	uniform float shadowAlpha;
	uniform sampler2D tNormal;
	uniform vec3 edges;
	uniform vec2 depthRange;

	const float BAYER[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );

	float bayer( ivec2 p ) { return ( BAYER[ ( p.y & 3 ) * 4 + ( p.x & 3 ) ] + 0.5 ) / 16.0; }

	vec3 toSRGB( vec3 c ) { return mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) ); }
	vec3 toLinear( vec3 c ) { return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) ); }

	vec3 oklab( vec3 srgb ) {
		vec3 c = toLinear( srgb );
		vec3 lms = vec3(
			0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
			0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
			0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b );
		lms = pow( max( lms, vec3( 0.0 ) ), vec3( 1.0 / 3.0 ) );
		return vec3(
			0.2104542553 * lms.x + 0.793617785 * lms.y - 0.0040720468 * lms.z,
			1.9779984951 * lms.x - 2.428592205 * lms.y + 0.4505937099 * lms.z,
			0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.808675766 * lms.z );
	}

	bool solid( ivec2 p, ivec2 size ) {
		if ( p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y ) return false;
		return texelFetch( tDepth, p, 0 ).r < 1.0;
	}

	// The nearest palette colour, or the second nearest where the Bayer threshold says the pixel lies
	// far enough towards it.
	vec3 snap( vec3 rgb, float threshold ) {
		if ( paletteSize == 0 ) return rgb;
		vec3 lab = oklab( rgb );
		int first = 0;
		int second = 0;
		float d1 = 1e9;
		float d2 = 1e9;
		for ( int i = 0; i < ${MAX_PALETTE}; i ++ ) {
			if ( i >= paletteSize ) break;
			vec3 d = lab - paletteLab[ i ];
			float e = dot( d, d );
			if ( e < d1 ) {
				d2 = d1;
				second = first;
				d1 = e;
				first = i;
			} else if ( e < d2 ) {
				d2 = e;
				second = i;
			}
		}
		vec3 a = paletteLab[ first ];
		vec3 ab = paletteLab[ second ] - a;
		float t = clamp( dot( lab - a, ab ) / max( dot( ab, ab ), 1e-6 ), 0.0, 1.0 );
		return t > threshold ? paletteRGB[ second ] : paletteRGB[ first ];
	}

	vec4 colorAt( ivec2 p ) {
		vec4 c = texelFetch( tColor, p, 0 );
		return vec4( toSRGB( c.rgb / max( c.a, 1e-4 ) ), c.a );
	}

	// View distance from the depth texture (a perspective camera's near and far).
	float distanceAt( ivec2 p ) {
		float z = texelFetch( tDepth, p, 0 ).r * 2.0 - 1.0;
		return 2.0 * depthRange.x * depthRange.y / ( depthRange.y + depthRange.x - z * ( depthRange.y - depthRange.x ) );
	}

	// RenderPixelatedPass's edges: +1 where faces meet on the nearer side (a crease to light), -1 on a die's
	// border over something further back (to shade), 0 elsewhere. edges: x on, y the distance that counts as
	// a step between dice, z the crease's sensitivity.
	float edgeAt( ivec2 p, ivec2 size ) {
		float depth = distanceAt( p );
		vec3 normal = texelFetch( tNormal, p, 0 ).rgb * 2.0 - 1.0;
		float drop = 0.0;
		float crease = 0.0;
		ivec2 around[ 4 ] = ivec2[ 4 ]( ivec2( 1, 0 ), ivec2( - 1, 0 ), ivec2( 0, 1 ), ivec2( 0, - 1 ) );
		for ( int i = 0; i < 4; i ++ ) {
			ivec2 q = p + around[ i ];
			if ( ! solid( q, size ) ) continue;
			float behind = distanceAt( q ) - depth;
			drop += clamp( behind / edges.y, 0.0, 1.0 );
			vec3 other = texelFetch( tNormal, q, 0 ).rgb * 2.0 - 1.0;
			float facing = smoothstep( - 0.01, 0.01, dot( normal - other, vec3( 1.0 ) ) );
			float nearer = behind > - 0.08 * edges.y ? 1.0 : 0.0;
			crease += ( 1.0 - dot( normal, other ) ) * facing * nearer;
		}
		if ( drop > 0.5 ) return - 1.0;
		return crease > edges.z ? 1.0 : 0.0;
	}

	void main() {
		ivec2 p = ivec2( gl_FragCoord.xy );
		ivec2 size = textureSize( tColor, 0 );
		float threshold = mix( 0.5, bayer( p ), dither );
		if ( ! solid( p, size ) ) {
			if ( outline.a > 0.0 ) {
				ivec2 near = ivec2( - 1 );
				if ( solid( p + ivec2( 1, 0 ), size ) ) near = p + ivec2( 1, 0 );
				else if ( solid( p - ivec2( 1, 0 ), size ) ) near = p - ivec2( 1, 0 );
				else if ( solid( p + ivec2( 0, 1 ), size ) ) near = p + ivec2( 0, 1 );
				else if ( solid( p - ivec2( 0, 1 ), size ) ) near = p - ivec2( 0, 1 );
				if ( near.x >= 0 ) {
					vec3 ink = outline.rgb;
					if ( outline.a > 1.5 ) ink = snap( colorAt( near ).rgb * vec3( 0.22 ), 0.5 );
					gl_FragColor = vec4( ink, 1.0 );
					return;
				}
			}
			float shade = texelFetch( tColor, p, 0 ).a / max( shadowAlpha, 1e-4 );
			gl_FragColor = vec4( 0.0, 0.0, 0.0, shade > mix( 0.5, bayer( p ), 0.9 ) ? shadowAlpha : 0.0 );
			return;
		}
		vec4 c = colorAt( p );
		if ( edges.x > 0.0 ) {
			float edge = edgeAt( p, size );
			if ( edge > 0.0 ) c.rgb = min( c.rgb * 1.45 + 0.12, vec3( 1.0 ) );
			else if ( edge < 0.0 ) c.rgb *= 0.6;
		}
		vec3 rgb = snap( c.rgb, threshold );
		float alpha = c.a > 0.94 ? 1.0 : clamp( floor( c.a * 3.0 + threshold ) / 3.0, 1.0 / 3.0, 1.0 );
		gl_FragColor = vec4( rgb * alpha, alpha );
	}
`

const STAMP_VERTEX = `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
	}
`

const STAMP_FRAGMENT = `
	uniform sampler2D map;
	varying vec2 vUv;
	void main() {
		vec4 c = texture2D( map, vUv );
		gl_FragColor = vec4( c.rgb * c.a, c.a );
	}
`

const BLIT_FRAGMENT = `
	uniform sampler2D tPixels;
	uniform float scale;
	void main() {
		gl_FragColor = texelFetch( tPixels, ivec2( floor( gl_FragCoord.xy / scale ) ), 0 );
	}
`

// Draws the scene's PIXEL_LAYER at 1/scale of the canvas into `target`, snaps it into `output` (post) and
// draws that over the canvas, each low-resolution pixel a scale x scale block. The low-resolution image
// covers whole blocks from the canvas's bottom left corner, so the projection is widened to match and
// the grid never moves.
export class PixelPass {
	constructor() {
		const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false }
		this.target = new THREE.WebGLRenderTarget(1, 1, { ...nearest, colorSpace: THREE.SRGBColorSpace, depthBuffer: true, depthTexture: new THREE.DepthTexture(1, 1) })
		this.output = new THREE.WebGLRenderTarget(1, 1, { ...nearest, depthBuffer: false })
		this.normals = null
		this.normalMaterial = null
		this.hidden = []
		const palette = () => Array.from({ length: MAX_PALETTE }, () => new THREE.Vector3())
		this.post = new THREE.ShaderMaterial({
			vertexShader: QUAD_VERTEX,
			fragmentShader: POST_FRAGMENT,
			uniforms: {
				tColor: { value: this.target.texture },
				tDepth: { value: this.target.depthTexture },
				paletteLab: { value: palette() },
				paletteRGB: { value: palette() },
				paletteSize: { value: 0 },
				dither: { value: PIXEL_DEFAULTS.dither },
				outline: { value: new THREE.Vector4(0, 0, 0, 2) },
				shadowAlpha: { value: 0.5 },
				tNormal: { value: null },
				edges: { value: new THREE.Vector3(0, 1, 0.1) },
				depthRange: { value: new THREE.Vector2(1, 1000) },
			},
			blending: THREE.NoBlending,
			depthTest: false,
			depthWrite: false,
		})
		this.blit = new THREE.ShaderMaterial({
			vertexShader: QUAD_VERTEX,
			fragmentShader: BLIT_FRAGMENT,
			uniforms: { tPixels: { value: this.output.texture }, scale: { value: 1 } },
			transparent: true,
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneMinusSrcAlphaFactor,
			blendSrcAlpha: THREE.OneFactor,
			blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
			depthTest: false,
			depthWrite: false,
		})
		this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post)
		this.quad.frustumCulled = false
		this.quadScene = new THREE.Scene()
		this.quadScene.add(this.quad)
		this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
		this.paletteKey = null
		this.palette = []
		this.stampScene = new THREE.Scene()
		this.stampCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1)
		this.stampGeometry = new THREE.PlaneGeometry(1, 1)
		this.stampMeshes = []
		this.stampLooks = new Map()
		this.point = new THREE.Vector3()
		this.size = new THREE.Vector2()
		this.widen = new THREE.Matrix4()
		this.scale = 1
	}

	// palettes: [{ rgb, lab }] lists, merged in order; outline: "auto", false or a colour. strict: the palette
	// was given as a list, so stamps snap to it too; otherwise they keep their own colours.
	setLook({ palettes, dither, outline, shadowAlpha, strict = false, edges = false, edgeStep = 1 }) {
		this.strict = strict
		const uniforms = this.post.uniforms
		this.edges = edges
		uniforms.edges.value.set(edges ? 1 : 0, edgeStep, 0.03)
		const key = palettes.map(list => list.length + list.map(c => c.rgb.join()).join(";")).join("|")
		if (key !== this.paletteKey) {
			this.paletteKey = key
			const merged = []
			for (const list of palettes) for (const color of list) {
				if (merged.length >= MAX_PALETTE) break
				if (!merged.some(c => Math.hypot(...c.lab.map((v, k) => v - color.lab[k])) < 0.002)) merged.push(color)
			}
			merged.forEach((c, i) => {
				uniforms.paletteLab.value[i].fromArray(c.lab)
				uniforms.paletteRGB.value[i].fromArray(c.rgb)
			})
			uniforms.paletteSize.value = merged.length
			this.palette = merged
		}
		uniforms.dither.value = dither
		const ink = uniforms.outline.value
		if (outline === false || outline === "none") ink.set(0, 0, 0, 0)
		else if (outline === "auto" || outline === true || outline == null) ink.set(0, 0, 0, 2)
		else ink.set(...rgbOf(outline), 1)
		uniforms.shadowAlpha.value = shadowAlpha
	}

	// The nearest palette colour to a CSS colour, as 0 to 255, so a stamp keeps to a given palette.
	snapColor(color) {
		const rgb = rgbOf(color)
		let best = rgb, distance = Infinity
		const lab = oklab(rgb)
		for (const c of this.palette) {
			const d = Math.hypot(...c.lab.map((v, k) => v - lab[k]))
			if (d < distance) {
				distance = d
				best = c.rgb
			}
		}
		return best.map(v => Math.round(v * 255))
	}

	// A stamp's look: its number's mask in its colours, as a texture one texel per pixel.
	stampLook(stamp) {
		const key = [stamp.text, stamp.font.height, stamp.fill, stamp.ring, stamp.strike, this.strict && this.paletteKey].join("|")
		let look = this.stampLooks.get(key)
		if (look) return look
		const m = textMask(stamp.text, stamp.font, false)
		if (stamp.strike) strikeMask(m)
		const color = c => (this.strict ? this.snapColor(c) : rgbOf(c).map(v => Math.round(v * 255)))
		const fill = color(stamp.fill)
		const ring = stamp.ring ? color(stamp.ring) : null
		const data = new Uint8Array(m.width * m.height * 4)
		for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
			const cell = m.mask[y * m.width + x]
			const color = cell === 2 ? fill : cell === 1 ? ring : null
			if (!color) continue
			data.set([...color, 255], ((m.height - 1 - y) * m.width + x) * 4)
		}
		const texture = new THREE.DataTexture(data, m.width, m.height)
		texture.magFilter = texture.minFilter = THREE.NearestFilter
		texture.needsUpdate = true
		const material = new THREE.ShaderMaterial({
			vertexShader: STAMP_VERTEX,
			fragmentShader: STAMP_FRAGMENT,
			uniforms: { map: { value: texture } },
			transparent: true,
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneMinusSrcAlphaFactor,
			blendSrcAlpha: THREE.OneFactor,
			blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
			depthTest: false,
			depthWrite: false,
		})
		if (this.stampLooks.size > 64) this.clearStamps()
		look = { width: m.width, height: m.height, material }
		this.stampLooks.set(key, look)
		return look
	}

	clearStamps() {
		this.stampLooks.forEach(look => {
			look.material.uniforms.map.value.dispose()
			look.material.dispose()
		})
		this.stampLooks.clear()
	}

	// Puts each die's stamp over its up face, snapped to the pixel grid. dice: meshes with a `stamp`.
	placeStamps(dice, camera, W, H, scale, w, h) {
		this.stampCamera.right = w
		this.stampCamera.top = h
		this.stampCamera.updateProjectionMatrix()
		dice.forEach((mesh, i) => {
			let quad = this.stampMeshes[i]
			if (!quad) {
				quad = this.stampMeshes[i] = new THREE.Mesh(this.stampGeometry)
				quad.frustumCulled = false
				this.stampScene.add(quad)
			}
			const look = this.stampLook(mesh.stamp)
			mesh.updateWorldMatrix(true, false)
			const p = this.point.copy(mesh.stamp.point).applyMatrix4(mesh.matrixWorld).project(camera)
			const x = Math.floor((p.x + 1) / 2 * W / scale) - Math.floor(look.width / 2)
			const y = Math.floor((p.y + 1) / 2 * H / scale) - Math.floor(look.height / 2)
			quad.material = look.material
			quad.scale.set(look.width, look.height, 1)
			quad.position.set(x + look.width / 2, y + look.height / 2, 0)
			quad.visible = true
		})
		for (let i = dice.length; i < this.stampMeshes.length; i++) this.stampMeshes[i].visible = false
	}

	// The dice's view-space normals at the pixel resolution, for the edges: only the dice themselves (`dice`),
	// with the table and their children hidden.
	renderNormals(renderer, scene, camera, dice) {
		const { width, height } = this.target
		if (!this.normals) {
			this.normals = new THREE.WebGLRenderTarget(width, height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true })
			this.normalMaterial = new THREE.MeshNormalMaterial()
			this.post.uniforms.tNormal.value = this.normals.texture
		}
		if (this.normals.width !== width || this.normals.height !== height) this.normals.setSize(width, height)
		const keep = new Set(dice)
		this.hidden.length = 0
		scene.traverse(object => {
			if (object.visible && !keep.has(object) && (object.isMesh || object.isPoints || object.isSprite) && object.layers.isEnabled(PIXEL_LAYER)) {
				object.visible = false
				this.hidden.push(object)
			}
		})
		const shadows = renderer.shadowMap.autoUpdate
		try {
			renderer.shadowMap.autoUpdate = false
			scene.overrideMaterial = this.normalMaterial
			renderer.setRenderTarget(this.normals)
			renderer.render(scene, camera)
		} finally {
			scene.overrideMaterial = null
			renderer.shadowMap.autoUpdate = shadows
			this.hidden.forEach(object => { object.visible = true })
		}
		this.post.uniforms.depthRange.value.set(camera.near, camera.far)
	}

	render(renderer, scene, camera, scale, stamped = [], dice = []) {
		renderer.getDrawingBufferSize(this.size)
		const W = Math.max(1, this.size.x), H = Math.max(1, this.size.y)
		const w = Math.ceil(W / scale), h = Math.ceil(H / scale)
		if (this.target.width !== w || this.target.height !== h) {
			this.target.setSize(w, h)
			this.output.setSize(w, h)
		}
		this.scale = scale
		if (stamped.length) this.placeStamps(stamped, camera, W, H, scale, w, h)
		const kx = W / (w * scale), ky = H / (h * scale)
		this.widen.set(kx, 0, 0, kx - 1, 0, ky, 0, ky - 1, 0, 0, 1, 0, 0, 0, 0, 1)
		camera.projectionMatrix.premultiply(this.widen)
		camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
		const previous = renderer.getRenderTarget()
		const autoClear = renderer.autoClear
		try {
			renderer.setRenderTarget(this.target)
			renderer.autoClear = true
			renderer.render(scene, camera)
			if (this.edges) this.renderNormals(renderer, scene, camera, dice)
			this.quad.material = this.post
			renderer.setRenderTarget(this.output)
			renderer.render(this.quadScene, this.quadCamera)
			if (stamped.length) {
				renderer.autoClear = false
				renderer.render(this.stampScene, this.stampCamera)
				renderer.autoClear = true
			}
			this.quad.material = this.blit
			this.blit.uniforms.scale.value = scale
			renderer.setRenderTarget(previous)
			renderer.autoClear = false
			renderer.render(this.quadScene, this.quadCamera)
		} finally {
			renderer.autoClear = autoClear
			renderer.setRenderTarget(previous)
			camera.updateProjectionMatrix()
		}
	}

	dispose() {
		this.target.depthTexture.dispose()
		this.target.dispose()
		this.output.dispose()
		if (this.normals) this.normals.dispose()
		if (this.normalMaterial) this.normalMaterial.dispose()
		this.post.dispose()
		this.blit.dispose()
		this.quad.geometry.dispose()
		this.stampGeometry.dispose()
		this.clearStamps()
	}
}
