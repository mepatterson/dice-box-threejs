import * as THREE from "three"

// Particles off the dice (a colorset's `trails` and `impacts`): trails behind fast dice, bursts where they hit the
// table, a wall or each other (the same impacts onImpact reports, sized by their speed), a ring where each die comes to
// rest, a big burst over a throw's dice on a crit and a fizzle on a fumble (the throw's `flourish`), and arcs between
// crackling dice that pass close. Each die's kind is its colorset's pick or, with "theme", matched to its look:
// embers off lava, frost off icy glass and snow, leaves off moss and growth, glitter off sparkles, sparks off metal,
// dust off stone, bone, wood and leather, splashes off a liquid, crackle off storm and lightning, glints off the rest.
// Every particle on the table lives in one pool (`DiceParticles`): capped by device, simulated on the CPU (a few
// hundred at most) and drawn as one THREE.Points of shaped, premultiplied sprites. None lives past about a second, so a
// table at rest has nothing left to draw. A splash also leaves splotches, flat ragged blots in the liquid's colour on the
// table that hold for several seconds and fade; they take at most BLOT_SHARE of the pool, the oldest going first, and
// while only they are left the box redraws a few times a second (`DiceParticles.fast`). Under prefers-reduced-motion
// they appear and fade where they are.

export const PARTICLE_KINDS = ['embers', 'frost', 'leaves', 'glitter', 'sparks', 'dust', 'splash', 'crackle', 'glints']
// The most particles alive at once, by device.
export const PARTICLE_BUDGETS = { desktop: 700, tablet: 450, phone: 260 }
const SHAPE = { dot: 0, star: 1, leaf: 2, streak: 3, blot: 4 }
// A splotch is not a kind a colorset picks: it is what a splash leaves. It holds for the first `hold` of its life
// (a share, 0 to 1), then fades.
const BLOT = 'splotch'
const KIND_NAMES = [...PARTICLE_KINDS, BLOT]
// The share of the pool splotches may take, their sizes (times a die's radius) and the fps the box redraws at while
// only splotches are left.
export const BLOT_SHARE = 0.3
const BLOT_SIZES = [0.7, 1, 1.4]
export const BLOT_FPS = 6
// Per kind, in die radii and seconds: sprite shape, size, life, launch speed, upward pull (negative falls), drag,
// growth over its life, spin, twinkle, positional jitter per frame, and the colours it takes without a theme's.
// bounce: what is kept of the speed off the table.
const KINDS = {
	embers: { shape: 'dot', size: [0.12, 0.24], life: [0.5, 0.95], speed: [0.8, 2.2], up: 1.2, drag: 1.8, twinkle: 0.5, colors: ['#FFB347', '#FF7A1F', '#FFD27A'] },
	frost: { shape: 'star', size: [0.14, 0.24], life: [0.5, 0.9], speed: [0.6, 1.8], up: -0.3, drag: 2.5, twinkle: 0.6, colors: ['#FFFFFF', '#D6F1FF', '#A8DCFF'] },
	leaves: { shape: 'leaf', size: [0.2, 0.34], life: [0.7, 1.0], speed: [0.6, 1.7], up: -1.0, drag: 2.2, spin: 7, colors: ['#5E8C31', '#86B34A', '#3E6B22', '#9C7A3C'] },
	glitter: { shape: 'star', size: [0.1, 0.18], life: [0.4, 0.8], speed: [1, 2.6], up: -1.5, drag: 2, twinkle: 1, colors: ['#FFFFFF', '#FFD9F2', '#C8E8FF'] },
	sparks: { shape: 'streak', size: [0.16, 0.28], life: [0.25, 0.55], speed: [2.5, 5.5], up: -6, drag: 0.8, bounce: 0.4, colors: ['#FFF6D8', '#FFD27A', '#FF9A3C'] },
	dust: { shape: 'dot', size: [0.18, 0.36], life: [0.5, 0.95], speed: [0.4, 1.3], up: -0.1, drag: 3.5, grow: 1.6, alpha: 0.55, colors: ['#B8A890', '#8C7E6A', '#D8CCB8'] },
	splash: { shape: 'dot', size: [0.09, 0.16], life: [0.35, 0.65], speed: [1.6, 3.4], up: -7, drag: 0.5, bounce: 0.2, colors: ['#4FA8E0', '#9AD2F2', '#FFFFFF'] },
	crackle: { shape: 'star', size: [0.14, 0.26], life: [0.1, 0.3], speed: [0.5, 2], up: 0, drag: 4, jitter: 0.12, twinkle: 1, colors: ['#9FD8FF', '#FFFFFF', '#6FB8FF'] },
	glints: { shape: 'star', size: [0.18, 0.32], life: [0.25, 0.5], speed: [0.2, 0.9], up: 0, drag: 3, twinkle: 0.8, colors: ['#FFFFFF', '#FFF2D6'] },
	splotch: { shape: 'blot', size: [0.5, 0.6], life: [4, 6], speed: [0, 0], up: 0, drag: 10, grow: 0.12, alpha: 0.8, hold: 0.4, colors: ['#4FA8E0'] },
}
// Trails: dice faster than `min` radii per second shed up to `rate` particles a second, at full rate from `full`.
const TRAIL = { min: 8, full: 30, rate: 45 }
// Bursts: an impact of speed s (0 to 1) throws `least + most * s` particles; slower than `quiet` throws none.
const BURST = { least: 3, most: 18, quiet: 0.06 }
const BLOT_QUIET = 0.15
const RING = 18
const CRIT = 70
const FIZZLE = 14
const ARC = { reach: 3.2, every: 0.07, points: 20 }

