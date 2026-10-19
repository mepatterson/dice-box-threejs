// Procedural surfaces, generated once per box and drawn into every face label of a colorset that
// uses them. Each uses its own random numbers, so seeded throws repeat. A surface is a set of
// layers (an alpha mask with a colour, drawn over the body colour; "accent" is the colorset's
// accent or a lighter body colour, "spectrum" a colour per pixel from a hue field) and an optional
// height field drawn faintly into the bump canvas.

function random(seed) {
	return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

// Smooth value noise on a lattice that repeats every `period` units.
function valueNoise(seed, period = 64) {
	const next = random(seed);
	const grid = Float32Array.from({ length: period * period }, next);
	return (x, y) => {
		const xi = Math.floor(x), yi = Math.floor(y);
		let fx = x - xi, fy = y - yi;
		fx = fx * fx * (3 - 2 * fx);
		fy = fy * fy * (3 - 2 * fy);
		const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
		const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
		const a = grid[y0 * period + x0], b = grid[y0 * period + x1];
		const c = grid[y1 * period + x0], d = grid[y1 * period + x1];
		return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
	};
}

function fbm(noise, x, y, octaves) {
	let sum = 0, amp = 0.5, total = 0;
	for (let i = 0; i < octaves; i++) {
		sum += noise(x, y) * amp;
		total += amp;
		x = x * 2.03 + 17.1;
		y = y * 2.03 + 3.7;
		amp *= 0.5;
	}
	return sum / total;
}

const smoothstep = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

function canvasFrom(size, fields) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const context = canvas.getContext('2d');
	const image = context.createImageData(size, size);
	const read = (field, i, fallback) => {
		if (field === null) return fallback;
		return Math.round(Math.min(1, Math.max(0, typeof field == 'number' ? field : field[i])) * 255);
	};
	const [r, g, b, a] = fields;
	for (let i = 0, l = size * size; i < l; i++) {
		image.data[i * 4] = read(r, i, 255);
		image.data[i * 4 + 1] = read(g === undefined ? r : g, i, 255);
		image.data[i * 4 + 2] = read(b === undefined ? r : b, i, 255);
		image.data[i * 4 + 3] = read(a === undefined ? null : a, i, 255);
	}
	context.putImageData(image, 0, 0);
	return canvas;
}

// A fixed colour is baked into its mask; an accent mask stays white and is tinted per colorset.
function tint(color) {
	if (color == 'accent') return [null, null, null];
	const value = parseInt(color.slice(1), 16);
	return [16, 8, 0].map(shift => ((value >> shift) & 255) / 255);
}

// Runs `pixel(u, v, out)` over the square and builds one mask per layer plus the height canvas. A
// layer with `hue` also keeps its alpha and a hue field (0 to 1, wrapping), so it can be coloured per
// pixel by `spectrumLayer`.
function build(size, layers, height, pixel, extra = {}) {
	const masks = layers.map(() => new Float32Array(size * size));
	const hues = layers.map(layer => (layer.hue ? new Uint8ClampedArray(size * size) : null));
	const heights = height ? new Float32Array(size * size) : null;
	const out = { masks: new Float32Array(layers.length), hues: new Float32Array(layers.length), height: 1 };
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			out.masks.fill(0);
			out.height = 1;
			pixel(x / size, y / size, out);
			const i = y * size + x;
			for (let k = 0; k < layers.length; k++) {
				masks[k][i] = out.masks[k];
				if (hues[k]) hues[k][i] = (out.hues[k] - Math.floor(out.hues[k])) * 255;
			}
			if (heights) heights[i] = out.height;
		}
	}
	return {
		...extra,
		layers: layers.map((layer, k) => ({
			...layer,
			mask: canvasFrom(size, [...tint(layer.color == 'spectrum' ? 'accent' : layer.color), masks[k]]),
			...(hues[k] ? { hue: hues[k], alpha: Uint8ClampedArray.from(masks[k], a => a * 255) } : {}),
		})),
		height: heights ? canvasFrom(size, [heights]) : null,
		bump: height || 0,
	};
}

