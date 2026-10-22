import * as THREE from "three"
import * as CANNON from "cannon-es"

import { DiceNotation } from './DiceNotation.js';
import { DiceFactory, isMetal } from './DiceFactory.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { DiceColors } from './DiceColors.js';
import { fontOf, loadFont } from './fonts.js';
import { THEMES } from './const/themes.js';
import { MATERIALTYPES } from './const/materialtypes.js';
// import CannonDebugger from 'cannon-es-debugger'

import { debounce } from "./helpers"

const defaultConfig = {
	assetPath: "./",
	framerate: (1/60),
	sounds: false,
	volume: 100,
	color_spotlight: 0xefdfd5,
	shadows: true,
	theme_surface:  "green-felt",
	sound_dieMaterial: 'plastic',
	theme_customColorset: null,
	theme_colorset: "white",
	theme_texture: "",
	theme_material: "glass",
	gravity_multiplier: 400,
	// How lively the dice are: bounce off the table, the walls and each other, friction, how fast
	// they lose speed in the air, and how long they must stay slow to count as settled (seconds).
	restitution: { desk: 0.5, wall: 1.0, dice: 0.5 },
	friction: 0.6,
	damping: 0.1,
	settleTime: 0.9,
	light_intensity: 0.7,
	baseScale: 100,
	strength: 1,
	iterationLimit: 1000,
	maxPixelRatio: 2,
	rollingPixelRatio: null,
	textureScale: 0.5,
	glass_opacity: 0.35,
	glass_refraction: true,
	glass_edges: 0.35,
	environment: "studio",
	fontTimeout: 3000,
	highlightResult: false,
	throwFrom: "any",
	preloadDice: null,
	themeCache: 8,
	onRollComplete: () => {},
	onRerollComplete: () => {},
	onAddDiceComplete: () => {},
	onRemoveDiceComplete: () => {},
	// Called with { speed, die, x, at } for each collision of a throw as its playback reaches it, so an
	// app can play its own sounds; the library's own sounds stay off unless `sounds` is on. See README.
	onImpact: null,
	// Impacts slower than `min` (along the contact normal, world units per second) are resting jitter
	// and never reported; `full` and faster report speed 1. One die reports at most one table or wall
	// impact, and one die-on-die impact, per `interval` seconds.
	impact: { min: 120, full: 2400, interval: 0.06 },
}

const SPOT_INTENSITY = 2.0
const HEMI_INTENSITY = 2.0
const SHADOW_RADIUS = 4
const SHADOW_OPACITY = 0.5
// The environment's soft panels: azimuth and elevation in degrees, size and brightness
const ENV_PANELS = [
	[135, 40, 14, 25], [75, 35, 10, 10], [15, 45, 12, 16], [-45, 35, 12, 14], [-105, 40, 10, 9], [-165, 30, 12, 18],
	[150, 50, 2, 120], [-30, 40, 2, 80], [60, 25, 2, 80],
]
// An LDR photo clips its lamps and windows at white; pixels near white are scaled up to this many
// times brighter so they light metal and glass the way they would in an HDR.
const HIGHLIGHT_GAIN = 6
const POP_MS = 350
const POP_SCALE = 0.12
const SWEEP_MS = 800
const TWINKLE_MS = 1100
// A throw's playback starts this many physics steps after it is simulated, so the simulation is
// normally done before its first frame is due.
const LEAD_STEPS = 2
// onImpact reports an impact up to IMPACT_LEAD_MS before its frame is due (its `at` says how long),
// and drops one due more than IMPACT_LATE_MS ago (the tab was hidden or a frame stalled), so a backlog
// never bursts.
const IMPACT_LEAD_MS = 40
const IMPACT_LATE_MS = 250

const materialOf = colordata => {
	const material = colordata?.texture?.material || 'none'
	return material == 'plastic' ? 'none' : material
}

// The same colorset always gives the same theme, whatever it is called.
function themeKey(colorset, box) {
	if (typeof colorset === "string") return `stock|${colorset}|${box.theme_texture}|${box.theme_material}`
	const { name, ...rest } = colorset
	return JSON.stringify(Object.fromEntries(Object.keys(rest).sort().map(key => [key, rest[key]])))
}

const smoothstep = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
}

class DiceBox {

	constructor(element_container, options = {}) {
		//private variables
		this.initialized = false
		this.container = document.querySelector(element_container);
		this.dimensions = new THREE.Vector2(this.container.clientWidth, this.container.clientHeight)
		this.adaptive_timestep = false;
		this.last_time = 0;
		this.rolling = false;

		this.display = {
			currentWidth: null,
			currentHeight: null,
			containerWidth: null,
			containerHeight: null,
			aspect: null,
			scale: null
		};

		this.cameraHeight = {
			max: null,
			close: null,
			medium: null,
			far: null
		};

		this.scene = new THREE.Scene();
		this.world = new CANNON.World();
		this.dice_body_material = new CANNON.Material();
		this.sounds_table = {};
		this.sounds_dice = [];
		this.lastSoundType = '';
		this.lastSoundStep = 0;
		this.lastSound = 0;
		this.renderer;
		this.barrier;
		this.camera;
		this.light;
		this.light_amb;
		this.desk;
		this.box_body = {};
		this.bodies = [];
		this.meshes = [];
		this.diceList = [];
		this.notationVectors = null
		this.dieIndex = 0
		this.clearToken = 0
		this.pendingWorldBox = false
		this.envTarget = null
		this.envReady = null
		this.throws = []
		this.pops = []
		this.sweepStart = null
		this.twinkleStart = null
		this.frameRequested = false
		this.recording = null
		this.impacts = null
		this.impactPoint = new THREE.Vector3()
		this.resolvedThemes = new Map()
		this.themePromises = new Map()
		this.boxResolved = null
		this.boxTheme = null

		//public variables
		// this.framerate = (1/60);
		// this.sounds = false;
		// this.volume = 100;
		// this.theme_surface = "green-felt"
		// this.sound_dieMaterial = 'plastic'
		this.soundDelay = 10; // time between sound effects in ms
		this.animstate = '';
		// this.tally = true;


		this.selector = {
			animate: true,
			rotate: true,
			intersected: null,
			dice: []
		};

		// this.colors = {
		// 	ambient:  0xf0f5fb,
		// 	spotlight: 0xefdfd5
		// };

		// this.shadows = true

		// merge this with default config and any options coming in
		Object.assign(this, defaultConfig, options)
		this.impact = { ...defaultConfig.impact, ...options.impact }

		this.DiceColors = new DiceColors({assetPath: this.assetPath});
		this.DiceFactory = new DiceFactory({
			baseScale: this.baseScale,
			textureScale: this.textureScale,
			glass_opacity: this.glass_opacity,
			themeCache: this.themeCache
		});
		this.DiceFactory.setBumpMapping(true);
		this.DiceFactory.setRefraction(this.glass_refraction);
		this.DiceFactory.setGlassEdges(this.glass_edges);

		// post config settings
		this.surface = THEMES[this.theme_surface].surface

	}


	enableShadows(){
		this.shadows = true;
		if (this.renderer) this.renderer.shadowMap.enabled = this.shadows;
		if (this.light) this.light.castShadow = this.shadows;
		if (this.desk) this.desk.receiveShadow = this.shadows;
	}
	disableShadows() {
		this.shadows = false;
		if (this.renderer) this.renderer.shadowMap.enabled = this.shadows;
		if (this.light) this.light.castShadow = this.shadows;
		if (this.desk) this.desk.receiveShadow = this.shadows;
	}

	async initialize() {

		// this.cannonDebugger = new CannonDebugger(this.scene,this.world)
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
		this.renderer.setPixelRatio(this.pixelRatio());
		this.container.appendChild(this.renderer.domElement);
		this.renderer.shadowMap.enabled = this.shadows;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.setClearColor(0x000000, 0);
		this.DiceFactory.maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

		this.setDimensions(this.dimensions);

		this.world.gravity.set(0, 0, -9.8 * this.gravity_multiplier);
		this.world.broadphase = new CANNON.NaiveBroadphase();
		this.world.solver.iterations = 14;
		this.world.allowSleep = true;

		// this.scene.add(new THREE.HemisphereLight( 0xffffbb, 0x676771, 1 ));

		this.resizeWorld()

		await this.loadTheme({
			colorset: this.theme_colorset,
			texture: this.theme_texture,
			material: this.theme_material
		})
		.catch(e=>{throw new Error("Unable to load theme")})

		if(this.sounds){
			await this.loadSounds()
			.catch(e=>{throw new Error("Unable to load sounds")})
		}

		// this.DiceFactory.setCubeMap(`./themes/${this.theme_surface}/`,THEMES[this.theme_surface].cubeMap)

		this.initialized = true

		if (this.preloadDice) await this.preload(this.preloadDice)

		this.renderer.render(this.scene, this.camera);
	}