const pick = (list, r = Math.random()) => list[Math.floor(r * list.length) % list.length]
const between = ([a, b], r = Math.random()) => a + (b - a) * r

// A die's particles from its colorset: { trails, impacts } kinds (or null), their colours and the amount, or null for
// none. look: what the die is made of, for "theme".
export function particleLook(colordata, look) {
	const kindOf = value => (value === 'theme' ? matchKind(look) : PARTICLE_KINDS.includes(value) ? value : null)
	const trails = kindOf(colordata.trails)
	const impacts = kindOf(colordata.impacts)
	if (!trails && !impacts) return null
	const amount = Number(colordata.particle_amount)
	const colors = {}
	for (const kind of new Set([trails, impacts].filter(Boolean))) colors[kind] = kindColors(kind, look)
	return { trails, impacts, colors, amount: Number.isFinite(amount) && colordata.particle_amount !== '' && colordata.particle_amount !== null ? Math.max(0, Math.min(2, amount)) : 1 }
}

// The kind that suits a die's look.
export function matchKind({ material, texture = {}, inner, liquid, body }) {
	const surface = texture.surface || ''
	if (liquid) return 'splash'
	if (texture.storm || inner == 'lightning') return 'crackle'
	if (texture.lava || inner == 'embers') return 'embers'
	if (surface == 'moss' || surface == 'growth') return 'leaves'
	if (surface == 'sparkles' || surface == 'opal' || inner == 'galaxy') return 'glitter'
	if (inner == 'snow' || inner == 'blizzard' || /ice/i.test(texture.name || '') || (material == 'glass' && icy(body))) return 'frost'
	if (material == 'energy' || material == 'neon' || inner == 'maelstrom') return 'glints'
	if (/metal/.test(material || '')) return 'sparks'
	if (material == 'wood' || ['stone', 'bone', 'leather', 'obsidian', 'swirl', 'pearl'].includes(surface)) return 'dust'
	return material == 'glass' ? 'glints' : 'dust'
}