// OKLCH to sRGB bytes, clipped to the gamut, so every hue of a spectrum is equally light.
function oklch(l, c, h) {
	const a = c * Math.cos(h), b = c * Math.sin(h);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const linear = [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
	];
	return linear.map(v => {
		v = Math.min(1, Math.max(0, v));
		return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
	});
}

// The OKLCH hue of a #rrggbb colour, or null for a grey or near-black one.
function hueOf(hex) {
	const value = parseInt(hex.slice(1), 16);
	const [r, g, b] = [16, 8, 0].map(shift => {
		const v = ((value >> shift) & 255) / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return Math.hypot(A, B) < 0.05 ? null : Math.atan2(B, A);
}

// The hues (OKLCH degrees) a full spectrum passes through: mostly blue, green and violet, as in
// precious opal and abalone, with rarer magenta and orange fire and no muddy yellow-green.
const PLAY = [195, 165, 210, 255, 262, 295, 335, 40, 340, 290];

// A layer's hue field in colour: the full spectrum, or, for a coloured accent, the accent's hue
// swinging 70 degrees either way. Lightness and chroma come from the layer. Over a pale body
// (`tone` pale) the colours are softer and thinner, so it stays milky; over a dark opaque one (deep)
// they are lighter and fuller, since no light shows through from behind.
const TONES = { pale: [0, 0.8, 0.75], deep: [0.06, 1, 1.25], clear: [0, 1, 1] };
export function spectrumLayer(layer, accent, tone = 'clear') {
	const centre = accent ? hueOf(accent) : null;
	const [lift, saturation, cover] = TONES[tone];
	const light = (layer.light || 0.7) + lift;
	const chroma = (layer.chroma || 0.15) * saturation;
	const lut = Array.from({ length: 256 }, (_, i) => {
		const t = i / 256;
		if (centre !== null) return oklch(light, chroma, centre + Math.sin(t * Math.PI * 2) * 1.22);
		const p = t * PLAY.length, k = Math.floor(p), f = p - k;
		const a = PLAY[k], b = PLAY[(k + 1) % PLAY.length];
		const d = ((b - a + 540) % 360) - 180;
		return oklch(light, chroma, ((a + d * f * f * (3 - 2 * f)) * Math.PI) / 180);
	});
	const { width, height } = layer.mask;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	const image = context.createImageData(width, height);
	for (let i = 0, l = width * height; i < l; i++) {
		const rgb = lut[layer.hue[i]];
		image.data[i * 4] = rgb[0];
		image.data[i * 4 + 1] = rgb[1];
		image.data[i * 4 + 2] = rgb[2];
		image.data[i * 4 + 3] = layer.alpha[i] * cover;
	}
	context.putImageData(image, 0, 0);
	return canvas;
}

// Warm age staining, fine grain lines, pores stretched along the grain and a few hairline cracks.
function bone(size) {
	const n1 = valueNoise(11), n2 = valueNoise(12), n3 = valueNoise(13), n4 = valueNoise(14);
	return build(size, [{ color: '#6b4a24' }, { color: '#2a1a0c' }], 0.5, (u, v, o) => {
		const mottle = fbm(n1, u * 3, v * 3, 4);
		const grain = fbm(n2, u * 5, v * 48, 3);
		const lines = n2(u * 9 + 40, v * 160);
		const pores = smoothstep(0.88, 0.98, n3(u * 230 + grain * 6, v * 70));
		const crackRidge = 1 - Math.abs(2 * fbm(n4, u * 4 + mottle, v * 4, 5) - 1);
		const crack = smoothstep(0.988, 0.998, crackRidge) * smoothstep(0.6, 0.75, n1(u * 2 + 9, v * 2 + 4));
		o.masks[0] = 0.07 * smoothstep(0.4, 0.8, mottle) + 0.06 * smoothstep(0.45, 0.75, grain) + 0.05 * smoothstep(0.55, 0.8, lines);
		o.masks[1] = 0.22 * pores + 0.16 * crack;
		o.height = 0.94 + 0.06 * mottle - 0.04 * grain - 0.4 * pores - 0.3 * crack;
	});
}

// Marbling: bands of a warped gradient, so they flow and fold like poured resin. Crisp ribbons of
// the accent colour, a soft haze of it beside them and thin dark veins.
function swirl(size) {
	const n1 = valueNoise(21), n2 = valueNoise(22), n3 = valueNoise(23), n4 = valueNoise(24);
	return build(size, [{ color: 'accent' }, { color: '#000000' }], 0, (u, v, o) => {
		const x = u * 2, y = v * 2;
		const qx = fbm(n1, x, y, 3), qy = fbm(n2, x + 5.2, y + 1.3, 3);
		const t = (u + v) * 1.6 + 1.8 * fbm(n3, x + 2.5 * qx, y + 2.5 * qy, 4);
		const band = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2.2);
		const fade = smoothstep(0.3, 0.6, fbm(n4, x * 1.5, y * 1.5, 2));
		const ribbon = smoothstep(0.8, 0.86, band) * (0.55 + 0.45 * fade);
		const haze = smoothstep(0.35, 0.8, band) * 0.3 * fade;
		o.masks[0] = Math.max(ribbon * 0.95, haze);
		o.masks[1] = 0.18 * (1 - smoothstep(0.0, 0.05, Math.abs(band - 0.12))) * (1 - fade * 0.5);
	});
}

// Granite: dark and light mineral grains over a fine speckle, a faint tonal drift and pale veins.
function stone(size) {
	const n1 = valueNoise(31, 128), n2 = valueNoise(32, 128), n3 = valueNoise(33, 128), n4 = valueNoise(34);
	return build(size, [{ color: '#000000' }, { color: '#ffffff' }], 0.55, (u, v, o) => {
		const drift = fbm(n4, u * 2.5, v * 2.5, 3);
		const dark = smoothstep(0.66, 0.8, fbm(n1, u * 100, v * 100, 2));
		const light = smoothstep(0.66, 0.8, fbm(n2, u * 90 + 9, v * 90 + 4, 2));
		const fine = n3(u * 200, v * 200);
		const vein = smoothstep(0.95, 0.99, 1 - Math.abs(2 * fbm(n4, u * 3 + 7 + drift * 1.5, v * 3, 5) - 1));
		o.masks[0] = 0.45 * dark + 0.12 * fine + 0.12 * smoothstep(0.4, 0.7, drift);
		o.masks[1] = 0.3 * light * (1 - dark) + 0.2 * vein;
		o.height = 0.86 + 0.12 * drift - 0.28 * dark + 0.06 * light - 0.1 * fine;
	});
}

// Nacre: soft wavy sheets of a lighter tone with faint shadows between them. With `rainbow` the
// sheets take their colour from a slow hue field instead of the accent.
function pearl(size) {
	const n1 = valueNoise(41), n2 = valueNoise(42), n3 = valueNoise(43);
	return build(size, [{ color: 'accent', hue: true, light: 0.8, chroma: 0.09 }, { color: '#000000' }, { color: '#f0bfd2' }, { color: '#bfe3d6' }], 0, (u, v, o) => {
		const w = fbm(n1, u * 2, v * 2, 4);
		const f = fbm(n2, u * 3 + w * 2.5, v * 3, 4);
		const sheet = 0.5 + 0.5 * Math.sin(f * 26);
		const hue = fbm(n3, u * 2.5 + 3, v * 2.5, 3);
		o.hues[0] = hue * 2.6 + f * 0.8;
		o.masks[0] = 0.15 + 0.45 * smoothstep(0.2, 0.9, sheet);
		o.masks[1] = 0.08 * (1 - sheet);
		o.masks[2] = 0.22 * smoothstep(0.5, 0.7, hue) * sheet;
		o.masks[3] = 0.16 * (1 - smoothstep(0.3, 0.5, hue)) * sheet;
	});
}

// Precious opal and abalone: pearl's flowing sheets, each sweeping through the spectrum along a slow
// hue field that also shifts across the sheets, brighter where a patch catches the light, with small
// flecks of fire in their own colours and faint dark seams. Strong enough to read inside glass.
function opal(size) {
	const n1 = valueNoise(61), n2 = valueNoise(62), n3 = valueNoise(63), n4 = valueNoise(64, 128), n5 = valueNoise(65);
	return build(size, [{ color: 'spectrum', hue: true, light: 0.74, chroma: 0.18 }, { color: 'spectrum', hue: true, light: 0.9, chroma: 0.12 }, { color: '#000000' }], 0, (u, v, o) => {
		const w = fbm(n1, u * 2.5, v * 2.5, 4);
		const f = fbm(n2, u * 3.2 + w * 2.5, v * 3.2, 4);
		const sheet = 0.5 + 0.5 * Math.sin(f * 24);
		const patch = smoothstep(0.35, 0.65, fbm(n5, u * 3 + w, v * 3, 3));
		const hue = fbm(n3, u * 1.3 + w, v * 1.3, 3) * 2 + f * 0.7;
		const fleck = smoothstep(0.86, 0.95, n4(u * 30, v * 30)) * patch;
		o.hues[0] = hue;
		o.masks[0] = (0.2 + 0.8 * smoothstep(0.25, 0.95, sheet)) * (0.45 + 0.55 * patch);
		o.hues[1] = hue + 0.05;
		o.masks[1] = fleck;
		o.masks[2] = 0.12 * smoothstep(0.7, 1, 1 - sheet) * (1 - patch);
	}, { glass: 1 });
}

// Volcanic glass: tiny bright flecks and faint silvery sheen bands.
function obsidian(size) {
	const n1 = valueNoise(51, 128), n2 = valueNoise(52), n3 = valueNoise(53);
	return build(size, [{ color: '#d8dde6' }], 0, (u, v, o) => {
		const fleck = smoothstep(0.86, 0.96, n1(u * 150, v * 150)) * smoothstep(0.35, 0.6, n3(u * 6, v * 6));
		const f = fbm(n2, u * 1.5, v * 9, 4);
		o.masks[0] = 0.8 * fleck + 0.07 * smoothstep(0.55, 0.75, f);
	});
}

// A tileable wood grain, grey around mid-level, overlaid on the body colour of wood dice that have
// no texture.
export function woodGrain(size = 256) {
	let seed = 7;
	const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const knots = Array.from({ length: 64 }, next);
	const noise = t => {
		const i = Math.floor(t), f = t - i, a = knots[((i % 64) + 64) % 64], b = knots[(((i + 1) % 64) + 64) % 64];
		return a + (b - a) * f * f * (3 - 2 * f);
	};
	const field = new Float32Array(size * size);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const u = x / size, v = y / size;
			const warp = Math.sin((u + noise(v * 4) * 0.4) * Math.PI * 2) * 0.05 + (noise(u * 8 + 20) - 0.5) * 0.06;
			const ring = (v + warp) * 7 + noise(u * 3) * 0.6;
			const f = ring - Math.floor(ring);
			const late = Math.pow(Math.sin(f * Math.PI), 6);
			const streak = noise((v + warp) * 90 + 5) - 0.5;
			field[y * size + x] = 0.54 - 0.17 * late + 0.14 * streak + 0.04 * (noise(u * 40 + v * 7) - 0.5);
		}
	}
	return canvasFrom(size, [field]);
}

const GENERATORS = { bone, swirl, stone, pearl, opal, obsidian };

export function makeSurface(name, size = 512) {
	const generate = GENERATORS[name];
	return generate ? generate(size) : null;
}