	// Builds the textures and materials for these die types and compiles their shaders ahead of
	// time (in parallel where the browser supports it), so the first roll starts without a stall.
	preload(types = ["d6"]) {
		return this.preloadTheme(null, types)
	}

	// The same for a colorset that later throws will use (null for the box's own): its images and
	// font load, its label textures are drawn and uploaded and any new shaders compile, so its first
	// throw starts as fast as any other, for example when a player joins.
	async preloadTheme(colorset, types = ["d20"]) {
		const resolved = colorset ? await this.resolveTheme(colorset) : this.boxResolved
		if (this.disposed) return
		const theme = this.DiceFactory.useTheme(resolved.key, resolved.colordata, resolved.fontReady)
		theme.pins++
		const group = new THREE.Group()
		try {
			this.trimThemes()
			for (const type of types) {
				const mesh = this.DiceFactory.create(type)
				if (!mesh) continue
				mesh.castShadow = this.shadows
				group.add(mesh)
				for (const mat of [...mesh.material, ...mesh.children.map(child => child.material)]) {
					for (const texture of [mat.map, mat.bumpMap, mat.metalnessMap, mat.glintMap]) if (texture) this.renderer.initTexture(texture)
				}
			}
			if (this.renderer.extensions.has("KHR_parallel_shader_compile")) await this.renderer.compileAsync(group, this.camera, this.scene)
			else this.renderer.compile(group, this.camera, this.scene)
		} finally {
			theme.pins--
		}
	}

	makeWorldBox(){
		if(!Object.keys(this.box_body).length) {
			const desk_body_material = new CANNON.Material();
			const barrier_body_material = new CANNON.Material();

			const bounce = { ...defaultConfig.restitution, ...this.restitution }
			const friction = this.friction
			this.world.addContactMaterial(new CANNON.ContactMaterial( desk_body_material, this.dice_body_material, {mass:0, friction, restitution: bounce.desk}));
			this.world.addContactMaterial(new CANNON.ContactMaterial( barrier_body_material, this.dice_body_material, {mass:0, friction, restitution: bounce.wall}));
			this.world.addContactMaterial(new CANNON.ContactMaterial( this.dice_body_material, this.dice_body_material, {mass:0, friction, restitution: bounce.dice}));

			const plane = (material, axis, angle) => {
				const body = new CANNON.Body({allowSleep: false, mass: 0, shape: new CANNON.Plane(), material})
				if (axis) body.quaternion.setFromAxisAngle(axis, angle);
				this.world.addBody(body);
				return body
			}
			this.box_body.desk = plane(desk_body_material)
			this.box_body.topWall = plane(barrier_body_material, new CANNON.Vec3(1, 0, 0), Math.PI / 2)
			this.box_body.bottomWall = plane(barrier_body_material, new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
			this.box_body.leftWall = plane(barrier_body_material, new CANNON.Vec3(0, 1, 0), -Math.PI / 2)
			this.box_body.rightWall = plane(barrier_body_material, new CANNON.Vec3(0, 1, 0), Math.PI / 2)
		}

		// Moving the walls mid-throw would change the physics and break forced results, so a
		// resize during a throw is applied once the dice settle.
		if (this.rolling) {
			this.pendingWorldBox = true
			return
		}
		this.pendingWorldBox = false

		this.wallScale = this.wallFactor()
		const w = this.display.containerWidth * this.wallScale
		const h = this.display.containerHeight * this.wallScale
		this.box_body.topWall.position.set(0, h, 0);
		this.box_body.bottomWall.position.set(0, -h, 0);
		this.box_body.leftWall.position.set(w, 0, 0);
		this.box_body.rightWall.position.set(-w, 0, 0);
		this.keepDiceInside(w, h)
	}

	// After the box shrinks, slide resting dice back inside it. Only the position changes, so the
	// face showing stays the same.
	keepDiceInside(w, h) {
		for (const dicemesh of this.diceList) {
			const body = dicemesh.body
			if (!body || !dicemesh.parent) continue
			const r = dicemesh.geometry.boundingSphere ? dicemesh.geometry.boundingSphere.radius : 0
			const x = Math.max(-w + r, Math.min(w - r, body.position.x))
			const y = Math.max(-h + r, Math.min(h - r, body.position.y))
			if (x === body.position.x && y === body.position.y) continue
			body.position.x = x
			body.position.y = y
			dicemesh.position.copy(body.position)
		}
	}

	// Walls sit at 93% of the half-extent, pulled further in on short boxes, where perspective
	// makes the top of a die resting against a wall poke past the edge of the canvas.
	wallFactor() {
		const cameraHeight = this.display.currentHeight / this.display.aspect / Math.tan(10 * Math.PI / 180)
		const lift = this.baseScale * 2.4
		return Math.min(0.93, Math.max(0.5, (cameraHeight - lift) / cameraHeight))
	}

	pixelRatio() {
		const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio || Infinity)
		return this.rolling && this.rollingPixelRatio ? Math.min(ratio, this.rollingPixelRatio) : ratio
	}