// A pale blue or cyan body.
function icy(color) {
	if (!color || typeof color != 'string') return false
	const hsl = new THREE.Color(color).getHSL({})
	return hsl.h > 0.47 && hsl.h < 0.64 && hsl.l > 0.55 && hsl.s > 0.15
}

const hex = color => {
	try { return new THREE.Color(color) } catch { return null }
}

function kindColors(kind, { accent, body, liquidColor, texture = {} }) {
	const a = accent && hex(accent)
	const lighter = (c, k) => c.clone().lerp(new THREE.Color(1, 1, 1), k)
	let colors
	if (kind == 'embers' && a) colors = [a, lighter(a, 0.35), new THREE.Color('#FFD27A')]
	else if (kind == 'leaves' && texture.surface == 'growth' && a) colors = [a, a.clone().multiplyScalar(0.6), lighter(a, 0.25), new THREE.Color('#9C7A3C')]
	else if (kind == 'glitter' && a) {
		const hsl = a.getHSL({})
		colors = [a, new THREE.Color().setHSL((hsl.h + 0.1) % 1, hsl.s, Math.min(0.8, hsl.l + 0.1)), new THREE.Color().setHSL((hsl.h + 0.9) % 1, hsl.s, Math.min(0.8, hsl.l + 0.1)), new THREE.Color(1, 1, 1)]
	} else if (kind == 'dust' && body && hex(body)) {
		const b = hex(body).lerp(new THREE.Color(0.55, 0.52, 0.48), 0.45)
		colors = [b, b.clone().multiplyScalar(0.75), lighter(b, 0.3)]
	} else if (kind == 'splash' && (liquidColor || a)) {
		const c = hex(liquidColor || accent)
		colors = [c, lighter(c, 0.4), lighter(c, 0.8)]
	} else if (kind == 'crackle' && a) colors = [a, lighter(a, 0.5), new THREE.Color(1, 1, 1)]
	else if (kind == 'glints' && a) colors = [new THREE.Color(1, 1, 1), lighter(a, 0.5)]
	return colors || KINDS[kind].colors.map(c => new THREE.Color(c))
}

const VERTEX = `
	attribute vec4 tint;
	attribute vec3 look;
	uniform float pointScale;
	varying vec4 vTint;
	varying vec2 vLook;
	void main() {
		vec4 mv = modelViewMatrix * vec4( position, 1.0 );
		gl_Position = projectionMatrix * mv;
		gl_PointSize = clamp( look.x * pointScale / max( - mv.z, 1.0 ), 1.0, 128.0 );
		vTint = tint;
		vLook = look.yz;
	}`

const FRAGMENT = `
	varying vec4 vTint;
	varying vec2 vLook;
	void main() {
		vec2 p = gl_PointCoord * 2.0 - 1.0;
		p.y = - p.y;
		float c = cos( vLook.y ), s = sin( vLook.y );
		p = vec2( c * p.x + s * p.y, - s * p.x + c * p.y );
		float r = length( p );
		float a;
		if ( vLook.x < 0.5 ) a = pow( max( 1.0 - r, 0.0 ), 1.5 );
		else if ( vLook.x < 1.5 ) a = max( exp( - r * r * 10.0 ), 0.85 * ( exp( - abs( p.x ) * 14.0 - abs( p.y ) * 2.4 ) + exp( - abs( p.y ) * 14.0 - abs( p.x ) * 2.4 ) ) );
		else if ( vLook.x < 2.5 ) a = smoothstep( 1.0, 0.8, length( p * vec2( 1.0, 2.4 ) ) ) * ( 1.0 - 0.35 * smoothstep( 0.08, 0.0, abs( p.y ) ) );
		else if ( vLook.x < 3.5 ) a = pow( max( 1.0 - length( p * vec2( 1.0, 3.2 ) ), 0.0 ), 1.2 );
		else {
			float th = atan( p.y, p.x );
			float edge = 0.6 + 0.13 * sin( 3.0 * th + 1.0 ) + 0.09 * sin( 5.0 * th + 2.3 ) + 0.06 * sin( 9.0 * th + 0.7 ) + 0.035 * sin( 15.0 * th );
			a = smoothstep( edge + 0.05, edge - 0.03, r );
			a = max( a, smoothstep( 0.19, 0.13, length( p - vec2( 0.68, 0.46 ) ) ) );
			a = max( a, smoothstep( 0.13, 0.08, length( p - vec2( - 0.62, - 0.52 ) ) ) );
			a *= 0.88 + 0.12 * smoothstep( 0.0, 0.5, r );
		}
		a *= vTint.a;
		if ( a < 0.004 ) discard;
		gl_FragColor = vec4( vTint.rgb, min( a, 1.0 ) );
		#include <colorspace_fragment>
		#include <premultiplied_alpha_fragment>
	}`

