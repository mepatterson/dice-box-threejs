import * as THREE from "three"
import * as CANNON from "cannon-es"

import { DiceNotation } from './DiceNotation.js';
import { DiceFactory } from './DiceFactory.js';
import { DiceColors } from './DiceColors.js';
import { THEMES } from './const/themes.js';
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
	light_intensity: 0.7,
	baseScale: 100,
	strength: 1,
	iterationLimit: 1000,
	maxPixelRatio: 2,
	textureScale: 0.5,
	preloadDice: null,
	onRollComplete: () => {},
	onRerollComplete: () => {},
	onAddDiceComplete: () => {},
	onRemoveDiceComplete: () => {},
}

const SPOT_INTENSITY = 2.0
const HEMI_INTENSITY = 2.0
const SHADOW_RADIUS = 4

class DiceBox {

	constructor(element_container, options = {}) {
		//private variables
		this.initialized = false
		this.container = document.querySelector(element_container);
		this.dimensions = new THREE.Vector2(this.container.clientWidth, this.container.clientHeight)
		this.adaptive_timestep = false;
		this.last_time = 0;
		this.running = false;
		this.rolling = false;
		this.threadid;

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
		this.iteration;
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

		this.DiceColors = new DiceColors({assetPath: this.assetPath});
		this.DiceFactory = new DiceFactory({
			baseScale: this.baseScale,
			textureScale: this.textureScale
		});
		this.DiceFactory.setBumpMapping(true);

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
	async preload(types = ["d6"]) {
		const meshes = []
		for (const type of types) {
			const mesh = this.DiceFactory.create(type, this.colorData)
			if (!mesh) continue
			mesh.castShadow = this.shadows
			mesh.position.set(0, 0, -1000)
			meshes.push(mesh)
			this.scene.add(mesh)
		}
		try {
			if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera)
			else this.renderer.compile(this.scene, this.camera)
		} finally {
			meshes.forEach(mesh => this.scene.remove(mesh))
		}
	}