	// With rollingPixelRatio set, moving dice render at that lower ratio and the settled dice
	// get one sharp frame at the full ratio.
	applyPixelRatio() {
		const ratio = this.pixelRatio()
		if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio)
	}

	async loadTheme(themeConfig){
		const resolved = await this.resolveTheme(this.theme_customColorset || themeConfig.colorset)
		this.boxResolved = resolved
		this.boxTheme = this.DiceFactory.useTheme(resolved.key, resolved.colordata, resolved.fontReady)
		this.colorData = resolved.colordata

		const material = this.DiceFactory.dice_material
		// light passes through glass, so its shadows are lighter
		if (this.desk) this.desk.material.opacity = SHADOW_OPACITY * (material == 'glass' ? 0.4 + 0.6 * this.DiceFactory.body_opacity : 1)
		this.trimThemes()
	}

	// A colorset (a stock colorset name, or a custom colorset) made ready to draw, once: its images
	// loaded and its font ready (labels are drawn once and cached, so the number font has to be ready
	// before the first die), and the environment if its material reflects it.
	resolveTheme(colorset) {
		const key = themeKey(colorset, this)
		let pending = this.themePromises.get(key)
		if (!pending) {
			pending = (async () => {
				const colordata = typeof colorset === "string"
					? await this.DiceColors.getColorSet({ colorset, texture: this.theme_texture, material: this.theme_material })
					: await this.DiceColors.makeColorSet({ ...colorset, name: key })
				const fontReady = await loadFont(fontOf(colordata), this.fontTimeout)
				if (MATERIALTYPES[materialOf(colordata)]?.envMapIntensity && this.renderer) await this.loadEnvironment()
				const resolved = { key, colordata, fontReady }
				if (this.themePromises.get(key) === pending) this.resolvedThemes.set(key, resolved)
				return resolved
			})()
			this.themePromises.set(key, pending)
			pending.catch(() => this.themePromises.delete(key))
		}
		return pending
	}

	// Frees the least recently used themes beyond themeCache that no die on the table (or rolling)
	// uses; the box's own theme stays.
	trimThemes() {
		const inUse = new Set(this.diceList.filter(mesh => mesh.parent).map(mesh => mesh.diceTheme))
		if (this.boxTheme) inUse.add(this.boxTheme)
		for (const key of this.DiceFactory.trimThemes(inUse)) {
			this.resolvedThemes.delete(key)
			this.themePromises.delete(key)
			delete this.DiceColors.colorsets[key]
		}
	}

	// Loads the reflection environment the first time a metal or glass colorset needs it.
	loadEnvironment() {
		if (!this.envReady) this.envReady = this.makeEnvironment(this.environment).then(target => this.useEnvironment(target))
		return this.envReady
	}

	// Swaps the reflection environment ("studio", a URL, or {url, intensity, rotation}) without
	// rebuilding anything: the cached metal and glass materials point at the new one, the old one is
	// freed and the dice are drawn once. An environment nothing uses yet is only remembered.
	setEnvironment(environment = "studio") {
		this.environment = environment
		if (!this.envReady) return Promise.resolve()
		this.envReady = this.envReady.then(() => this.makeEnvironment(environment)).then(target => {
			this.useEnvironment(target)
			if (this.renderer && !this.rolling) this.renderer.render(this.scene, this.camera)
		})
		return this.envReady
	}

	useEnvironment({ target, rotation, intensity }) {
		if (this.disposed) {
			target.dispose()
			return
		}
		const old = this.envTarget
		this.envTarget = target
		this.DiceFactory.setEnvironment(target.texture, rotation, intensity)
		if (old) old.dispose()
	}

	async makeEnvironment(environment) {
		if (this.disposed) return { target: new THREE.WebGLRenderTarget(1, 1) }
		const options = typeof environment === "string" ? { url: environment } : (environment || {})
		const pmrem = new THREE.PMREMGenerator(this.renderer)
		try {
			if (options.url && options.url !== "studio") {
				try {
					const texture = await this.loadEquirect(options.url)
					if (this.disposed) throw new Error("disposed")
					const target = pmrem.fromEquirectangular(texture)
					texture.dispose()
					// photos are y-up; this scene is z-up with the camera looking down
					const rotation = new THREE.Euler(Math.PI / 2, 0, options.rotation || 0, "ZYX")
					return { target, rotation, intensity: options.intensity ?? 1 }
				} catch (e) {
					console.warn(`Unable to load environment ${options.url}, using the studio`)
				}
			}
			return { target: this.makeStudio(pmrem), rotation: new THREE.Euler(), intensity: options.intensity ?? 1 }
		} finally {
			pmrem.dispose()
		}
	}

	// An equirectangular .hdr, or an LDR image (JPEG, WebP, PNG) whose clipped highlights are
	// stretched so lamps and windows read as light sources.
	async loadEquirect(url) {
		if (/\.hdr($|[?#])/i.test(url)) {
			const texture = await new HDRLoader().loadAsync(url)
			texture.mapping = THREE.EquirectangularReflectionMapping
			return texture
		}
		const image = await new THREE.ImageLoader().setCrossOrigin("anonymous").loadAsync(url)
		const width = Math.min(2048, image.width)
		const height = Math.round(width * image.height / image.width)
		const canvas = document.createElement("canvas")
		canvas.width = width
		canvas.height = height
		const context = canvas.getContext("2d", { willReadFrequently: true })
		context.drawImage(image, 0, 0, width, height)
		const pixels = context.getImageData(0, 0, width, height).data
		const linear = new Float32Array(256).map((v, i) => new THREE.Color().setRGB(i / 255, 0, 0, THREE.SRGBColorSpace).r)
		const data = new Uint16Array(width * height * 4)
		const toHalf = THREE.DataUtils.toHalfFloat
		for (let y = 0; y < height; y++) {
			// DataTextures start at the bottom row
			let out = (height - 1 - y) * width * 4
			for (let x = 0, i = y * width * 4; x < width; x++, i += 4, out += 4) {
				const peak = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) / 255
				const gain = 1 + HIGHLIGHT_GAIN * smoothstep(0.8, 1, peak) ** 2
				data[out] = toHalf(linear[pixels[i]] * gain)
				data[out + 1] = toHalf(linear[pixels[i + 1]] * gain)
				data[out + 2] = toHalf(linear[pixels[i + 2]] * gain)
				data[out + 3] = 0x3c00
			}
		}
		const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType)
		texture.mapping = THREE.EquirectangularReflectionMapping
		texture.colorSpace = THREE.LinearSRGBColorSpace
		texture.magFilter = texture.minFilter = THREE.LinearFilter
		texture.needsUpdate = true
		return texture
	}

	// The default environment: a dark studio with a band of light low around it and soft panels at
	// mid height, so tilted facets and edges catch highlights while faces turned to the camera stay
	// clear.
	makeStudio(pmrem) {
		const scene = new THREE.Scene()
		const light = value => new THREE.MeshBasicMaterial({ color: new THREE.Color(value, value, value), side: THREE.DoubleSide })
		const band = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 14, 32, 1, true), light(1.5))
		band.rotation.x = Math.PI / 2
		band.position.z = 7
		scene.add(band)
		const plane = new THREE.PlaneGeometry(1, 1)
		for (const [azimuth, elevation, size, brightness] of ENV_PANELS) {
			const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180
			const panel = new THREE.Mesh(plane, light(brightness))
			panel.position.set(Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)).multiplyScalar(20)
			panel.lookAt(0, 0, 0)
			panel.scale.setScalar(size)
			scene.add(panel)
		}
		const target = pmrem.fromScene(scene, 0.02)
		scene.children.forEach(mesh => {
			mesh.geometry.dispose()
			mesh.material.dispose()
		})
		return target
	}

	async loadSounds(){
		let surfaces = {
			felt: 7,
			wood_table: 7,
			wood_tray: 7,
			metal: 9
		}

		//TODO: add dice hit noises for other materials
		let dieMaterials = {
			coin: 6,
			metal: 12,
			plastic: 15,
			wood: 12
		}

		const hassound_dieMaterial = this.colorData.texture.material.match(/wood|metal/)

		this.sound_dieMaterial = hassound_dieMaterial ? hassound_dieMaterial[0] : "plastic"
		
		if(!this.sounds_table.hasOwnProperty(this.surface)){
			this.sounds_table[this.surface] = [];
			let numsounds = surfaces[this.surface]
			for (let s=1; s <= numsounds; ++s) {
				const clip = await this.loadAudio(this.assetPath + 'sounds/surfaces/surface_'+this.surface+s+'.mp3')
				this.sounds_table[this.surface].push(clip);
			}
		}
		// load the coin sounds for all sets
		if(!this.sounds_dice.hasOwnProperty('coin')){
			this.sounds_dice['coin'] = []
			let numsounds = dieMaterials['coin']
			for (let s=1; s <= numsounds; ++s) {
				const clip = await this.loadAudio(this.assetPath + 'sounds/dicehit/dicehit_coin'+s+'.mp3')
				this.sounds_dice['coin'].push(clip);
			}
		}
		if(!this.sounds_dice.hasOwnProperty(this.sound_dieMaterial)){
			this.sounds_dice[this.sound_dieMaterial] = []
			let numsounds = dieMaterials[this.sound_dieMaterial]
			for (let s=1; s <= numsounds; ++s) {
				const clip = await this.loadAudio(this.assetPath + 'sounds/dicehit/dicehit_'+this.sound_dieMaterial+s+'.mp3')
				this.sounds_dice[this.sound_dieMaterial].push(clip);
			}
		}
	}

	loadAudio(src){
		return new Promise((resolve, reject) => {
			let audio = new Audio()
			audio.oncanplaythrough = () => resolve(audio)
			audio.crossOrigin = "anonymous";
			audio.src = src
			audio.onerror = (error) => reject(error)
		}).catch(e => {
			console.error("Unable to load audio")
		})
	}

	async updateConfig(options = {}){
		// if(options.scale && this.scale !== options.scale){
		// 	this.DiceFactory.updateConfig({
		// 		scale: options.scale
		// 	})
		// }
		Object.apply(this,options)
		this.theme_customColorset = options.theme_customColorset ? options.theme_customColorset : null
		if(options.theme_colorset){
			this.theme_colorset = options.theme_colorset
		}
		if(options.theme_texture){
			this.theme_texture = options.theme_texture
		}
		if(options.theme_material){
			this.theme_material = options.theme_material
		}
		if ("highlightResult" in options) this.highlightResult = options.highlightResult
		if ("themeCache" in options) {
			this.themeCache = this.DiceFactory.themeCache = options.themeCache
			this.trimThemes()
		}
		if ("throwFrom" in options) this.throwFrom = options.throwFrom
		if ("onImpact" in options) this.onImpact = options.onImpact
		if ("impact" in options) this.impact = { ...defaultConfig.impact, ...options.impact }
		if ("glass_refraction" in options) {
			this.glass_refraction = options.glass_refraction
			this.DiceFactory.setRefraction(options.glass_refraction)
			if (this.renderer && !this.rolling) this.renderer.render(this.scene, this.camera)
		}
		if ("glass_edges" in options) {
			this.glass_edges = options.glass_edges
			this.DiceFactory.setGlassEdges(options.glass_edges)
			if (this.renderer && !this.rolling) this.renderer.render(this.scene, this.camera)
		}
		if ("environment" in options) await this.setEnvironment(options.environment)
		if(options.theme_colorset || options.theme_texture || options.theme_material || options.theme_customColorset){
			await this.loadTheme({
				colorset: this.theme_colorset,
				texture: this.theme_texture,
				material: this.theme_material
			})
		}

	}

	setDimensions(dimensions) {
		this.display.currentWidth = this.container.clientWidth / 2;
		this.display.currentHeight = this.container.clientHeight / 2;
		if (dimensions) {
			this.display.containerWidth = dimensions.x;
			this.display.containerHeight = dimensions.y;
		} else {
			this.display.containerWidth = this.display.currentWidth;
			this.display.containerHeight = this.display.currentHeight;
		}
		this.display.aspect = Math.min(this.display.currentWidth / this.display.containerWidth, this.display.currentHeight / this.display.containerHeight);
		this.display.scale = Math.sqrt(this.display.containerWidth * this.display.containerWidth + this.display.containerHeight * this.display.containerHeight) / 13;

		this.makeWorldBox()

		this.renderer.setPixelRatio(this.pixelRatio());
		this.renderer.setSize(this.display.currentWidth * 2, this.display.currentHeight * 2);

		this.cameraHeight.max = this.display.currentHeight / this.display.aspect / Math.tan(10 * Math.PI / 180);

		this.cameraHeight.medium = this.cameraHeight.max / 1.5;
		this.cameraHeight.far = this.cameraHeight.max;
		this.cameraHeight.close = this.cameraHeight.max / 2;

		if (!this.camera) this.camera = new THREE.PerspectiveCamera(20, 1, 1, 1);
		this.camera.aspect = this.display.currentWidth / this.display.currentHeight;
		this.camera.far = this.cameraHeight.max * 1.3;
		this.camera.updateProjectionMatrix();

		switch (this.animstate) {
			case 'selector':
				this.camera.position.z = this.selector.dice.length > 9 ? this.cameraHeight.far : (this.selector.dice.length < 6 ? this.cameraHeight.close : this.cameraHeight.medium);
				break;
			case 'throw': case 'afterthrow': default: this.camera.position.z = this.cameraHeight.far;

		}

		this.camera.lookAt(new THREE.Vector3(0,0,0));
		
		const maxwidth = Math.max(this.display.containerWidth, this.display.containerHeight);

		if (!this.light) {
			// three r155+ uses physically based light units. Decay 0 keeps the light even across the
			// table at this scene's pixel-sized units; the factors keep light_intensity's old meaning.
			this.light = new THREE.SpotLight(this.color_spotlight, this.light_intensity * SPOT_INTENSITY, 0, Math.PI / 4, 0, 0);
			this.light.shadow.camera.fov = 50;
			this.light.shadow.bias = 0.001;
			this.light.shadow.radius = SHADOW_RADIUS;
			this.light.shadow.mapSize.width = 1024;
			this.light.shadow.mapSize.height = 1024;
			this.scene.add(this.light);

			this.light_amb = new THREE.HemisphereLight( 0xffffbb, 0x676771, this.light_intensity * HEMI_INTENSITY );
			this.scene.add(this.light_amb);

			let shadowplane = new THREE.ShadowMaterial();
			shadowplane.opacity = SHADOW_OPACITY;
			this.desk = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), shadowplane);
			this.scene.add(this.desk);
		}
		this.light.position.set(-maxwidth / 2, maxwidth / 2, maxwidth * 3);
		this.light.target.position.set(0, 0, 0);
		this.light.castShadow = this.shadows;
		this.light.shadow.camera.near = maxwidth / 10;
		this.light.shadow.camera.far = maxwidth * 5;
		this.light.shadow.camera.updateProjectionMatrix();

		this.desk.scale.set(this.display.containerWidth * 6, this.display.containerHeight * 6, 1);
		this.desk.receiveShadow = this.shadows;

		this.renderer.render(this.scene, this.camera);
	}

	resizeWorld(){
		const resize = () => {
			if (!this.renderer) return
			const width = this.container.clientWidth;
			const height = this.container.clientHeight;
			const needResize = width !== this.display.containerWidth || height !== this.display.containerHeight || this.renderer.getPixelRatio() !== this.pixelRatio();
			if (needResize) {
				this.setDimensions(new THREE.Vector2(width, height))
			}
			return needResize;
		}
		this.onResize = debounce(resize)
		window.addEventListener("resize", this.onResize)
		if (typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(this.onResize)
			this.resizeObserver.observe(this.container)
		}
	}

	vectorRand({x, y}) {
		let angle = Math.random() * Math.PI / 5 - Math.PI / 5 / 2;
		let vec = {
			x: x * Math.cos(angle) - y * Math.sin(angle),
			y: x * Math.sin(angle) + y * Math.cos(angle)
		};
		if (vec.x == 0) vec.x = 0.01;
		if (vec.y == 0) vec.y = 0.01;
		return vec;
	}

	//returns an array of vectordata objects
	getNotationVectors(notation, vector, boost, dist, side = 0){

		let notationVectors = new DiceNotation(notation);
		const slots = side ? this.sideSlots(notationVectors.set, side) : null;
		let slot = 0;

		for (let i in notationVectors.set) {

			const diceobj = this.DiceFactory.get(notationVectors.set[i].type);
			let numdice = notationVectors.set[i].num;
			let operator = notationVectors.set[i].op;
			let sid = notationVectors.set[i].sid;
			let gid = notationVectors.set[i].gid;
			let glvl = notationVectors.set[i].glvl;
			let func = notationVectors.set[i].func;
			let args = notationVectors.set[i].args;

			for(let k = 0; k < numdice; k++){

				let vec = this.vectorRand(vector);

				vec.x /= dist;
				vec.y /= dist;

				let pos
				if (side) {
					pos = slots(slot++);
				} else {
					pos = {
						x: this.display.containerWidth * (vec.x > 0 ? -1 : 1) * (this.wallScale - 0.03),
						y: this.display.containerHeight * (vec.y > 0 ? -1 : 1) * (this.wallScale - 0.03),
						z: Math.random() * 200 + 200
					};

					let projector = Math.abs(vec.x / vec.y);
					if (projector > 1.0) pos.y /= projector; else pos.x *= projector;
				}

				let velvec = this.vectorRand(vector);
				velvec.x /= dist;
				velvec.y /= dist;
				if (side) velvec.y = Math.max(-0.35, Math.min(0.35, velvec.y / Math.abs(velvec.x))) * Math.abs(velvec.x);
				let velocity, angle, axis;

				if (diceobj.shape != "d2") {

					velocity = { 
						x: velvec.x * boost, 
						y: velvec.y * boost, 
						z: -10
					};

					angle = {
						x: -(Math.random() * vec.y * 5 + diceobj.inertia * vec.y),
						y: Math.random() * vec.x * 5 + diceobj.inertia * vec.x,
						z: 0
					};

					axis = { 
						x: Math.random(), 
						y: Math.random(), 
						z: Math.random(), 
						a: Math.random()
					};
				} else {
					//coin flip
					velocity = { 
						x: velvec.x * boost / 10, 
						y: velvec.y * boost / 10, 
						z: 3000
					};

					angle = {
						x: 12 * diceobj.inertia,//-(Math.random() * velvec.y * 50 + diceobj.inertia * velvec.y ) ,
						y: 1 * diceobj.inertia,//Math.random() * velvec.x * 50 + diceobj.inertia * velvec.x ,
						z: 0
					};

					axis = { 
						x: 1,//Math.random(), 
						y: 1,//Math.random(), 
						z: Math.random(), 
						a: Math.random()
					};
				}

				notationVectors.vectors.push({ 
					index: this.dieIndex++,
					type: diceobj.type, 
					op: operator,
					sid: sid,  
					gid: gid, 
					glvl: glvl,
					func: func, 
					args: args, 
					pos: pos, 
					velocity: velocity, 
					angle: angle, 
					axis: axis
				});
			}            
		}

		return notationVectors;
	}

	// Side throws start each die in its own cell of a grid just inside the wall, in the middle 60%
	// of its height (taller, then further in, then stacked higher when there are many dice), so no
	// two dice start inside each other.
	sideSlots(sets, side) {
		const count = sets.reduce((n, set) => n + set.num, 0)
		const radius = Math.max(...sets.map(set => this.DiceFactory.get(set.type).scale || 1)) * this.baseScale
		const spacing = radius * 2.2
		const halfWidth = this.display.containerWidth * this.wallScale
		const halfHeight = this.display.containerHeight * this.wallScale
		const columns = Math.max(1, Math.floor(halfWidth / spacing))
		let band = 0.3 * halfHeight
		let rows = Math.max(1, Math.floor(2 * band / spacing))
		while (rows * columns < count && band < halfHeight - radius) {
			band = Math.min(halfHeight - radius, band + spacing / 2)
			rows = Math.max(1, Math.floor(2 * band / spacing))
		}
		return k => {
			const column = Math.floor(k / rows)
			const inColumn = Math.min(rows, count - column * rows)
			const cell = 2 * band / inColumn
			return {
				x: -side * (halfWidth - 0.03 * this.display.containerWidth - (column % columns) * spacing),
				y: -band + (k % rows + 0.5) * cell + (Math.random() - 0.5) * Math.max(0, cell - spacing),
				z: Math.random() * 200 + 200 + Math.floor(column / columns) * spacing
			}
		}
	}

	// swaps dice faces to match desired result
	swapDiceFace(dicemesh, result){
		const diceobj = this.DiceFactory.get(dicemesh.notation.type);

		// flag this result as forced
		dicemesh.resultReason = 'forced'

		if (diceobj.shape == 'd4') {
			this.swapDiceFace_D4(dicemesh, result);
			return;
		}

		let values = diceobj.values;
		let value = parseInt(dicemesh.getLastValue().value);
		result = parseInt(result);
		
		if (dicemesh.notation.type == 'd10' && value == 0) value = 10;
		if (dicemesh.notation.type == 'd100' && value == 0) value = 100;
		if (dicemesh.notation.type == 'd100' && (value > 0 && value < 10)) value *= 10;

		if (dicemesh.notation.type == 'd10' && result == 0) result = 10;
		if (dicemesh.notation.type == 'd100' && result == 0) result = 100;
		if (dicemesh.notation.type == 'd100' && (result > 0 && result < 10)) result *= 10;

		let valueindex = diceobj.values.indexOf(value);
		let resultindex = diceobj.values.indexOf(result);

		if (valueindex < 0 || resultindex < 0) return;
		if (valueindex == resultindex) return;

		// find material index for corresponding value -> face and swap them

		// it's magic but not really
		// the mesh's materials start at index 2
		let magic = 2;
		// except on d10 meshes
		if (diceobj.shape == 'd10') magic = 1;

		let material_value, material_result = (resultindex+magic);

		//and D2 meshes have a lot more faces
		if(diceobj.shape != "d2"){
			material_value = (valueindex+magic);
			material_result = (resultindex+magic);
		} else {
			material_value = valueindex+1;
			material_result = resultindex+1;
		}

		//and probably some third rule eventually...

		// Swap the two labels by swapping the materials the two face groups draw with. The geometry
		// stays shared; faceMap tells getFaceValue which label each face group now shows.
		const groups = dicemesh.geometry.groups
		if (!groups.some(g => g.materialIndex == material_value) || !groups.some(g => g.materialIndex == material_result)) return;

		const materials = dicemesh.material.slice()
		const faceMap = dicemesh.faceMap ? dicemesh.faceMap.slice() : materials.map((m, i) => i)
		;[materials[material_value], materials[material_result]] = [materials[material_result], materials[material_value]]
		;[faceMap[material_value], faceMap[material_result]] = [faceMap[material_result], faceMap[material_value]]

		dicemesh.material = materials;
		dicemesh.faceMap = faceMap;
		dicemesh.result = [];
	}

	swapDiceFace_D4(dicemesh, result) {
		const diceobj = this.DiceFactory.get(dicemesh.notation.type);
		let value = parseInt(dicemesh.getLastValue().value);
		result = parseInt(result);

		if (!(value >= 1 && value <= 4)) return;

		let num = result - value;
		if (num == 0) return;
		if (num < 0) num += 4;

		// Every numbered face moves num places round, and the label set rotated by the same
		// amount keeps the corner numbers consistent.
		const base = this.DiceFactory.labelSet(dicemesh, num);
		const faceMap = base.map((m, i) => i < 2 ? i : ((i - 2 + num) % 4) + 2);
		dicemesh.material = faceMap.map(i => base[i]);
		dicemesh.faceMap = faceMap;
		dicemesh.result = [];
	}

	// Spawns one die for a vectordata object, in a theme, at its start position.
	spawnDice(vectordata, theme) {
		this.DiceFactory.useTheme(theme.key, theme.colordata, theme.fontReady)
		const dicemesh = this.DiceFactory.create(vectordata.type)
		if (!dicemesh) return null
		const { pos, axis, angle, velocity } = vectordata
		dicemesh.notation = vectordata
		dicemesh.result = []
		dicemesh.castShadow = this.shadows
		dicemesh.moving = true
		dicemesh.body = new CANNON.Body({allowSleep: true, sleepSpeedLimit: 75, sleepTimeLimit: this.settleTime, mass: dicemesh.mass, shape: dicemesh.geometry.cannon_shape, material: this.dice_body_material});
		dicemesh.body.type = CANNON.Body.DYNAMIC;
		dicemesh.body.position.set(pos.x, pos.y, pos.z);
		dicemesh.body.quaternion.setFromAxisAngle(new CANNON.Vec3(axis.x, axis.y, axis.z), axis.a * Math.PI * 2);
		dicemesh.body.angularVelocity.set(angle.x, angle.y, angle.z);
		dicemesh.body.velocity.set(velocity.x, velocity.y, velocity.z);
		dicemesh.body.linearDamping = this.damping;
		dicemesh.body.angularDamping = this.damping;
		dicemesh.body.diceShape = dicemesh.shape;
		dicemesh.body.impactStep = dicemesh.body.clackStep = -Infinity;
		dicemesh.body.addEventListener('collide', this.eventCollide.bind(this));
		this.world.addBody(dicemesh.body);
		dicemesh.position.copy(dicemesh.body.position);
		dicemesh.quaternion.copy(dicemesh.body.quaternion);
		this.scene.add(dicemesh);
		this.diceList.push(dicemesh);
		return dicemesh
	}

	// Sounds and impacts are recorded while a throw is simulated and played or reported when its
	// playback gets there.
	eventCollide({body, target, contact}) {
		if (!body || !this.recording) return;
		const dice = body.mass > 0
		if (this.sounds) this.recording.push({ step: this.recordStep, dice, coin: body.diceShape === "d2", speed: (dice ? body : target).velocity.length() })
		if (this.impacts) this.recordImpact(target, body, dice, contact)
	}

	// A collision fires on both bodies; die-on-die keeps the one from the die with the lower id.
	recordImpact(die, other, dice, contact) {
		if (dice && die.id > other.id) return
		const { min, full, interval } = this.impact
		const v = Math.abs(contact.getImpactVelocityAlongNormal())
		if (v < min) return
		const step = this.recordStep
		const gap = Math.round(interval / this.framerate)
		if (dice) {
			if (step - die.clackStep < gap || step - other.clackStep < gap) return
			die.clackStep = other.clackStep = step
		} else {
			if (step - die.impactStep < gap) return
			die.impactStep = step
		}
		const { bi, ri } = contact
		const point = this.impactPoint.set(bi.position.x + ri.x, bi.position.y + ri.y, bi.position.z + ri.z).project(this.camera)
		this.impacts.steps.push(step)
		this.impacts.hits.push({ speed: Math.min(1, v / full), die: dice, x: Math.min(1, Math.max(0, (point.x + 1) / 2)), at: 0 })
	}

	playSound({ step, dice, coin, speed }) {
		// let volume = parseInt(window.DiceFavorites.settings.volume.value) || 0;
		if (this.volume <= 0) return;

		let now = Date.now();
		let currentSoundType = dice ? 'dice' : 'table';

		// the idea here is that a dice clack should never be skipped in favor of a table sound
		// if ((don't play sounds if we played one this world step, or there hasn't been enough delay) AND 'this sound IS NOT a dice clack') then 'skip it'
		if ((this.lastSoundStep == step || this.lastSound > now) && currentSoundType != 'dice') return;

		// also skip if it's too early and both last sound and this sound are the same
		if ((this.lastSoundStep == step || this.lastSound > now) && currentSoundType == 'dice' && this.lastSoundType == 'dice') return;

		// also don't bother playing at low speeds
		if (speed < 250) return;

		let sound;
		if (dice) {
			const clips = coin ? this.sounds_dice['coin'] : this.sounds_dice[this.sound_dieMaterial];
			sound = clips[Math.floor(Math.random() * clips.length)];
		} else {
			const soundlist = this.sounds_table[this.surface];
			sound = soundlist[Math.floor(Math.random() * soundlist.length)];
		}
		if(sound){
			sound.volume = Math.min(speed / 8000, this.volume/100)
			sound.play().catch(error => {});
		}
		this.lastSoundType = currentSoundType;
		this.lastSoundStep = step;
		this.lastSound = now + this.soundDelay;
	}

	// The fixed physics step the playback clock is on; every throw starts on one of these.
	clockStep() {
		return Math.floor(performance.now() / (this.framerate * 1000))
	}

	// Steps the world until the dice of a new throw (fresh, or woken for a reroll) are asleep or
	// iterationLimit steps pass, reading each face as its die falls asleep and freezing it there
	// (kinematic, so later dice bounce off it). The dice of throws still playing back follow their
	// own recorded paths step by step as moving kinematic bodies: the new dice bounce off them, and
	// they never change, so their results stay what they were. Returns the poses of the new dice
	// at every step, the collisions that make sounds and, with recordImpacts, the impacts for onImpact.
	simulate(dice, startStep, recordImpacts = Boolean(this.onImpact)) {
		const dt = this.framerate
		const movers = this.throws.flatMap(t => t.dice.map((mesh, j) => ({ mesh, t, j, frame: startStep - t.startStep })))
		const n = dice.length
		const frames = []
		const record = () => {
			const frame = new Float32Array(n * 7)
			dice.forEach(({ body: { position: p, quaternion: q } }, j) => frame.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], j * 7))
			frames.push(frame)
		}
		this.recording = []
		this.impacts = recordImpacts ? { steps: [], hits: [] } : null
		this.recordStep = 0
		record()
		const done = new Array(n).fill(false)
		let left = n
		try {
			for (let step = 0; ; step++) {
				for (let j = 0; j < n; j++) {
					const mesh = dice[j]
					if (done[j] || (mesh.body.sleepState !== CANNON.Body.SLEEPING && step <= this.iterationLimit)) continue
					done[j] = true
					left--
					mesh.storeRolledValue(mesh.rerolling ? 'reroll' : mesh.resultReason)
					mesh.rerolling = false
					mesh.body.type = CANNON.Body.KINEMATIC
					mesh.body.velocity.setZero()
					mesh.body.angularVelocity.setZero()
				}
				if (!left) break
				for (const mover of movers) this.drive(mover, mover.frame + step)
				this.recordStep = startStep + step + 1
				this.world.step(dt)
				record()
			}
		} finally {
			for (const mover of movers) this.drive(mover, Infinity)
		}
		const sounds = this.recording
		const impacts = this.impacts
		this.recording = this.impacts = null
		return { frames, sounds, impacts }
	}

	// Puts a die of a throw that is still playing back where its recording has it at `frame`, moving
	// towards the next one; past the end it rests at its final pose.
	drive({ mesh, t, j }, frame) {
		const body = mesh.body
		const last = t.frames.length - 1
		const a = t.frames[Math.max(0, Math.min(last, frame))]
		const b = t.frames[Math.max(0, Math.min(last, frame + 1))]
		const k = j * 7
		body.position.set(a[k], a[k + 1], a[k + 2])
		body.quaternion.set(a[k + 3], a[k + 4], a[k + 5], a[k + 6])
		if (a === b) {
			body.velocity.setZero()
			body.angularVelocity.setZero()
			return
		}
		const dt = this.framerate
		body.velocity.set((b[k] - a[k]) / dt, (b[k + 1] - a[k + 1]) / dt, (b[k + 2] - a[k + 2]) / dt)
		const qa = new THREE.Quaternion(a[k + 3], a[k + 4], a[k + 5], a[k + 6])
		const turn = new THREE.Quaternion(b[k + 3], b[k + 4], b[k + 5], b[k + 6]).multiply(qa.invert())
		if (turn.w < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w)
		const sin = Math.hypot(turn.x, turn.y, turn.z)
		const rate = sin > 1e-9 ? 2 * Math.atan2(sin, turn.w) / sin / dt : 0
		body.angularVelocity.set(turn.x * rate, turn.y * rate, turn.z * rate)
	}

	// Simulates a throw to the end, relabels faces for forced results and queues its playback, which
	// starts a couple of steps ahead so the simulation is done by then. Other throws keep playing.
	// onImpact is the throw's own listener, in place of the box's.
	launch(meshes, forced = [], done, onImpact = null) {
		const dice = meshes.filter(Boolean)
		const startStep = this.clockStep() + LEAD_STEPS
		const { frames, sounds, impacts } = this.simulate(dice, startStep, Boolean(onImpact || this.onImpact))
		meshes.forEach((mesh, i) => {
			if (!mesh || forced[i] === undefined || mesh.getLastValue().value == forced[i]) return
			this.swapDiceFace(mesh, forced[i])
		})
		this.throws.push({ dice, frames, sounds, impacts, onImpact, nextImpact: 0, startStep, frame: -1, done })
		this.rolling = true
		this.requestFrame()
	}

	requestFrame() {
		if (this.frameRequested || this.disposed) return
		this.frameRequested = true
		requestAnimationFrame(now => this.frame(now))
	}

	// The one render loop: plays back every throw from its recording on the shared step clock, runs
	// the pops, sweeps and twinkles, and renders when something changed. Nothing renders when idle.
	frame(now) {
		this.frameRequested = false
		if (this.disposed) return
		const step = this.clockStep()
		let changed = false
		const finished = []
		for (const t of this.throws) {
			if (t.impacts) this.reportImpacts(t)
			const last = t.frames.length - 1
			const f = Math.max(0, Math.min(last, step - t.startStep))
			if (f !== t.frame) {
				const poses = t.frames[f]
				t.dice.forEach((mesh, j) => {
					mesh.position.set(poses[j * 7], poses[j * 7 + 1], poses[j * 7 + 2])
					mesh.quaternion.set(poses[j * 7 + 3], poses[j * 7 + 4], poses[j * 7 + 5], poses[j * 7 + 6])
				})
				if (this.sounds) t.sounds.forEach(sound => { if (sound.step > t.startStep + t.frame && sound.step <= t.startStep + f) this.playSound(sound) })
				t.frame = f
				changed = true
			}
			if (f === last) finished.push(t)
		}
		if (finished.length) {
			this.throws = this.throws.filter(t => !finished.includes(t))
			for (const t of finished) {
				for (const mesh of t.dice) {
					mesh.moving = false
					if (!mesh.result.length) mesh.storeRolledValue(mesh.resultReason)
				}
			}
			if (!this.throws.length) {
				this.rolling = false
				if (this.pendingWorldBox) this.makeWorldBox()
			}
			finished.forEach(t => t.done && t.done.call(this))
		}
		if (this.animatePops(now)) changed = true
		this.applyPixelRatio()
		if (changed || finished.length) this.renderer.render(this.scene, this.camera)
		if (this.throws.length || this.popping()) this.requestFrame()
	}

	// Hands onImpact the throw's impacts that are due within IMPACT_LEAD_MS, each with `at`, the
	// seconds until its frame shows.
	reportImpacts(t) {
		const { steps, hits } = t.impacts
		if (t.nextImpact >= steps.length) return
		const now = performance.now()
		const stepMs = this.framerate * 1000
		while (t.nextImpact < steps.length) {
			const due = steps[t.nextImpact] * stepMs
			if (due > now + IMPACT_LEAD_MS) break
			const hit = hits[t.nextImpact++]
			const listener = t.onImpact || this.onImpact
			if (due < now - IMPACT_LATE_MS || !listener) continue
			hit.at = Math.max(0, (due - now) / 1000)
			try {
				listener(hit)
			} catch (error) {
				console.error(error)
			}
		}
	}

	// highlightResult: true | { glow: true | number (emissive intensity), pop: true,
	//   style: "auto" | "glow" | "ink" | "gilded", color: fill colour for ink and gilded }
	highlightOptions(option = this.highlightResult) {
		if (!option) return { glow: 0, pop: false }
		const glow = option === true || option.glow === undefined ? true : option.glow
		const pop = option === true || option.pop === undefined ? true : option.pop
		const style = ["glow", "ink", "gilded"].includes(option.style) ? option.style : "auto"
		return { glow: glow === true ? 1 : Number(glow) || 0, pop: Boolean(pop), style, color: option.color || null }
	}

	// Dropped dice are struck through; the rest get the result highlight (the throw's own, if it
	// gave one).
	highlightDice(meshes, highlight) {
		meshes = meshes.filter(mesh => mesh && mesh.parent)
		meshes.forEach(mesh => {
			mesh.highlight = highlight
			if (mesh.mark === "dropped") this.DiceFactory.dropResult(mesh)
		})
		const { glow, pop, style, color } = this.highlightOptions(highlight)
		const kept = meshes.filter(mesh => mesh.mark !== "dropped")
		const styles = glow ? kept.map(mesh => this.DiceFactory.glowResult(mesh, glow, style, color)) : []
		const sweep = styles.includes("gilded")
		const twinkle = this.diceList.some(mesh => mesh.parent && this.DiceFactory.glints(mesh))
		if (pop || sweep || twinkle) this.popDice(pop ? kept : [], sweep, twinkle)
	}

	// marks: [{ index, state: "kept" | "dropped" | null }], where index is the die's id in the
	// results (its place in throw order across roll() and add() calls). A dropped die shows its number
	// struck through and is dimmed, and never gets the result highlight; a kept or unmarked die does.
	// Dice still rolling are drawn marked when they settle. Results and faces never change.
	markDice(marks = []) {
		const settled = []
		for (const { index, state } of marks) {
			const mesh = this.diceList[index]
			if (!mesh) continue
			mesh.mark = state === "kept" || state === "dropped" ? state : null
			if (mesh.parent && !mesh.moving) settled.push(mesh)
		}
		if (!settled.length) return
		for (const mesh of settled) {
			const { glow, style, color } = this.highlightOptions(mesh.highlight === undefined ? this.highlightResult : mesh.highlight)
			if (mesh.mark === "dropped") {
				this.scaleDice([mesh], 1)
				this.pops.forEach(pop => { pop.meshes = pop.meshes.filter(m => m !== mesh) })
				this.DiceFactory.dropResult(mesh)
			} else if (glow) {
				this.DiceFactory.glowResult(mesh, glow, style, color)
			} else {
				this.DiceFactory.unglow(mesh)
			}
		}
		if (!this.rolling && !this.popping()) this.renderer.render(this.scene, this.camera)
	}

	// A brief scale-up and settle, run by the render loop. Bodies are at rest and only the meshes are
	// scaled (and lifted so they stay on the table), so physics and results are untouched. With sweep
	// it also runs the gilded shimmer across the numbers, once. With twinkle, glitter flecks fade their
	// glints in and shimmer slowly for TWINKLE_MS, then hold still.
	popDice(meshes, sweep = false, twinkle = false) {
		const now = performance.now()
		if (meshes.length) this.pops.push({ meshes, start: now })
		if (sweep) this.sweepStart = now
		if (twinkle) this.twinkleStart = now
		this.requestFrame()
	}

	popping() {
		return this.pops.length > 0 || this.sweepStart !== null || this.twinkleStart !== null
	}

	animatePops(now = performance.now()) {
		const active = this.popping()
		this.pops = this.pops.filter(pop => {
			const t = Math.min(1, (now - pop.start) / POP_MS)
			const rise = 0.3
			const k = t < rise ? 1 - (1 - t / rise) ** 3 : 1 - smoothstep(0, 1, (t - rise) / (1 - rise))
			this.scaleDice(pop.meshes, 1 + POP_SCALE * k)
			return t < 1
		})
		if (this.sweepStart !== null) {
			const elapsed = now - this.sweepStart
			this.DiceFactory.gild_sweep.value = elapsed < SWEEP_MS ? -0.3 + 1.6 * elapsed / SWEEP_MS : 2
			if (elapsed >= SWEEP_MS) this.sweepStart = null
		}
		const glint = this.DiceFactory.glint_state.value
		// flecks never glint while dice tumble, so they don't flicker from frame to frame
		if (this.throws.length) glint.x = 0
		else if (this.twinkleStart !== null) {
			const elapsed = now - this.twinkleStart
			glint.set(smoothstep(0, 0.4, elapsed / TWINKLE_MS), Math.min(elapsed, TWINKLE_MS) / 1000)
			if (elapsed >= TWINKLE_MS) this.twinkleStart = null
		}
		return active
	}

	scaleDice(meshes, scale) {
		for (const mesh of meshes) {
			mesh.scale.setScalar(scale)
			if (mesh.body) mesh.position.z = mesh.body.position.z + (scale - 1) * mesh.geometry.boundingSphere.radius * 0.5
		}
	}

	endPop() {
		this.pops.forEach(pop => this.scaleDice(pop.meshes, 1))
		this.pops = []
		this.sweepStart = null
		this.twinkleStart = null
		this.DiceFactory.gild_sweep.value = 2
		this.DiceFactory.glint_state.value.x = 0
	}

	// throwFrom: "any" (a random direction), "sides" (from the left or right wall), "left", "right".
	// Returns +1 for a throw to the right, -1 to the left, 0 for any direction.
	throwSide(throwFrom = this.throwFrom) {
		switch (throwFrom) {
			case "sides": return Math.random() < 0.5 ? 1 : -1
			case "left": return 1
			case "right": return -1
			default: return 0
		}
	}

	startClickThrow(notation, options = {}) {
		const side = this.throwSide(options.throwFrom ?? this.throwFrom)
		if (side) {
			// mostly sideways, fast enough to cross the box whatever its size: a die sliding on the
			// felt loses about 0.6 g, so this speed carries it most of the way and off the far wall
			const vector = { x: side, y: (Math.random() * 2 - 1) * 0.25 }
			const width = 2 * this.display.containerWidth * this.wallScale
			const speed = Math.sqrt(2 * 0.6 * 9.8 * this.gravity_multiplier * 0.9 * width) * (0.85 + 0.3 * Math.random()) * this.strength
			return this.getNotationVectors(notation, vector, speed, Math.hypot(vector.x, vector.y), side)
		}

		let vector = { x: (Math.random() * 2 - 0.5) * this.display.currentWidth, y: -(Math.random() * 2 - 0.5) * this.display.currentHeight };
		let dist = Math.sqrt(vector.x * vector.x + vector.y * vector.y) + 100;
		let boost = (Math.random() + 3) * dist * this.strength;

		const notationVectors = this.getNotationVectors(notation, vector, boost, dist);

		return notationVectors
	}

	// Removes every die. With {fade: ms} the canvas fades out first (a CSS opacity transition, so
	// nothing is re-rendered) and a promise resolves once the dice are gone. A roll that starts
	// mid-fade cancels it. Throws still rolling are dropped and never resolve.
	clearDice({ fade = 0 } = {}) {
		const token = ++this.clearToken;
		const canvas = this.renderer && this.renderer.domElement;
		if (fade > 0 && canvas && this.diceList.length) {
			canvas.style.transition = `opacity ${fade}ms ease-out`;
			canvas.style.opacity = '0';
			return new Promise(resolve => setTimeout(resolve, fade)).then(() => {
				if (token === this.clearToken) this.clearDice();
			});
		}
		this.cancelFade();

		this.throws = [];
		if (this.rolling) {
			this.rolling = false;
			if (this.pendingWorldBox) this.makeWorldBox();
		}
		this.endPop();
		let dice;
		while (dice = this.diceList.pop()) {
			this.scene.remove(dice);
			if (dice.body) this.world.removeBody(dice.body);
		}
		this.renderer.render(this.scene, this.camera);
	}

	cancelFade() {
		const canvas = this.renderer && this.renderer.domElement;
		if (!canvas) return;
		canvas.style.transition = '';
		canvas.style.opacity = '';
	}

	// Tears the box down: stops listening for resizes, frees GPU memory and removes the canvas.
	dispose() {
		this.clearDice();
		window.removeEventListener("resize", this.onResize);
		if (this.resizeObserver) this.resizeObserver.disconnect();
		this.DiceFactory.dispose();
		if (this.envTarget) this.envTarget.dispose();
		this.envTarget = null;
		if (this.light) this.light.dispose();
		if (this.desk) {
			this.desk.geometry.dispose();
			this.desk.material.dispose();
		}
		this.renderer.dispose();
		this.renderer.forceContextLoss();
		this.renderer.domElement.remove();
		this.initialized = false;
		this.disposed = true;
	}

	getDiceResults(id){
		if(id !== undefined){
			return {
				type: this.diceList[id].shape,
				sides: parseInt(this.diceList[id].shape.substring(1)),
				id,
				...this.diceList[id].result.at(-1)
			}
		}
		return this.rollResults(this.notationVectors, 0)
	}

	// The results of one roll() whose dice start at `first` in diceList.
	rollResults(notationVectors, first) {
		let counter = first
		const modifier = notationVectors.constant ? parseInt(`${notationVectors.op}${notationVectors.constant}`) : 0
		let rollTotal = modifier
		const result = {
			notation: notationVectors.notation,
			sets: notationVectors.set.map(set => {
				const endCount = counter + set.num - 1
				let setTotal = 0
				const rolls = []
				for (let index = counter; index <= endCount; index++) {
					if(this.diceList[counter].result.at(-1).reason === "remove") {
						counter++
						continue
					}
					rolls.push({
						type: set.type,
						sides: parseInt(set.type.substring(1)),
						id: counter,
						...this.diceList[counter].result.at(-1)
					})
					setTotal += this.diceList[counter].result.at(-1).value
					counter++
				}
				const returnSet = {
					num: set.num,
					type: set.type,
					sides: parseInt(set.type.substring(1)),
					rolls,
					total: setTotal,
				}
				rollTotal += setTotal
				return returnSet
			}),
			modifier,
			total: rollTotal
		}
		return result
	}

	// The themes of a throw: the box's own, or one per colorset given (cycled over its dice).
	// Synchronous when every theme is ready, so dice spawn in the same call (and markDice can follow
	// it at once); otherwise a promise.
	throwThemes(colorset) {
		if (!colorset) return [this.boxResolved]
		const list = Array.isArray(colorset) ? colorset : [colorset]
		const ready = list.map(c => this.resolvedThemes.get(themeKey(c, this)))
		if (ready.every(Boolean)) return ready
		return Promise.all(list.map(c => this.resolveTheme(c)))
	}

	withThemes(colorset, start) {
		const themes = this.throwThemes(colorset)
		return themes instanceof Promise ? themes.then(start) : start(themes)
	}

	spawnThrow(notationVectors, themes) {
		const meshes = notationVectors.vectors.map((vector, i) => this.spawnDice(vector, themes[i % themes.length]))
		this.trimThemes()
		return meshes
	}

	// roll(notation, { colorset, clear, throwFrom, highlightResult, onImpact }): colorset is a stock colorset name
	// or a custom colorset (or an array of them, one per die in order, cycled), for this throw only;
	// clear: false keeps the dice on the table and the throws still rolling, and resolves with the
	// results of this throw alone.
	async roll(notationSting, options = {}){
		return this.withThemes(options.colorset, themes => {
			const clear = options.clear !== false
			if (clear) this.clearDice()
			else {
				++this.clearToken
				this.cancelFade()
			}
			const notationVectors = this.startClickThrow(notationSting, options)
			if (clear) this.notationVectors = notationVectors
			const first = this.diceList.length
			return new Promise(resolve => {
				const finish = () => {
					const results = this.rollResults(notationVectors, first)

					// setting up a couple of ways to consume the final results
					// call onRollComplete
					this.onRollComplete(results)

					// dispatch an event with the results object for other UI elements to listen for
					const event = new CustomEvent('rollComplete', {detail: results})
					document.dispatchEvent(event)

					resolve(results)
				}
				if (notationVectors.error) return finish()
				const meshes = this.spawnThrow(notationVectors, themes)
				this.launch(meshes, notationVectors.result, () => {
					this.highlightDice(meshes, options.highlightResult)
					finish()
				}, options.onImpact)
			})
		})
	}

	// Rerolls dice on the table by id. Dice still rolling are left alone.
	async reroll(diceIdArray) {
		const meshes = diceIdArray.map(dieId => this.diceList[dieId]).filter(mesh => mesh && mesh.parent && !mesh.moving)
		return new Promise((resolve,reject) => {
			meshes.forEach(dicemesh => {
				this.scaleDice([dicemesh], 1)
				this.DiceFactory.unglow(dicemesh)
				dicemesh.mark = null
				dicemesh.rerolls += 1;
				dicemesh.rerolling = true;
				dicemesh.moving = true;
				dicemesh.body.wakeUp();
				dicemesh.body.type = CANNON.Body.DYNAMIC;
				dicemesh.body.angularVelocity = new CANNON.Vec3(25, 25, 25);
				dicemesh.body.velocity = new CANNON.Vec3(0, 0, 3000);
			})
			this.launch(meshes, [], () => {
				this.highlightDice(meshes, meshes[0] && meshes[0].highlight)
				const results = diceIdArray.map(dieId => this.getDiceResults(dieId))

				this.onRerollComplete(results)

				// dispatch an event with the results object for other UI elements to listen for
				const event = new CustomEvent('rerollComplete', {detail: results})
				document.dispatchEvent(event)

				resolve(results)
			})
		})
	}

	// add(notation, { colorset, throwFrom, highlightResult, onImpact }): throws more dice without clearing the
	// table, even while other throws are still rolling, and resolves with the results of its dice.
	async add(notationSting, options = {}){
		return this.withThemes(options.colorset, themes => {
			if (!this.diceList.length) return this.roll(notationSting, options)

			// keep the dice on the table if a fade-out was under way
			++this.clearToken
			this.cancelFade()

			const addNotationVectors = this.startClickThrow(notationSting, options)
			const first = this.diceList.length
			const meshes = this.spawnThrow(addNotationVectors, themes)
			const diceIdArray = meshes.map((mesh, i) => mesh ? first + i : null).filter(id => id !== null)

			// let our vectors combine
			this.notationVectors = DiceNotation.mergeNotation(this.notationVectors, addNotationVectors)

			return new Promise((resolve,reject) => {
				this.launch(meshes, addNotationVectors.result, () => {
					this.highlightDice(diceIdArray.map(dieId => this.diceList[dieId]), options.highlightResult)
					const results = diceIdArray.map(dieId => this.getDiceResults(dieId))

					// setting up a couple of ways to consume the dice added results
					// call onAddDiceComplete
					this.onAddDiceComplete(results)

					// dispatch an event with the results object for other UI elements to listen for
					const event = new CustomEvent('addDiceComplete', {detail: results})
					document.dispatchEvent(event)

					resolve(results)
				}, options.onImpact)
			})
		})
	}

	async remove(diceIdArray){

		return new Promise((resolve,reject) => {
			const results = []
			diceIdArray.forEach(dieId => {
				const mesh = this.diceList[dieId]
				if (mesh.body) this.world.removeBody(mesh.body);
				this.scene.remove(mesh);
				mesh.storeRolledValue('remove');
				results.push(this.getDiceResults(dieId))
			})

			this.renderer.render(this.scene, this.camera);

			this.onRemoveDiceComplete(results)

			// dispatch an event with the results object for other UI elements to listen for
			const event = new CustomEvent('removeDiceComplete', {detail: results})
			document.dispatchEvent(event)

			resolve(results)

		})
	}
}

export { DiceBox }