// The shared pool and its Points.
export class DiceParticles {
	constructor(budget, pointScale) {
		this.budget = budget
		this.live = 0
		this.pos = new Float32Array(budget * 3)
		this.vel = new Float32Array(budget * 3)
		this.color = new Float32Array(budget * 3)
		this.state = new Float32Array(budget * 8) // age, life, size, unit, angle, seed, kind, alpha
		this.tint = new Float32Array(budget * 4)
		this.look = new Float32Array(budget * 3)
		this.kinds = KIND_NAMES.map(name => KINDS[name])
		this.fast = false
		const geometry = new THREE.BufferGeometry()
		this.positions = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)
		this.tints = new THREE.BufferAttribute(this.tint, 4).setUsage(THREE.DynamicDrawUsage)
		this.looks = new THREE.BufferAttribute(this.look, 3).setUsage(THREE.DynamicDrawUsage)
		geometry.setAttribute('position', this.positions)
		geometry.setAttribute('tint', this.tints)
		geometry.setAttribute('look', this.looks)
		geometry.setDrawRange(0, 0)
		this.material = new THREE.ShaderMaterial({
			uniforms: { pointScale },
			vertexShader: VERTEX,
			fragmentShader: FRAGMENT,
			transparent: true,
			premultipliedAlpha: true,
			depthTest: false,
			depthWrite: false,
		})
		this.points = new THREE.Points(geometry, this.material)
		this.points.frustumCulled = false
		// under the dice: they lie over what flies off them, as a die near the table would
		this.points.renderOrder = -1
		this.points.visible = false
		this.points.raycast = () => {}
		this.arcs = new Map()
	}

	// One particle of `kind` (a name), in one of `colors`, at a point with a velocity (world units), for a die of radius
	// `unit`; null when the pool is full.
	spawn(kind, colors, unit, x, y, z, vx, vy, vz, { life = 1, size = 1, alpha = 1, gray = 0 } = {}) {
		if (this.live >= this.budget) return null
		const k = KIND_NAMES.indexOf(kind)
		if (kind !== BLOT) this.fast = true
		const spec = KINDS[kind]
		const i = this.live++
		this.pos.set([x, y, z], i * 3)
		this.vel.set([vx, vy, vz], i * 3)
		const c = pick(colors)
		const g = (c.r + c.g + c.b) / 3 * 0.8
		this.color.set([c.r + (g - c.r) * gray, c.g + (g - c.g) * gray, c.b + (g - c.b) * gray], i * 3)
		this.state.set([0, between(spec.life) * life, between(spec.size) * size * unit, unit, Math.random() * Math.PI * 2, Math.random(), k, (spec.alpha ?? 1) * alpha], i * 8)
		return i
	}

	// A splotch of `colors[0]` flat on the table at x, y, sized by `strength` (0 to 1) in one of a few sizes. When the pool
	// or the splotches' share of it is full the oldest splotch goes; null when there is none to go.
	splotch(colors, unit, x, y, strength = 0.5, { life = 1, alpha = 1 } = {}) {
		let count = 0, oldest = -1, age = -1
		for (let i = 0; i < this.live; i++) {
			if (this.state[i * 8 + 6] !== KIND_NAMES.length - 1) continue
			count++
			if (this.state[i * 8] > age) { age = this.state[i * 8]; oldest = i }
		}
		if (count >= Math.floor(this.budget * BLOT_SHARE) || this.live >= this.budget) {
			if (oldest < 0) return null
			this.remove(oldest)
		}
		return this.spawn(BLOT, [colors[0]], unit, x, y, 0.02 * unit, 0, 0, 0, { life, alpha, size: pick(BLOT_SIZES) * (0.6 + 0.8 * strength) })
	}

	// `n` particles from a point, flung at the kind's speed times `speed`: outwards across the table from `centre` when
	// given (as from under a die), otherwise every way.
	burst(kind, colors, unit, point, n, { speed = 1, centre = null, lift = 0.4, ...options } = {}) {
		const spec = KINDS[kind]
		for (let j = 0; j < n; j++) {
			let dx, dy, dz
			if (centre) {
				const a = Math.random() * Math.PI * 2
				dx = Math.cos(a)
				dy = Math.sin(a)
				dz = lift * Math.random()
			} else {
				dz = Math.random() * 2 - 1
				const a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - dz * dz)
				dx = Math.cos(a) * s
				dy = Math.sin(a) * s
			}
			const v = between(spec.speed) * speed * unit
			const x = centre ? centre.x + dx * unit * 0.85 : point.x
			const y = centre ? centre.y + dy * unit * 0.85 : point.y
			if (this.spawn(kind, colors, unit, x, y, Math.max(point.z, 0.05 * unit), dx * v, dy * v, Math.abs(dz) * v, options) === null) return
		}
	}

	// A ring of particles round a die that has just come to rest, spreading outwards along the table.
	ring(kind, colors, unit, x, y, n = RING, { speed = 1.6, ...options } = {}) {
		for (let j = 0; j < n; j++) {
			const a = (j + Math.random() * 0.4) / n * Math.PI * 2
			const dx = Math.cos(a), dy = Math.sin(a)
			if (this.spawn(kind, colors, unit, x + dx * unit * 0.9, y + dy * unit * 0.9, 0.08 * unit, dx * speed * unit, dy * speed * unit, 0, { life: 0.7, ...options }) === null) return
		}
	}

	// A trail behind a die at p moving at v (world units a second) over dt seconds.
	trail(look, unit, p, v, dt) {
		const kind = look.trails
		const speed = Math.hypot(v.x, v.y, v.z) / unit
		if (speed < TRAIL.min) return
		const rate = TRAIL.rate * look.amount * Math.min(1, (speed - TRAIL.min) / (TRAIL.full - TRAIL.min))
		look.carry = (look.carry || 0) + rate * dt
		const spec = KINDS[kind]
		const s = speed * unit
		while (look.carry >= 1) {
			look.carry -= 1
			const back = 0.6 + 0.5 * Math.random()
			const x = p.x - v.x / s * unit * back + (Math.random() - 0.5) * unit * 0.6
			const y = p.y - v.y / s * unit * back + (Math.random() - 0.5) * unit * 0.6
			const z = Math.max(0.1 * unit, p.z - v.z / s * unit * back)
			const spread = between(spec.speed) * unit * 0.5
			const a = Math.random() * Math.PI * 2
			if (kind == 'splash' && Math.random() < 0.12) this.splotch(look.colors[kind], unit, x, y, 0.2, { alpha: 0.7 })
			if (this.spawn(kind, look.colors[kind], unit, x, y, z, v.x * 0.06 + Math.cos(a) * spread, v.y * 0.06 + Math.sin(a) * spread, Math.random() * spread * 0.5, { life: 0.8, size: 0.8 }) === null) return
		}
	}

	// A die's impact: a burst sized by the impact's speed (0 to 1), out from under it on the table, or every way off
	// another die.
	impact(look, unit, point, speed, centre = null) {
		if (speed < BURST.quiet) return
		const n = Math.round((BURST.least + BURST.most * speed) * look.amount)
		this.burst(look.impacts, look.colors[look.impacts], unit, point, n, { speed: 0.6 + 0.8 * speed, centre })
		if (look.impacts == 'splash' && speed > BLOT_QUIET) {
			const blots = Math.max(1, Math.round((1 + 2 * speed) * look.amount))
			for (let j = 0; j < blots; j++) {
				const a = Math.random() * Math.PI * 2, d = (j ? 0.5 + Math.random() : 0) * unit
				this.splotch(look.colors.splash, unit, point.x + Math.cos(a) * d, point.y + Math.sin(a) * d, speed)
			}
		}
	}

	settle(look, unit, x, y) {
		this.ring(look.impacts, look.colors[look.impacts], unit, x, y, Math.round(RING * look.amount))
		if (look.impacts == 'splash') for (let j = 0; j < 2; j++) {
			const a = Math.random() * Math.PI * 2
			this.splotch(look.colors.splash, unit, x + Math.cos(a) * unit * 1.1, y + Math.sin(a) * unit * 1.1, 0.4)
		}
	}

	// A crit's spectacle: a big burst every way over the die and a wide ring; a fumble's fizzle: a few greyed particles
	// that barely leave it and droop.
	flourish(look, unit, p, type) {
		const kind = look.impacts, colors = look.colors[kind]
		if (type == 'crit') {
			this.burst(kind, colors, unit, { x: p.x, y: p.y, z: p.z + unit * 0.6 }, Math.round(CRIT * look.amount), { speed: 1.8, life: 1, size: 1.2 })
			this.ring(kind, colors, unit, p.x, p.y, Math.round(RING * 1.5 * look.amount), { speed: 3, size: 1.2 })
		} else if (type == 'fumble') {
			for (let j = 0; j < Math.round(FIZZLE * Math.max(0.5, look.amount)); j++) {
				const a = Math.random() * Math.PI * 2, v = (0.3 + 0.5 * Math.random()) * unit
				if (this.spawn(kind, colors, unit, p.x + Math.cos(a) * unit * 0.5, p.y + Math.sin(a) * unit * 0.5, p.z + unit * 0.5, Math.cos(a) * v, Math.sin(a) * v, -v * 0.5, { life: 1.1, size: 0.9, gray: 0.75, alpha: 0.7 }) === null) return
			}
		}
	}

	// An arc between two crackling dice passing close (centres a and b, radii ra and rb), drawn anew every ARC.every
	// seconds while they are near: points along a bolt by midpoint displacement, gone in a blink.
	arc(key, look, a, ra, b, rb, now) {
		const unit = (ra + rb) / 2
		const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
		if (d > ARC.reach * unit || d < 1e-6) return
		if (now - (this.arcs.get(key) ?? -Infinity) < ARC.every) return
		this.arcs.set(key, now)
		const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d, uz = (b.z - a.z) / d
		const from = { x: a.x + ux * ra * 0.8, y: a.y + uy * ra * 0.8, z: a.z + uz * ra * 0.8 }
		const to = { x: b.x - ux * rb * 0.8, y: b.y - uy * rb * 0.8, z: b.z - uz * rb * 0.8 }
		const offsets = new Float32Array(ARC.points + 1)
		const span = (lo, hi, amp) => {
			if (hi - lo < 2) return
			const mid = (lo + hi) >> 1
			offsets[mid] = (offsets[lo] + offsets[hi]) / 2 + (Math.random() - 0.5) * amp
			span(lo, mid, amp / 2)
			span(mid, hi, amp / 2)
		}
		span(0, ARC.points, d * 0.35)
		const px = -uy, py = ux
		for (let j = 0; j <= ARC.points; j++) {
			const t = j / ARC.points
			if (this.spawn('crackle', look.colors.crackle || KINDS.crackle.colors.map(c => new THREE.Color(c)), unit * 0.8,
				from.x + (to.x - from.x) * t + px * offsets[j], from.y + (to.y - from.y) * t + py * offsets[j], from.z + (to.z - from.z) * t, 0, 0, 0, { life: 0.5 }) === null) return
		}
	}

	// Ages, moves and fades every particle by dt seconds (moving none when `still`) and fills the buffers. Returns
	// whether any is left.
	update(dt, still = false) {
		const { pos, vel, state, color, tint, look } = this
		let i = 0, fast = false
		while (i < this.live) {
			const s = i * 8
			state[s] += dt
			if (state[s] >= state[s + 1]) {
				this.remove(i)
				continue
			}
			const spec = this.kinds[state[s + 6]]
			if (spec.shape != 'blot') fast = true
			const unit = state[s + 3]
			const p = i * 3
			if (!still && spec.shape != 'blot') {
				const drag = Math.exp(-spec.drag * dt)
				vel[p] *= drag
				vel[p + 1] *= drag
				vel[p + 2] = vel[p + 2] * drag + spec.up * unit * dt
				pos[p] += vel[p] * dt
				pos[p + 1] += vel[p + 1] * dt
				pos[p + 2] += vel[p + 2] * dt
				if (pos[p + 2] < 0.02 * unit) {
					pos[p + 2] = 0.02 * unit
					vel[p + 2] = Math.abs(vel[p + 2]) * (spec.bounce || 0)
				}
				if (spec.spin) state[s + 4] += spec.spin * (state[s + 5] - 0.5) * 2 * dt
				if (spec.jitter) {
					pos[p] += (Math.random() - 0.5) * spec.jitter * unit
					pos[p + 1] += (Math.random() - 0.5) * spec.jitter * unit
				}
				if (spec.shape == 'streak') state[s + 4] = Math.atan2(vel[p + 1], vel[p])
			}
			const t = state[s] / state[s + 1]
			let alpha = Math.min(1, t * 12) * Math.pow(1 - t, 1.2) * state[s + 7]
			if (spec.hold) {
				const fade = Math.min(1, Math.max(0, (t - spec.hold) / (1 - spec.hold)))
				alpha = Math.min(1, t * 25) * (1 - fade * fade * (3 - 2 * fade)) * state[s + 7]
			}
			if (spec.twinkle && !still) alpha *= 1 - spec.twinkle * 0.5 * (1 + Math.sin(state[s] * 38 + state[s + 5] * 60)) * 0.5
			tint.set([color[p], color[p + 1], color[p + 2], alpha], i * 4)
			look.set([state[s + 2] * (1 + (spec.grow || 0) * t), SHAPE[spec.shape], state[s + 4]], p)
			i++
		}
		this.fast = fast
		const geometry = this.points.geometry
		geometry.setDrawRange(0, this.live)
		for (const attribute of [this.positions, this.tints, this.looks]) {
			attribute.clearUpdateRanges()
			attribute.addUpdateRange(0, this.live * attribute.itemSize)
			attribute.needsUpdate = true
		}
		this.points.visible = this.live > 0
		if (!this.live) this.arcs.clear()
		return this.live > 0
	}

	remove(i) {
		const last = --this.live
		if (i === last) return
		this.pos.copyWithin(i * 3, last * 3, last * 3 + 3)
		this.vel.copyWithin(i * 3, last * 3, last * 3 + 3)
		this.color.copyWithin(i * 3, last * 3, last * 3 + 3)
		this.state.copyWithin(i * 8, last * 8, last * 8 + 8)
	}

	clear() {
		this.live = 0
		this.arcs.clear()
		this.points.geometry.setDrawRange(0, 0)
		this.points.visible = false
	}

	dispose() {
		this.points.geometry.dispose()
		this.material.dispose()
	}
}