	makeWorldBox(){
		if(!Object.keys(this.box_body).length) {
			const desk_body_material = new CANNON.Material();
			const barrier_body_material = new CANNON.Material();

			this.world.addContactMaterial(new CANNON.ContactMaterial( desk_body_material, this.dice_body_material, {mass:0,friction: 0.6, restitution: 0.5}));
			this.world.addContactMaterial(new CANNON.ContactMaterial( barrier_body_material, this.dice_body_material, {mass:0, friction: 0.6, restitution: 1.0}));
			this.world.addContactMaterial(new CANNON.ContactMaterial( this.dice_body_material, this.dice_body_material, {mass:0,friction: 0.6, restitution: 0.5}));

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

		const w = this.display.containerWidth * 0.93
		const h = this.display.containerHeight * 0.93
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

	pixelRatio() {
		return Math.min(window.devicePixelRatio || 1, this.maxPixelRatio || Infinity)
	}

	async loadTheme(themeConfig){
		let colorData
		if(this.theme_customColorset){
			colorData = await this.DiceColors.makeColorSet(this.theme_customColorset)
		} else {
			colorData = await this.DiceColors.getColorSet(themeConfig)
		}
		this.DiceFactory.applyColorSet(colorData)
		this.colorData = colorData
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

		const hassound_dieMaterial = this.colorData.texture.material.match(/wood|metal/g)

		this.sound_dieMaterial = hassound_dieMaterial ? this.colorData.texture.material : "plastic"
		
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
			shadowplane.opacity = 0.5;
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
	getNotationVectors(notation, vector, boost, dist){

		let notationVectors = new DiceNotation(notation);

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

				let pos = {
					x: this.display.containerWidth * (vec.x > 0 ? -1 : 1) * 0.9,
					y: this.display.containerHeight * (vec.y > 0 ? -1 : 1) * 0.9,
					z: Math.random() * 200 + 200
				};

				let projector = Math.abs(vec.x / vec.y);
				if (projector > 1.0) pos.y /= projector; else pos.x *= projector;

				let velvec = this.vectorRand(vector);
				velvec.x /= dist;
				velvec.y /= dist;
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
		const base = this.DiceFactory.createMaterials(diceobj, 0, 0, true, num);
		const faceMap = base.map((m, i) => i < 2 ? i : ((i - 2 + num) % 4) + 2);
		dicemesh.material = faceMap.map(i => base[i]);
		dicemesh.faceMap = faceMap;
		dicemesh.result = [];
	}

	//spawns one dicemesh object from a single vectordata object
	spawnDice(vectordata, reset = false) {
		const {pos, axis, angle, velocity} = vectordata
		let dicemesh
		
		if(!reset) {
			dicemesh = this.DiceFactory.create(vectordata.type, this.colorData);
			if(!dicemesh) return;
			dicemesh.notation = vectordata;
			dicemesh.result = [];
			dicemesh.stopped = 0;
			dicemesh.castShadow = this.shadows;
			this.scene.add(dicemesh);
			this.diceList.push(dicemesh);
		} else {
			dicemesh = reset
			// dicemesh.result = [];
			dicemesh.stopped = 0;
			this.world.removeBody(dicemesh.body);
		}

		dicemesh.body = new CANNON.Body({allowSleep: true, sleepSpeedLimit: 75, sleepTimeLimit:0.9, mass: dicemesh.mass, shape: dicemesh.geometry.cannon_shape, material: this.dice_body_material});
		dicemesh.body.type = CANNON.Body.DYNAMIC;
		dicemesh.body.position.set(pos.x, pos.y, pos.z);
		dicemesh.body.quaternion.setFromAxisAngle(new CANNON.Vec3(axis.x, axis.y, axis.z), axis.a * Math.PI * 2);
		dicemesh.body.angularVelocity.set(angle.x, angle.y, angle.z);
		dicemesh.body.velocity.set(velocity.x, velocity.y, velocity.z);
		dicemesh.body.linearDamping = 0.1;
		dicemesh.body.angularDamping = 0.1;
		dicemesh.body.diceShape = dicemesh.shape;
		dicemesh.body.sleepState = 0;

		dicemesh.body.addEventListener('collide', this.eventCollide.bind(this));

		this.world.addBody(dicemesh.body);
	}

	eventCollide({body, target}) {

		// collision events happen simultaneously for both colliding bodies
		// all this sanity checking helps limits sounds being played

		// don't play sounds if we're simulating
		if (this.animstate == 'simulate') return;
		if (!this.sounds || !body) return;

		// let volume = parseInt(window.DiceFavorites.settings.volume.value) || 0;
		if (this.volume <= 0) return;

		let now = Date.now();
		let currentSoundType = (body.mass > 0) ? 'dice' : 'table';

		// the idea here is that a dice clack should never be skipped in favor of a table sound
		// if ((don't play sounds if we played one this world step, or there hasn't been enough delay) AND 'this sound IS NOT a dice clack') then 'skip it'
		if ((this.lastSoundStep == body.world.stepnumber || this.lastSound > now) && currentSoundType != 'dice') return;

		// also skip if it's too early and both last sound and this sound are the same
		if ((this.lastSoundStep == body.world.stepnumber || this.lastSound > now) && currentSoundType == 'dice' && this.lastSoundType == 'dice') return;

		if (body.mass > 0) { // dice to dice collision

			let speed = body.velocity.length();
			// also don't bother playing at low speeds
			if (speed < 250) return;

			let sound;

			if(body.diceShape === "d2") {
				sound = this.sounds_dice['coin'][Math.floor(Math.random() * this.sounds_dice['coin'].length)];
			}
			else {
				sound = this.sounds_dice[this.sound_dieMaterial][Math.floor(Math.random() * this.sounds_dice[this.sound_dieMaterial].length)];
			}
			if(sound){
				sound.volume = Math.min(speed / 8000, this.volume/100)
				sound.play().catch(error => {});
			}
			// if (isPlaying !== undefined) {
			// 	isPlaying.then(() => {
			// 		// Autoplay started!
			// 	}).catch(error => {
			// 		// Autoplay was prevented.
			// 		// console.warn('Sounds muted by autoplay')
			// 	});
			// }
			this.lastSoundType = 'dice';


		} else { // dice to table collision
			let speed = target.velocity.length();
			// also don't bother playing at low speeds
			if (speed < 250) return;

			let surface = this.surface;

			let soundlist = this.sounds_table[surface];
			let sound = soundlist[Math.floor(Math.random() * soundlist.length)];
			if(sound){
				sound.volume = Math.min(speed / 8000, this.volume/100)
				sound.play().catch(error => {});
			}
			// if (isPlaying !== undefined) {
			// 	isPlaying.then(() => {
			// 		// Autoplay started!
			// 	}).catch(error => {
			// 		// Autoplay was prevented.
			// 		// console.warn('Sounds muted by autoplay')
			// 	});
			// }
			this.lastSoundType = 'table';
		}

		this.lastSoundStep = body.world.stepnumber;
		this.lastSound = now + this.soundDelay;
	}

	checkForRethrow(dicemesh) {
		// all dice in a set/dice group will have the same function and arguments due to sorting beforehand
		// this means the list passed in is the set of dice that need to be affected by this function
		let diceFunc = (dicemesh.notation.func) ? dicemesh.notation.func.toLowerCase() : '';
		// let funcdata = this.DiceFunctions.rethrowFunctions[diceFunc];
		let funcdata

		let reroll = false;
			
		if (diceFunc != '' && funcdata && funcdata.method) {
			diceFunc = dicemesh.notation.func.toLowerCase();
			let diceFuncArgs = dicemesh.notation.args || '';
			reroll = funcdata.method(dicemesh, diceFuncArgs);
		}

		return reroll;
	}

	throwFinished() {
		const forcedFinish = this.iteration > this.iterationLimit

		// cycle through diceList and if any dice are still awake then return false
		for (let i=0, len=this.diceList.length; i < len; ++i) {
			const dicemesh = this.diceList[i];
			const sleepState = CANNON.Body.SLEEPING

			if (dicemesh.body.sleepState < sleepState && !forcedFinish) {
				return false;
			}

			if (dicemesh.body.sleepState == sleepState || forcedFinish) {
				if(dicemesh.body.type === CANNON.Body.KINEMATIC){
					continue
				}

				let rethrow = false;

				//check for forced roll
				if (dicemesh.result.length == 0) {
					dicemesh.storeRolledValue(dicemesh.resultReason);
					rethrow = this.checkForRethrow(dicemesh);
				} else if (dicemesh.result.length > 0 && dicemesh.rerolling) {
					dicemesh.rerolling = false;
					dicemesh.storeRolledValue('reroll');
					rethrow = this.checkForRethrow(dicemesh);
				}

				if (rethrow) {
					dicemesh.rerolls += 1;
					dicemesh.rerolling = true;
					dicemesh.body.wakeUp();
					dicemesh.body.type = CANNON.Body.DYNAMIC;
					dicemesh.body.angularVelocity = new CANNON.Vec3(25, 25, 25);
					dicemesh.body.velocity = new CANNON.Vec3(0, 0, 3000);
					return false;
				}

				dicemesh.rerolling = false;
				dicemesh.body.type = CANNON.Body.KINEMATIC;
				
			}
		}
		return true;
	}

	simulateThrow() {
		this.animstate = 'simulate';
		this.iteration = 0;
		this.rolling = true;
		while (!this.throwFinished(true)) {
			++this.iteration;
			this.world.step(this.framerate);
		}
	}

	animateThrow(threadid, callback){
		this.animstate = 'throw';
		let time = Date.now();
		this.last_time = this.last_time || time - (this.framerate*1000);
		let time_diff = (time - this.last_time) / 1000;
		let neededSteps = Math.floor(time_diff / this.framerate);

		// Check before every step, the way simulateThrow does, so the replay freezes each die on
		// the same step the simulation did and lands on the same face.
		let finished = false;
		let steps = 0;
		for(; steps < neededSteps; steps++) {
			if (this.running == threadid && this.throwFinished()) {
				finished = true;
				break;
			}
			++this.iteration;
			this.world.step(this.framerate);
			++this.steps;
		}

		// update physics interactions visually
		for (let i = 0, l = this.diceList.length; i < l; i++) {
			const dicemesh = this.diceList[i];
			if (dicemesh.body) {
				dicemesh.position.copy(dicemesh.body.position);
				dicemesh.quaternion.copy(dicemesh.body.quaternion);
			}
		}

		this.renderer.render(this.scene, this.camera);
		this.last_time = this.last_time + steps*this.framerate*1000;

		// roll finished
		if (this.running == threadid && finished) {
			this.running = false;
			this.rolling = false;
			if (this.pendingWorldBox) this.makeWorldBox();
			if(callback) callback.call(this, this.notationVectors);
			
			this.running = Date.now();
			this.animateAfterThrow(this.running);
			return;
		}

		// roll not finished, keep animating
		if (this.running == threadid) {
			((animateCallback, tid, at, aftercall, vecs) => {
				if (!at && time_diff < this.framerate) {
					setTimeout(() => { requestAnimationFrame(() => { animateCallback.call(this, tid, aftercall, vecs); }) }, (this.framerate - time_diff) * 1000);
				} else {
					requestAnimationFrame(() => { animateCallback.call(this, tid, aftercall, vecs); });
				}
			}).bind(this)(this.animateThrow, threadid, this.adaptive_timestep, callback);
		}
	}

	animateAfterThrow(threadid) {
		this.animstate = 'afterthrow';
		let time = Date.now();
		let time_diff = (time - this.last_time) / 1000;
		if (time_diff > 3) time_diff = this.framerate;

		this.running = false;
		this.last_time = time;
		this.renderer.render(this.scene, this.camera);
		if (this.running == threadid) {
			((animateCallback, tid, at) => {
				if (!at && time_diff < this.framerate) {
					setTimeout(() => { requestAnimationFrame(() => { animateCallback.call(this, tid); }) }, (this.framerate - time_diff) * 1000);
				} else {
					requestAnimationFrame(() => { animateCallback.call(this, tid); });
				}
			}).bind(this)(this.animateAfterThrow, threadid, this.adaptive_timestep);
		}
	}

	startClickThrow(notation) {
		// if (this.rolling) return;
		if(this.rolling) {
			this.clearDice();
			this.rolling = false
		}

		let vector = { x: (Math.random() * 2 - 0.5) * this.display.currentWidth, y: -(Math.random() * 2 - 0.5) * this.display.currentHeight };
		let dist = Math.sqrt(vector.x * vector.x + vector.y * vector.y) + 100;
		let boost = (Math.random() + 3) * dist * this.strength;

		const notationVectors = this.getNotationVectors(notation, vector, boost, dist);

		return notationVectors
	}

	// Removes every die. With {fade: ms} the canvas fades out first (a CSS opacity transition, so
	// nothing is re-rendered) and a promise resolves once the dice are gone. A roll that starts
	// mid-fade cancels it.
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
		if (canvas) {
			canvas.style.transition = '';
			canvas.style.opacity = '';
		}

		this.running = false;
		let dice;
		while (dice = this.diceList.pop()) {
			this.scene.remove(dice); 
			if (dice.body) this.world.removeBody(dice.body);
		}
		this.renderer.render(this.scene, this.camera);
	}

	// Tears the box down: stops listening for resizes, frees GPU memory and removes the canvas.
	dispose() {
		this.clearDice();
		window.removeEventListener("resize", this.onResize);
		if (this.resizeObserver) this.resizeObserver.disconnect();
		this.DiceFactory.dispose();
		if (this.light) this.light.dispose();
		if (this.desk) {
			this.desk.geometry.dispose();
			this.desk.material.dispose();
		}
		this.renderer.dispose();
		this.renderer.forceContextLoss();
		this.renderer.domElement.remove();
		this.initialized = false;
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
		let counter = 0
		const modifier = this.notationVectors.constant ? parseInt(`${this.notationVectors.op}${this.notationVectors.constant}`) : 0
		let rollTotal = modifier
		const result = {
			notation: this.notationVectors.notation,
			sets: this.notationVectors.set.map(set => {
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

	async roll(notationSting){
		this.notationVectors = this.startClickThrow(notationSting)
		if(this.notationVectors){
			// const DL = this.diceList
			return new Promise((resolve,reject) => {
				this.rollDice(() => {
					const results = this.getDiceResults()
	
					// setting up a couple of ways to consume the final results
					// call onRollComplete 
					this.onRollComplete(results)
	
					// dispatch an event with the results object for other UI elements to listen for
					const event = new CustomEvent('rollComplete', {detail: results})
					document.dispatchEvent(event)
	
					resolve(results)
				})
			})
		}
	}

	async reroll(diceIdArray) {
		this.rolling = true;
		this.running = Date.now();
		this.iteration = 0
		return new Promise((resolve,reject) => {
			diceIdArray.forEach(dieId => {
				const dicemesh = this.diceList[dieId]
				dicemesh.rerolls += 1;
				dicemesh.rerolling = true;
				dicemesh.body.wakeUp();
				dicemesh.body.type = CANNON.Body.DYNAMIC;
				dicemesh.body.angularVelocity = new CANNON.Vec3(25, 25, 25);
				dicemesh.body.velocity = new CANNON.Vec3(0, 0, 3000);
			})
			this.animateThrow(this.running, () => {
				const results = diceIdArray.map(dieId => this.getDiceResults(dieId))

				this.onRerollComplete(results)
				
				// dispatch an event with the results object for other UI elements to listen for
				const event = new CustomEvent('rerollComplete', {detail: results})
				document.dispatchEvent(event)

				resolve(results)
			})
		})
	}

	async add(notationSting){
		let dieCount = this.diceList.length
		if(!dieCount) return this.roll(notationSting)

		// keep the dice on the table if a fade-out was under way
		++this.clearToken
		this.renderer.domElement.style.transition = ''
		this.renderer.domElement.style.opacity = ''

		let addNotationVectors = this.startClickThrow(notationSting)
		let diceIdArray = []

		for (let i=0, len=addNotationVectors.vectors.length; i < len; ++i) {
			this.spawnDice(addNotationVectors.vectors[i]);
		}

		this.simulateThrow();
		this.steps = 0;
		this.iteration = 0;

		//reset dice vectors - for just the dice added
		for (let i=0, len=addNotationVectors.vectors.length; i < len; ++i) {
			const index = dieCount + i
			if (!this.diceList[index]) continue;

			//reset dice vectors
			this.spawnDice(addNotationVectors.vectors[i], this.diceList[index]);
			diceIdArray.push(index)
		}

		//check forced results, fix dice faces if necessary
		if (addNotationVectors.result && addNotationVectors.result.length > 0) {
			for (let i=0;i<addNotationVectors.result.length;i++) {
				const index = dieCount + i
				let dicemesh = this.diceList[index];
				if (!dicemesh) continue;
				if (dicemesh.getLastValue().value == addNotationVectors.result[i]) continue;
				this.swapDiceFace(dicemesh, addNotationVectors.result[i]);
			}
		}
		


		// let our vectors combine
		this.notationVectors = DiceNotation.mergeNotation(this.notationVectors, addNotationVectors)

		return new Promise((resolve,reject) => {
			const callback = () => {
				const results = diceIdArray.map(dieId => this.getDiceResults(dieId))
	
				// setting up a couple of ways to consume the dice added results
				// call onAddDiceComplete 
				this.onAddDiceComplete(results)
	
				// dispatch an event with the results object for other UI elements to listen for
				const event = new CustomEvent('addDiceComplete', {detail: results})
				document.dispatchEvent(event)
	
				resolve(results)
			}

			// animate the previously simulated roll
			this.rolling = true;
			this.running = Date.now();
			this.last_time = 0;
			this.animateThrow(this.running, callback);
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

	rollDice(callback){

		if (this.notationVectors.error) {
			callback.call(this);
			return;
		}

		// this.camera.position.z = this.cameraHeight.far;
		this.clearDice();

		for (let i=0, len=this.notationVectors.vectors.length; i < len; ++i) {
			this.spawnDice(this.notationVectors.vectors[i]);
		}
		this.simulateThrow();
		this.steps = 0;
		this.iteration = 0;

		for (let i=0, len=this.diceList.length; i < len; ++i) {
			if (!this.diceList[i]) continue;
			
			//reset dice vectors
			this.spawnDice(this.notationVectors.vectors[i],this.diceList[i]);
		}
		
		//check forced results, fix dice faces if necessary
		if (this.notationVectors.result && this.notationVectors.result.length > 0) {
			for (let i=0;i<this.notationVectors.result.length;i++) {
				let dicemesh = this.diceList[i];
				if (!dicemesh) continue;
				if (dicemesh.getLastValue().value == this.notationVectors.result[i]) continue;
				this.swapDiceFace(dicemesh, this.notationVectors.result[i]);
			}
		}

		// animate the previously simulated roll
		this.rolling = true;
		this.running = Date.now();
		this.last_time = 0;
		this.animateThrow(this.running, callback);

	}
}

export { DiceBox }