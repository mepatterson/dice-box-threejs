"use strict";
import {DicePreset} from './DicePreset.js'
import {MATERIALTYPES} from "./const/materialtypes"
import {DICE_GEOM} from "./const/dice"
import {woodGrain, makeSurface, spectrumLayer} from "./surfaces.js"
import {fontOf, fontKey, fontMetrics} from "./fonts.js"
import {GEOM_PARAMS, buildShaped, shapeOf, shapeKey} from "./shapes.js"
import {MAX_SHELLS, FUZZ_DEFAULTS, strandField, shellGeometry, shellMaterial} from "./fuzz.js"
import {pixelOf, buildPalette, fontFor, paintLabels, rgba, nearestTexture, pixelShader} from "./pixel.js"

import * as THREE from "three"
import * as CANNON from "cannon-es"

const SHAPED_CACHE = 24;
// A pixel label's canvas pixels per texel: its numbers are drawn turned at this resolution, so their
// edges stay crisp under the nearest filtering.
const PIXEL_UNIT = 4;
// The ring around a highlighted pixel stamp.
const PIXEL_INK = '#140c08';
// A dropped pixel die's number, darkened like dimShader does its body.
const dimColor = color => `#${new THREE.Color(color).multiplyScalar(0.6).getHexString()}`;

const defaultConfig = {
	baseScale: 100,
	bumpMapping: true,
	textureScale: 0.5,
	glass_opacity: 0.35,
	// the most fur shells a die with a fuzzy texture draws (the box sets it by device); 0 draws none
	fuzzShells: MAX_SHELLS
}

// Glass writes premultiplied colour so its reflections are added on top of what shows through the
// body instead of fading with the body's alpha, and a pixel is as opaque as its brightest
// reflection, so highlights stay solid over a page behind a transparent canvas. Reflections are
// the dielectric ones (about 4% head-on, strong at grazing angles) and never tinted. The tint is
// in the light passing through: the body shows the room bent through the die (refracted, then
// bounced off the table, so it is lit from above), filtered by the glass colour over a path that
// is short in the middle of the die and long at its rim, so the middle is clear and the rim deep.
// Faces are treated as slightly domed for small, capped glints from two key lights. Bevels are
// thicker glass: deeper body colour, their grazing reflections tinted by it, with only the bright
// ones left white; glassEdges (0 to 1) scales how much they stand out.
// glassRefraction is x: ior, y: strength, z: dispersion. The painted numbers are matte.
// An iridescent glass (a pearl or opal finish, or a colorset's iridescence) adds a thin-film
// shimmer: three's film colour for the domed normal and a film that thickens towards the rim, mostly
// its hue, lit by a blurred reflection of the room with a floor so it shows in a dark room too. Faint
// reflections are cut on glass, which would drop three's own film term, so this one is added after.
// The body opacity, refraction and edges are uniforms, so glass dice of every colorset share programs.
const GLASS_FILM = { STRENGTH: 0.16, SATURATION: 1.3, FLOOR: 0.18 };
function glassShader(shader, { refraction, edges, opacity }) {
	shader.uniforms.glassRefraction = refraction;
	shader.uniforms.glassEdges = edges;
	shader.uniforms.glassOpacity = opacity;
	shader.vertexShader = shader.vertexShader
		.replace('void main() {', 'varying vec3 vGlassOffset;\nvoid main() {')
		.replace('#include <project_vertex>', '#include <project_vertex>\nvGlassOffset = mvPosition.xyz - ( modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;');
	const film = Object.entries(GLASS_FILM).map(([k, v]) => `#define GLASS_FILM_${k} ${v.toFixed(3)}`).join('\n');
	shader.fragmentShader = shader.fragmentShader
		.replace('void main() {', `${film}
			uniform vec3 glassRefraction;
			uniform float glassEdges;
			uniform float glassOpacity;
			varying vec3 vGlassOffset;
			vec3 glassSeen( vec3 dir ) {
				#ifdef ENVMAP_TYPE_CUBE_UV
					dir = inverseTransformDirection( dir, viewMatrix );
					dir.z = abs( dir.z );
					return textureCubeUV( envMap, envMapRotation * dir, 0.18 ).rgb;
				#else
					return vec3( 0.5 );
				#endif
			}
			void main() {`)
		.replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', ''))
		.replace('#include <opaque_fragment>', `
			float glassBodyAlpha = GLASS_OPACITY;
			float glassPaint = saturate( ( diffuseColor.a - glassBodyAlpha ) / max( 1.0 - glassBodyAlpha, 0.0001 ) );
			float glassRim = length( vGlassOffset.xy ) / max( length( vGlassOffset ), 0.0001 );
			float glassFacing = saturate( dot( geometryNormal, geometryViewDir ) );
			float glassDepth = max( glassRim * glassRim, 1.0 - glassFacing );
			vec3 glassSpecular = totalSpecular;
			vec3 glassPainted = outgoingLight - glassSpecular;
			float glassPeak = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
			vec3 glassTint = diffuseColor.rgb / max( glassPeak, 0.0001 );
			vec3 glassFilter = pow( glassTint, vec3( 0.8 + 0.7 * glassDepth ) ) * pow( glassPeak, 0.35 + 0.25 * glassDepth );
			vec3 glassLight = vec3( 0.6 );
			vec2 glassLens = vGlassOffset.xy / max( length( vGlassOffset ), 0.0001 );
			#ifdef GLASS_REFRACTION
				vec3 glassDir = refract( - geometryViewDir, geometryNormal, 1.0 / glassRefraction.x );
				glassLight = glassSeen( normalize( glassDir - vec3( glassLens * 0.9, 0.0 ) ) );
				if ( glassRefraction.z > 0.0 ) {
					float spread = glassRefraction.z * 12.0;
					glassLight.r = glassSeen( normalize( refract( - geometryViewDir, geometryNormal, 1.0 / ( glassRefraction.x - glassRefraction.z ) ) - vec3( glassLens * 0.9 * ( 1.0 - spread ), 0.0 ) ) ).r;
					glassLight.b = glassSeen( normalize( refract( - geometryViewDir, geometryNormal, 1.0 / ( glassRefraction.x + glassRefraction.z ) ) - vec3( glassLens * 0.9 * ( 1.0 + spread ), 0.0 ) ) ).b;
				}
				glassLight = mix( vec3( 0.6 ), glassLight * envMapIntensity * 2.2, glassRefraction.y );
			#endif
			vec3 glassBody = glassFilter * glassLight + glassPainted * 0.25;
			glassBodyAlpha *= mix( 0.7, 1.45, glassDepth );
			#ifdef GLASS_EDGE
				vec3 glassThick = pow( glassTint, vec3( 1.8 ) ) * pow( glassPeak, 0.6 );
				glassBody = mix( glassThick, vec3( 1.0 ), 0.3 * glassEdges ) * glassLight * mix( 0.9, 1.6, glassEdges );
				glassBodyAlpha = mix( glassBodyAlpha, 1.0, 0.15 + 0.35 * glassEdges );
			#endif
			#ifdef GLASS_INTERIOR
				glassBody = glassFilter * glassLight * 0.6;
			#endif
			glassBodyAlpha = saturate( glassBodyAlpha );
			float glassShine = max( glassSpecular.r, max( glassSpecular.g, glassSpecular.b ) );
			glassSpecular *= smoothstep( 0.015, 0.2, glassShine ) * 1.4;
			#ifdef GLASS_EDGE
				vec3 glassEdgeTint = mix( vec3( 1.0 ), glassTint, 0.75 ) * pow( glassPeak, 0.25 );
				float glassHot = smoothstep( 0.5, 1.4, glassShine );
				glassSpecular *= mix( glassEdgeTint * mix( 0.3, 1.0, glassEdges ), vec3( mix( 0.55, 1.0, glassEdges ) ), glassHot );
			#endif
			#if defined( USE_IRIDESCENCE ) && defined( ENVMAP_TYPE_CUBE_UV ) && ! defined( GLASS_INTERIOR )
				vec3 glassFilmNormal = normalize( geometryNormal + vec3( glassLens * 0.5, 0.0 ) );
				float glassFilmCos = saturate( dot( glassFilmNormal, geometryViewDir ) );
				float glassFilmThickness = mix( iridescenceThicknessMinimum, iridescenceThicknessMaximum, 0.4 + 0.6 * glassRim );
				vec3 glassFilm = evalIridescence( 1.0, iridescenceIOR, glassFilmCos, glassFilmThickness, vec3( 0.04 ) );
				vec3 glassFilmTint = max( mix( vec3( 1.0 ), glassFilm / max( dot( glassFilm, vec3( 0.3333 ) ), 0.0001 ), GLASS_FILM_SATURATION ) - 0.4, 0.0 ) * 1.6;
				vec3 glassFilmDir = inverseTransformDirection( reflect( - geometryViewDir, glassFilmNormal ), viewMatrix );
				vec3 glassFilmLight = textureCubeUV( envMap, envMapRotation * glassFilmDir, 0.55 ).rgb * envMapIntensity;
				float glassFilmLevel = max( dot( glassFilmLight, vec3( 0.2126, 0.7152, 0.0722 ) ), GLASS_FILM_FLOOR );
				float glassFilmFresnel = 0.45 + 0.55 * pow( 1.0 - glassFilmCos, 2.0 );
				glassSpecular += glassFilmTint * glassFilmLevel * glassFilmFresnel * material.iridescence * GLASS_FILM_STRENGTH * ( 1.0 - glassPaint );
			#endif
			#ifndef GLASS_INTERIOR
				vec3 glassDome = normalize( geometryNormal + vec3( glassLens * 0.45, 0.0 ) );
				float glassGlint = pow( saturate( dot( glassDome, normalize( vec3( - 0.35, 0.45, 0.82 ) + geometryViewDir ) ) ), 1000.0 ) * 2.0;
				glassGlint += pow( saturate( dot( glassDome, normalize( vec3( 0.55, - 0.25, 0.8 ) + geometryViewDir ) ) ), 1000.0 ) * 1.0;
				glassSpecular += ( 1.0 - exp( - 2.0 * glassGlint ) ) * 1.1 * ( 1.0 - glassPaint );
			#endif
			vec3 glassColor = mix( glassBody, glassPainted, glassPaint );
			float glassCover = mix( glassBodyAlpha, 1.0, glassPaint );
			glassSpecular *= 1.0 - 0.8 * glassPaint;
			#ifdef DICE_GLINT
				glassSpecular += diceGlint;
			#endif
			float glassAlpha = glassCover + ( 1.0 - glassCover ) * saturate( max( glassSpecular.r, max( glassSpecular.g, glassSpecular.b ) ) );
			gl_FragColor = vec4( ( glassColor * glassCover + glassSpecular ) / max( glassAlpha, 0.0001 ), glassAlpha );
			#ifdef DICE_DIM
				gl_FragColor.rgb *= 0.6;
			#endif
		`);
}

function glassCompile(shader) {
	glassShader(shader, this.glassUniforms);
}

const clampEdges = amount => {
	const n = Number(amount);
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.35;
};

// glass_refraction: false | true | { ior, strength, dispersion } as x: ior, y: strength, z: dispersion
const refractionOf = (options, vector = new THREE.Vector3()) => {
	const on = Boolean(options);
	const o = typeof options === 'object' && options ? options : {};
	return vector.set(o.ior ?? 1.5, on ? (o.strength ?? 1) : 0, o.dispersion === true ? 0.02 : (o.dispersion || 0));
};

const PICKS = ['dice_color_rand', 'label_color_rand', 'label_outline_rand', 'dice_texture_rand', 'dice_material_rand', 'edge_color_rand'];

// Metal reflects the environment tinted by the body colour, so a dark body still reads as metal by
// lifting its brightest channel to a floor: METAL_FLOOR for a coloured body (dark brown becomes
// copper), but only METAL_DARK_FLOOR for a near-neutral one, so grey, blue-grey and black stay dark
// gunmetal or blackened steel instead of turning silver. The label's bump canvas doubles as a paint mask: where the numbers are drawn
// (black) the surface is matte non-metallic paint, so they stay readable against reflections. The
// mask is used close to linearly so its edges stay as smooth as the texture filtering makes them.
const METAL_FLOOR = 0.42;
const METAL_DARK_FLOOR = 0.14;
function metalShader(shader) {
	shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `
		float metalnessFactor = metalness;
		float metalPaint = 0.0;
		#ifdef USE_METALNESSMAP
			vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
			metalPaint = 1.0 - smoothstep( 0.25, 0.95, texelMetalness.r );
		#endif
		float metalPeak = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
		float metalLow = min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) );
		float metalSaturation = metalPeak < 0.001 ? 0.0 : 1.0 - metalLow / metalPeak;
		float metalFloor = mix( ${METAL_DARK_FLOOR.toFixed(3)}, ${METAL_FLOOR.toFixed(3)}, smoothstep( 0.35, 0.75, metalSaturation ) );
		vec3 metalTint = metalPeak < 0.001 ? vec3( metalFloor ) : diffuseColor.rgb * ( max( metalPeak, metalFloor ) / metalPeak );
		diffuseColor.rgb = mix( metalTint, diffuseColor.rgb, metalPaint );
		metalnessFactor *= 1.0 - metalPaint;
		roughnessFactor = mix( roughnessFactor, 0.55, metalPaint );
	`);
}

export const isMetal = material => /metal/.test(material || '');

// Plastic and wood only reflect the environment; its diffuse light would wash out their colour.
function dielectricShader(shader) {
	shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', ''));
}

// Dims and desaturates a dropped die. A pixel die only darkens, onto its palette's darker shades, which
// have no greys to desaturate to.
function dimShader(shader, pixel = false) {
	const dim = pixel ? 'diffuseColor.rgb *= 0.42;' : 'diffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, 0.4 ) * 0.55;';
	shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
		${dim}
		#include <normal_fragment_begin>`);
}

// Glitter: where the glint map (a label's bump canvas, red minus blue) has a fleck, the fleck is a
// small mirror tilted its own way (green). It always shows a steady sheen that follows the face's
// light, so it reads as a chip at any angle. On top, once the dice settle (glintState x, 0 while they
// move so nothing flickers mid-tumble), it brightens smoothly as its tilt brings a key light or a
// bright part of the room (a blurred lookup) into view, capped, with a slow per-fleck twinkle driven by
// glintState y. Both are in the fleck's own colour, only a quarter of the way to white, so an accent
// fleck gleams as a brighter accent and a white one stays white. Glass adds it to its reflections, the rest to the light. Kept off the numbers, which
// are black on that canvas.
const GLINT = { TILT: 0.6, STEADY: 0.35, ENV: 1.4, KEY: 1.1, CAP: 1.2, WHITEN: 0.25 };
function glintShader(shader, map, state) {
	shader.uniforms.glintMap = { value: map };
	shader.uniforms.glintState = state;
	const glint = Object.entries(GLINT).map(([k, v]) => `#define GLINT_${k} ${v.toFixed(3)}`).join('\n');
	shader.fragmentShader = shader.fragmentShader
		.replace('void main() {', `${glint}\nuniform sampler2D glintMap;\nuniform vec2 glintState;\nvoid main() {`)
		.replace('#include <opaque_fragment>', `
			vec3 diceGlint = vec3( 0.0 );
			vec4 glintTexel = texture2D( glintMap, vMapUv );
			float glintAmount = saturate( glintTexel.r - glintTexel.b );
			if ( glintAmount > 0.02 ) {
				vec3 glintNormal = normalize( geometryNormal );
				vec3 glintKeyDir = normalize( vec3( - 0.3, 0.5, 0.82 ) );
				float glintPeak = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
				vec3 glintTint = mix( diffuseColor.rgb / max( glintPeak, 0.0001 ), vec3( 1.0 ), GLINT_WHITEN );
				float glintSteady = GLINT_STEADY * ( 0.35 + 0.65 * saturate( dot( glintNormal, glintKeyDir ) ) );
				float glintFlash = 0.0;
				if ( glintState.x > 0.0 ) {
					vec3 glintT = normalize( cross( glintNormal, abs( glintNormal.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );
					vec3 glintB = cross( glintNormal, glintT );
					float glintTurn = glintTexel.g * 6.2832;
					vec3 glintFacet = normalize( glintNormal + ( cos( glintTurn ) * glintT + sin( glintTurn ) * glintB ) * GLINT_TILT * ( 0.4 + 0.6 * fract( glintTexel.g * 7.13 ) ) );
					vec3 glintDir = reflect( - geometryViewDir, glintFacet );
					float glintRoom = 0.0;
					#ifdef ENVMAP_TYPE_CUBE_UV
						vec3 glintSeen = textureCubeUV( envMap, envMapRotation * inverseTransformDirection( glintDir, viewMatrix ), 0.3 ).rgb * envMapIntensity;
						glintRoom = smoothstep( 0.3, 1.2, max( glintSeen.r, max( glintSeen.g, glintSeen.b ) ) );
					#endif
					float glintKey = smoothstep( 0.82, 1.0, dot( glintDir, glintKeyDir ) ) + 0.6 * smoothstep( 0.86, 1.0, dot( glintDir, normalize( vec3( 0.5, - 0.2, 0.85 ) ) ) );
					float glintTwinkle = 0.6 + 0.4 * sin( glintState.y * 5.0 + glintTexel.g * 61.0 );
					glintFlash = min( glintRoom * GLINT_ENV + glintKey * GLINT_KEY, GLINT_CAP ) * glintTwinkle * glintState.x;
				}
				diceGlint = glintTint * ( glintSteady + glintFlash ) * glintAmount;
			}
			#ifndef GLASS_OPACITY
				outgoingLight += diceGlint;
			#endif
			#include <opaque_fragment>`);
}

// A soft round glow, white in the middle and fading to nothing at the rim.
function haloTexture() {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 64;
	const context = canvas.getContext('2d');
	const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
	gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
	gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
	gradient.addColorStop(1, 'rgba(255,255,255,0)');
	context.fillStyle = gradient;
	context.fillRect(0, 0, 64, 64);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

class DiceFactory {
	static dice = {}
	constructor(options) {
		// this.dice = {};
		this.geometries = {};
		this.shaped = new Map();

		this.materials_cache = {};
		this.mesh_materials_cache = new Map();
		this.cache_hits = 0;
		this.cache_misses = 0;

		this.label_color = '';
		this.dice_color = '';
		this.edge_color = '';
		this.label_outline = '';
		this.dice_texture = '';
		this.dice_material = '';
		this.body_opacity = 1;
		this.envMap = null;
		this.envRotation = new THREE.Euler();
		this.envIntensity = 1;
		this.refraction = { value: new THREE.Vector3(1.5, 0, 0) };
		this.edges = { value: 0.35 };
		this.maxAnisotropy = 1;
		this.halo_cache = new Map();
		this.halo_texture = null;
		this.surfaces = new Map();
		this.surface_tints = new Map();
		this.dice_accent = '';
		this.dice_rainbow = false;
		this.dice_iridescence = null;
		this.label_font = null;
		this.gild_sweep = { value: 2 };
		this.glint_state = { value: new THREE.Vector2(0, 0) };
		this.themes = new Map();
		this.theme = null;
		this.themeCache = 8;
		this.fuzz_state = { value: MAX_SHELLS };
		this.strand_field = null;
		this.shell_matrix = null;
		this.shell_sets = new WeakMap();
		this.no_fuzz = new THREE.MeshBasicMaterial({ visible: false });

		this.material_options = {
			specular: 0x777777,
			color: 0xffffff,
			shininess: 5,
			flatShading: true
		};

		Object.assign(this, defaultConfig, options)
	}

	updateConfig(options = {}){
		Object.assign(this,options)
		if(options.scale){
			this.scaleGeometry()
		}
	}

	setBumpMapping(bumpMapping){
		this.bumpMapping = bumpMapping;
		this.materials_cache = {};
		this.mesh_materials_cache = new Map();
	}

	// Frees every cached geometry, texture and material on the GPU.
	dispose() {
		Object.values(this.geometries).forEach(geom => geom && geom.dispose());
		this.shaped.forEach(geom => geom.dispose());
		this.shaped = new Map();
		this.themes.forEach(theme => this.disposeTheme(theme));
		this.halo_cache.forEach(mat => mat.dispose());
		if (this.halo_texture) this.halo_texture.dispose();
		if (this.strand_field) this.strand_field.dispose();
		this.strand_field = null;
		this.shell_sets = new WeakMap();
		this.geometries = {};
		this.themes = new Map();
		this.theme = null;
		this.materials_cache = {};
		this.mesh_materials_cache = new Map();
		this.halo_cache = new Map();
		this.halo_texture = null;
		this.surfaces = new Map();
		this.surface_tints = new Map();
		this.wood_grain = null;
	}

	// A theme is one colorset with its own label textures, materials and highlight variants, so dice
	// of several colorsets can share the table and each keeps its look. Themes are kept in least
	// recently used order. Geometry, programs, the procedural surfaces and the wood grain are shared.
	useTheme(key, colordata, fontReady = true) {
		let theme = this.themes.get(key);
		if (theme) this.themes.delete(key);
		else theme = this.makeTheme(key, colordata, fontReady);
		this.themes.set(key, theme);
		this.selectTheme(theme);
		return theme;
	}

	// A colorset's own glass_edges or glass_refraction gets its own uniform; otherwise the box's
	// shared one, which updateConfig changes live.
	makeTheme(key, colordata, fontReady) {
		const edges = colordata.glass_edges;
		return {
			key, colordata, fontReady, pins: 0, pixel: pixelOf(colordata), palette: null, samples: null,
			textures: {}, materials: new Map(), glow: new Map(), variants: new Map(), tints: new Map(),
			edges: edges !== undefined && edges !== null ? { value: clampEdges(edges) } : this.edges,
			refraction: 'glass_refraction' in colordata ? { value: refractionOf(colordata.glass_refraction) } : this.refraction,
		};
	}

	selectTheme(theme) {
		this.theme = theme;
		this.applyColorSet(theme.colordata, theme.fontReady);
		this.materials_cache = theme.textures;
		this.mesh_materials_cache = theme.materials;
		this.surface_tints = theme.tints;
	}

	// Frees the least recently used themes beyond themeCache that no die in `inUse` needs.
	trimThemes(inUse = new Set()) {
		const evicted = [];
		for (const theme of this.themes.values()) {
			if (this.themes.size <= this.themeCache) break;
			if (theme === this.theme || theme.pins || inUse.has(theme)) continue;
			this.themes.delete(theme.key);
			this.disposeTheme(theme);
			evicted.push(theme.key);
		}
		return evicted;
	}

	disposeTheme(theme) {
		Object.values(theme.textures).forEach(entry => {
			entry.composite && entry.composite.dispose();
			entry.bump && entry.bump.dispose();
			entry.fuzz && entry.fuzz.dispose();
		});
		theme.materials.forEach(mat => {
			if (mat.bumpMap && mat.bumpMap.isNormalImage) mat.bumpMap.dispose();
			mat.dispose();
		});
		[...theme.glow.values(), ...theme.variants.values()].forEach(mat => {
			if (mat.emissiveMap) mat.emissiveMap.dispose();
			(mat.ownTextures || []).forEach(texture => texture && texture.dispose());
			mat.dispose();
		});
		theme.textures = {};
		theme.materials.clear();
		theme.glow.clear();
		theme.variants.clear();
		theme.tints.clear();
	}

	cachedMaterials() {
		return [...this.themes.values()].flatMap(theme => [...theme.materials.values(), ...theme.glow.values(), ...theme.variants.values()]);
	}

	ownerOf(base) {
		return base.diceTheme || this.theme;
	}

	// The label materials of a die's own theme and colour picks, for a d4 relabelled to a forced result.
	labelSet(mesh, d4specialindex) {
		const previous = this.theme;
		const picks = PICKS.map(key => this[key]);
		this.selectTheme(mesh.diceTheme);
		PICKS.forEach(key => { this[key] = mesh.picks[key]; });
		try {
			return this.createMaterials(this.get(mesh.notation.type), 0, 0, true, d4specialindex);
		} finally {
			if (previous) this.selectTheme(previous);
			PICKS.forEach((key, i) => { this[key] = picks[i]; });
		}
	}

	// Points every cached metal and glass material at a new environment.
	setEnvironment(envMap, rotation, intensity) {
		this.envMap = envMap;
		this.envRotation.copy(rotation);
		this.envIntensity = intensity;
		this.cachedMaterials().forEach(mat => this.applyEnvironment(mat));
	}

	applyEnvironment(mat) {
		if (mat.envBase === undefined) return;
		mat.envMap = this.envMap;
		mat.envMapRotation.copy(this.envRotation);
		mat.envMapIntensity = mat.envBase * this.envIntensity;
	}

	// glass_refraction: false | true | { ior, strength, dispersion }
	// Only glass that uses the box's refraction follows it; a colorset with its own keeps that.
	setRefraction(options) {
		const on = Boolean(options);
		refractionOf(options, this.refraction.value);
		this.cachedMaterials().forEach(mat => {
			if (!mat.isGlass || mat.glassUniforms.refraction !== this.refraction || ('GLASS_REFRACTION' in mat.defines) === on) return;
			if (on) mat.defines.GLASS_REFRACTION = '';
			else delete mat.defines.GLASS_REFRACTION;
			mat.needsUpdate = true;
		});
	}

	// glass_edges: 0 to 1, how much glass bevels stand out
	setGlassEdges(amount) {
		this.edges.value = clampEdges(amount);
	}

	// Which face group points up (down for a d4, which reads the face it rests on).
	topFace(mesh) {
		const vector = new THREE.Vector3(0, 0, mesh.shape == 'd4' ? -1 : 1);
		const normal = new THREE.Vector3();
		const planes = mesh.geometry.faceNormals;
		const normals = planes ? null : mesh.geometry.getAttribute('normal').array;
		let closest_face, closest_angle = Math.PI * 2;
		for (let i = 0, l = mesh.geometry.groups.length; i < l; ++i) {
			const face = mesh.geometry.groups[i];
			if (face.materialIndex == 0) continue;
			// a classic die's groups are one triangle each: 3 vertices of 3 floats; a shaped die's
			// are whole faces, with their planes alongside
			if (planes) normal.copy(planes[i]);
			else normal.fromArray(normals, i * 9);
			const angle = normal.applyQuaternion(mesh.body ? mesh.body.quaternion : mesh.quaternion).angleTo(vector);
			if (angle < closest_angle) {
				closest_angle = angle;
				closest_face = face;
			}
		}
		return closest_face;
	}

	// Makes the result on a settled die glow: the label material on the face that landed up (on a
	// d4, the three faces showing the result at their top corner) is swapped for a cached variant
	// that emits a soft halo in the number colour, and a small additive glow sprite sits just above
	// the number. Only what is drawn changes; the face map and so the reported result stay as they were.
	// style: "glow" lights the number in its own colour; "ink" repaints a dark number in a bright
	// colour (`color`, the colorset's `highlight`, or ember) that glows; "gilded" repaints it in gold
	// with a shimmer that sweeps across once (`gild_sweep`, driven by the box). "auto" picks ink for dark
	// numbers and glow for the rest. Returns the style used.
	glowResult(mesh, intensity = 1, style = 'auto', color = null) {
		this.unglow(mesh);
		const top = this.topFace(mesh).materialIndex;
		const info = mesh.material[mesh.shape == 'd4' ? 2 : top].diceLabel;
		if (style == 'auto') style = info && this.glowColor(info.forecolor).dark ? 'ink' : 'glow';
		const fill = style == 'glow' || !info ? null : color || info.highlight || (style == 'gilded' ? '#B8892E' : '#F2743B');
		const look = { intensity, style, fill };
		if (mesh.diceTheme && mesh.diceTheme.pixel && info) {
			this.stampResult(mesh, { fill: fill || this.glowColor(info.forecolor).color, ring: PIXEL_INK });
			return style;
		}
		mesh.baseMaterial = mesh.material;
		const materials = mesh.baseMaterial.slice();
		if (mesh.shape == 'd4') {
			const text = String(mesh.getFaceValue().value);
			materials.forEach((mat, i) => {
				if (i > 1 && i != top) materials[i] = this.glowMaterial(mat, text, look);
			});
		} else {
			materials[top] = this.glowMaterial(materials[top], null, look);
		}
		mesh.material = materials;
		if (info) this.addHalo(mesh, fill || this.glowColor(info.forecolor).color, intensity, style);
		return style;
	}

	// A dropped die: every face dimmed and desaturated and the number that landed up struck through.
	dropResult(mesh) {
		this.unglow(mesh);
		mesh.baseMaterial = mesh.material;
		const materials = mesh.baseMaterial.map(mat => this.dimMaterial(mat));
		const top = this.topFace(mesh).materialIndex;
		if (mesh.diceTheme && mesh.diceTheme.pixel) {
			mesh.material = materials;
			const info = mesh.baseMaterial[mesh.shape == 'd4' ? 2 : top].diceLabel;
			if (info) this.stampResult(mesh, { fill: dimColor(info.forecolor), ring: PIXEL_INK, strike: true });
		} else if (mesh.shape == 'd4') {
			const text = String(mesh.getFaceValue().value);
			mesh.baseMaterial.forEach((mat, i) => {
				if (i > 1 && i != top) materials[i] = this.strikeMaterial(mat, text);
			});
		} else {
			materials[top] = this.strikeMaterial(mesh.baseMaterial[top], null);
		}
		if (!mesh.stamp) mesh.material = materials;
		const interior = mesh.interior;
		if (interior) {
			interior.baseMaterial = interior.material;
			interior.material = this.dimMaterial(interior.material);
		}
	}

	unglow(mesh) {
		mesh.stamp = null;
		if (mesh.halo) {
			mesh.remove(mesh.halo);
			mesh.halo = null;
		}
		const interior = mesh.interior;
		if (interior && interior.baseMaterial) {
			interior.material = interior.baseMaterial;
			interior.baseMaterial = null;
		}
		if (!mesh.baseMaterial) return;
		mesh.material = mesh.baseMaterial;
		mesh.baseMaterial = null;
	}

	// A pixel die shows its result as a stamp: the number upright in the pixel font, drawn by the pixel pass
	// one font pixel per pixel over the up face, whose own number is left off, so it reads whichever way
	// the die came to rest. Only what is drawn changes. The stamp sits at the middle of the up face (a d4's
	// at its top corner), in the die's own coordinates. Without a highlight it's in the number's colours.
	stampResult(mesh, { fill = null, ring = null, strike = false } = {}) {
		if (!mesh.baseMaterial) mesh.baseMaterial = mesh.material;
		const base = mesh.baseMaterial;
		const top = this.topFace(mesh);
		const d4 = mesh.shape == 'd4';
		const info = base[d4 ? 2 : top.materialIndex] && base[d4 ? 2 : top.materialIndex].diceLabel;
		if (!info) return;
		const text = d4 ? String(mesh.getFaceValue().value) : info.labels[info.index];
		if (typeof text != 'string' || !text.trim()) return;
		const materials = mesh.material.slice();
		if (d4) materials.forEach((mat, i) => { if (i > 1 && i != top.materialIndex) materials[i] = this.bareMaterial(mat, base[i].diceLabel, text); });
		else materials[top.materialIndex] = this.bareMaterial(materials[top.materialIndex], info, null);
		mesh.material = materials;
		const outlined = info.outline && info.outline != 'none' && info.outline != info.backcolor;
		const share = d4 ? 0.18 : mesh.shape == 'd10' ? 0.24 : 0.32;
		const texels = this.labelTexels(info.diceobj, mesh.diceTheme.pixel);
		mesh.stamp = {
			text, strike, ...fontFor(share * texels / text.split('\n').length),
			fill: fill || info.forecolor, ring: ring || (outlined ? info.outline : null),
			point: this.stampPoint(mesh, top),
		};
	}

	stampPoint(mesh, top) {
		const geometry = mesh.geometry;
		const position = geometry.getAttribute('position');
		if (mesh.shape == 'd4') {
			const quaternion = mesh.body ? new THREE.Quaternion().copy(mesh.body.quaternion) : mesh.quaternion;
			const up = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion.clone().invert());
			const v = new THREE.Vector3(), point = new THREE.Vector3();
			let best = -Infinity;
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position, i);
				if (v.dot(up) > best) {
					best = v.dot(up);
					point.copy(v);
				}
			}
			return point.multiplyScalar(0.85);
		}
		const index = geometry.index;
		const point = new THREE.Vector3(), v = new THREE.Vector3();
		let count = 0;
		for (const group of geometry.groups) {
			if (group.materialIndex != top.materialIndex) continue;
			for (let i = group.start; i < group.start + group.count; i++) {
				point.add(v.fromBufferAttribute(position, index ? index.getX(i) : i));
				count++;
			}
		}
		return count ? point.divideScalar(count) : this.facePlane(geometry, top).point.clone();
	}

	// A label material with its number left off (on a d4, only `text`), for under a stamp.
	bareMaterial(base, info, text) {
		if (!info) return base;
		const key = `bare|${base.uuid}|${text}`;
		const variants = this.ownerOf(base).variants;
		let mat = variants.get(key);
		if (mat) return mat;
		mat = this.cloneMaterial(base);
		const { composite, bump } = this.drawLabel(info, info.forecolor, { bare: text === null ? true : text });
		mat.map = composite;
		if (base.metalnessMap) mat.metalnessMap = bump;
		mat.ownTextures = [composite, bump];
		variants.set(key, mat);
		return mat;
	}

	// A dark number gets a light halo instead of glowing in its own colour.
	glowColor(forecolor) {
		const hsl = new THREE.Color(forecolor).getHSL({}, THREE.SRGBColorSpace);
		const dark = hsl.l < 0.45;
		return { dark, color: dark ? `hsl(${Math.round(hsl.h * 360)}, ${Math.round(Math.min(hsl.s, 0.7) * 100)}%, 80%)` : forecolor };
	}

	// The halo sits just above the up face (on a d4, over the top corner) as a child of the mesh, so
	// it pops with the die and goes when the die does.
	// An additive glow vanishes on a light body, so the ink and gilded halos are a soft tint instead.
	addHalo(mesh, color, intensity, style = 'glow') {
		if (!this.halo_texture) this.halo_texture = haloTexture();
		const tinted = style != 'glow';
		const key = `${color}|${intensity}|${tinted}`;
		let mat = this.halo_cache.get(key);
		if (!mat) {
			mat = new THREE.SpriteMaterial({ map: this.halo_texture, color: new THREE.Color(color), blending: tinted ? THREE.NormalBlending : THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, opacity: Math.min(1, (tinted ? 0.3 : 0.55) * intensity) });
			this.halo_cache.set(key, mat);
		}
		const radius = mesh.geometry.boundingSphere.radius;
		const position = mesh.geometry.getAttribute('position');
		const quaternion = mesh.body ? new THREE.Quaternion().copy(mesh.body.quaternion) : mesh.quaternion;
		const point = new THREE.Vector3();
		let size = radius * 1.25;
		if (mesh.shape == 'd4') {
			const up = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion.clone().invert());
			const v = new THREE.Vector3();
			let best = -Infinity;
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position, i);
				if (v.dot(up) > best) {
					best = v.dot(up);
					point.copy(v);
				}
			}
			point.multiplyScalar(0.8);
			size = radius * 0.8;
		} else {
			const { normal, point: plane } = this.facePlane(mesh.geometry, this.topFace(mesh));
			point.copy(normal).multiplyScalar(normal.dot(plane) + radius * 0.05);
		}
		const halo = new THREE.Sprite(mat);
		halo.position.copy(point);
		halo.scale.setScalar(size);
		halo.renderOrder = 1;
		mesh.add(halo);
		mesh.halo = halo;
	}

	// A face group's normal and a point on its plane (a shaped die's dish sits below it).
	facePlane(geometry, group) {
		const i = geometry.groups.indexOf(group);
		if (geometry.faceNormals) return { normal: geometry.faceNormals[i], point: geometry.facePoints[i] };
		return {
			normal: new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('normal'), group.start),
			point: new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), group.start),
		};
	}

	// Variants are drawn with the colorset the label was made with, even if it has changed since.
	drawLabel(info, forecolor, variant) {
		const previous = this.theme;
		if (info.theme) this.selectTheme(info.theme);
		const saved = [this.dice_material, this.body_opacity, this.dice_accent, this.dice_rainbow, this.label_font];
		this.dice_material = info.material;
		this.body_opacity = info.opacity;
		this.dice_accent = info.accent;
		this.dice_rainbow = info.rainbow;
		this.label_font = info.font;
		try {
			return variant.strike || variant.recolor || variant.bare
				? this.createTextMaterial(info.diceobj, info.labels, info.index, info.size, info.margin, info.texture, forecolor, info.outline, info.backcolor, false, null, variant.strike ? variant : null, variant.bare || null)
				: this.createTextMaterial(info.diceobj, info.labels, info.index, info.size, info.margin, null, forecolor, 'none', '#000000', false, variant);
		} finally {
			if (previous) this.selectTheme(previous);
			[this.dice_material, this.body_opacity, this.dice_accent, this.dice_rainbow, this.label_font] = saved;
		}
	}

	dimMaterial(base) {
		const key = `dim|${base.uuid}`;
		const variants = this.ownerOf(base).variants;
		let mat = variants.get(key);
		if (mat) return mat;
		mat = this.cloneMaterial(base);
		const compile = base.onBeforeCompile;
		const pixel = Boolean(this.ownerOf(base).pixel);
		mat.onBeforeCompile = (shader, renderer) => {
			compile.call(mat, shader, renderer);
			dimShader(shader, pixel);
		};
		mat.customProgramCacheKey = () => `${base.customProgramCacheKey()}|dim`;
		if (mat.isGlass) mat.defines.DICE_DIM = '';
		mat.fuzzDim = true;
		variants.set(key, mat);
		return mat;
	}

	strikeMaterial(base, text) {
		const info = base && base.diceLabel;
		if (!info) return this.dimMaterial(base);
		if (text !== null && !info.labels[info.index].includes(text)) return this.dimMaterial(base);
		const key = `strike|${base.uuid}|${text}`;
		const variants = this.ownerOf(base).variants;
		let mat = variants.get(key);
		if (mat) return mat;
		const dim = this.dimMaterial(base);
		mat = this.cloneMaterial(dim);
		mat.onBeforeCompile = dim.onBeforeCompile;
		mat.customProgramCacheKey = dim.customProgramCacheKey;
		const { composite, bump, fuzz } = this.drawLabel(info, info.forecolor, { text, strike: true });
		mat.map = composite;
		if (base.metalnessMap) mat.metalnessMap = bump;
		if (base.bumpMap && !base.bumpMap.isNormalImage) mat.bumpMap = bump;
		if (base.glintMap) mat.glintMap = bump;
		if (base.fuzzMap && fuzz) mat.fuzzMap = fuzz;
		mat.ownTextures = [composite, bump, fuzz];
		variants.set(key, mat);
		return mat;
	}

	cloneMaterial(base) {
		const mat = base.clone();
		mat.defines = { ...base.defines };
		mat.onBeforeCompile = base.onBeforeCompile;
		mat.customProgramCacheKey = base.customProgramCacheKey;
		mat.isGlass = base.isGlass;
		mat.glassUniforms = base.glassUniforms;
		mat.diceTheme = base.diceTheme;
		mat.envBase = base.envBase;
		mat.glintMap = base.glintMap;
		mat.fuzzMap = base.fuzzMap;
		mat.fuzz = base.fuzz;
		mat.fuzzDim = base.fuzzDim;
		return mat;
	}

	glowMaterial(base, text, { intensity, style, fill }) {
		const info = base && base.diceLabel;
		if (!info) return base;
		if (text !== null && !info.labels[info.index].includes(text)) return base;
		const key = `${base.uuid}|${text}|${intensity}|${style}|${fill}`;
		const glows = this.ownerOf(base).glow;
		let mat = glows.get(key);
		if (mat) return mat;
		mat = this.cloneMaterial(base);
		mat.emissive = new THREE.Color(0xffffff);
		mat.emissiveIntensity = intensity;
		if (fill) {
			// the whole label redrawn with the number in the fill colour; d4 faces repaint only the result
			const { composite, bump } = text === null ? this.drawLabel(info, fill, { recolor: true }) : { composite: null, bump: null };
			if (composite) {
				mat.map = composite;
				mat.ownTextures = [composite, bump];
			}
			mat.emissiveMap = this.drawLabel(info, fill, { text, knockout: false }).composite;
			if (style == 'gilded') this.gildMaterial(mat, base);
		} else {
			const { dark, color } = this.glowColor(info.forecolor);
			mat.emissiveMap = this.drawLabel(info, color, { text, knockout: dark }).composite;
		}
		glows.set(key, mat);
		return mat;
	}

	// The gilded number glows faintly, and brightly where a diagonal band crosses it as
	// `gild_sweep` runs from -0.3 to 1.3; the box parks it at 2 once the sweep is done.
	gildMaterial(mat, base) {
		const compile = base.onBeforeCompile;
		const sweep = this.gild_sweep;
		mat.onBeforeCompile = (shader, renderer) => {
			compile.call(mat, shader, renderer);
			shader.uniforms.gildSweep = sweep;
			shader.fragmentShader = shader.fragmentShader
				.replace('void main() {', 'uniform float gildSweep;\nvoid main() {')
				.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
					#ifdef USE_EMISSIVEMAP
						float gildBand = ( vEmissiveMapUv.x + 1.0 - vEmissiveMapUv.y ) * 0.5 - gildSweep;
						totalEmissiveRadiance *= 0.35 + 2.2 * exp( - gildBand * gildBand / 0.006 );
					#endif`);
		};
		mat.customProgramCacheKey = () => `${base.customProgramCacheKey()}|gild`;
	}

	// returns a dicemesh (THREE.Mesh) object, in a shape ({ edges, dish }, see shapes.js) or the classic one
	create(type, shape = null) {
		let diceobj = this.get(type);
		if (!diceobj) return null;

		const geom = this.geometryOf(type, diceobj, shapeOf(shape));
		if (!geom) return null;

		this.setMaterialInfo();

		// Glass shows its back faces through the front ones. Created first, the interior has the
		// lower id, so at the same depth it draws before the faces.
		const interior = this.dice_material == 'glass' ? new THREE.Mesh(geom, this.interiorMaterial()) : null;
		let dicemesh = new THREE.Mesh(geom, this.createMaterials(diceobj, this.baseScale / 2, 1.0));
		if (interior) dicemesh.add(interior);
		dicemesh.interior = interior;
		dicemesh.result = [];
		dicemesh.shape = diceobj.shape;
		dicemesh.rerolls = 0;
		dicemesh.resultReason = 'natural';
		dicemesh.mass = diceobj.mass
		dicemesh.diceTheme = this.theme;
		dicemesh.picks = Object.fromEntries(PICKS.map(key => [key, this[key]]));

		const factory = this;
		dicemesh.getFaceValue = function() {
			// callback function. scope of this = Mesh
			let reason = this.resultReason;
			let closest_face = factory.topFace(this);
			let matindex = (this.faceMap ? this.faceMap[closest_face.materialIndex] : closest_face.materialIndex) - 1;
			let offset = 2

			const diceobj = DiceFactory.dice[this.notation.type];

			if (this.shape == 'd4') {
				let labelindex2 = ((matindex-1) == 0) ? 5 : matindex;

				return {value: matindex, label: diceobj.labels[matindex-1][labelindex2][0], reason: reason};
			}

			if (['d10','d2'].includes(this.shape)) {
				matindex += 1;
				offset -= 1;
			}

			let value = diceobj.values[((matindex-1) % diceobj.values.length)];
			let label = diceobj.labels[(((matindex-1) % (diceobj.labels.length-2))+offset)];
			
			return {value: value, label: label, reason: reason};
		}

		dicemesh.storeRolledValue = function(reason) {
			this.resultReason = reason || this.resultReason;
			this.result.push(this.getFaceValue());
		}

		dicemesh.getLastValue = function() {
			if (!this.result || this.result.length < 1) return {value: undefined, label: '', reason: ''};

			return this.result[this.result.length-1];
		}

		dicemesh.ignoreLastValue = function(ignore) {
			let lastvalue = this.getLastValue();
			if (lastvalue.value === undefined) return;

			lastvalue.ignore = ignore;
			this.setLastValue(lastvalue);
		}

		dicemesh.setLastValue = function(result) {
			if (!this.result || this.result.length < 1) return;
			if (!result || result.length < 1) return;

			return this.result[this.result.length-1] = result;
		}

		if (diceobj.color) {
			dicemesh.material[0].color = new THREE.Color(diceobj.color);
			dicemesh.material[0].emissive = new THREE.Color(diceobj.color);
			dicemesh.material[0].emissiveIntensity = 1;
			dicemesh.material[0].needsUpdate = true;
		}

		if (diceobj.values.length <= 3) this.fixmaterials(dicemesh, diceobj.values.length);
		return this.addFuzz(dicemesh);
	}

	// A die whose texture grows fuzz gets its fur shells (fuzz.js) as a child, so they follow its pose
	// and pop, and never touch the physics. Created after the die, they draw right after it at the same
	// depth. Their materials follow the die's own array, so a face swap, highlight or dimmed drop
	// carries over to the strands; slots without a fuzz map draw nothing.
	addFuzz(dicemesh) {
		if (!(this.fuzzShells > 0) || !dicemesh.material.some(mat => mat.fuzzMap)) return dicemesh;
		if (!this.shell_matrix) {
			this.shell_matrix = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHELLS * 16), 16);
			for (let i = 0; i < MAX_SHELLS; i++) new THREE.Matrix4().toArray(this.shell_matrix.array, i * 16);
		}
		const shells = new THREE.InstancedMesh(shellGeometry(dicemesh.geometry), this.no_fuzz, MAX_SHELLS);
		shells.instanceMatrix = this.shell_matrix;
		Object.defineProperty(shells, 'material', { configurable: true, get: () => this.shellMaterials(dicemesh.material), set() {} });
		const most = Math.min(MAX_SHELLS, Math.max(...dicemesh.material.map(mat => (mat.fuzz ? mat.fuzz.shells || FUZZ_DEFAULTS.shells : 0))));
		shells.onBeforeRender = () => { shells.count = Math.min(most, this.fuzz_state.value); };
		shells.count = most;
		shells.frustumCulled = false;
		shells.castShadow = false;
		shells.raycast = () => {};
		shells.isFuzz = true;
		dicemesh.add(shells);
		dicemesh.fuzz = shells;
		return dicemesh;
	}

	shellMaterials(materials) {
		let shells = this.shell_sets.get(materials);
		if (!shells) {
			shells = materials.map(mat => this.shellMaterial(mat));
			this.shell_sets.set(materials, shells);
		}
		return shells;
	}

	shellMaterial(base) {
		if (!base || !base.fuzzMap) return this.no_fuzz;
		const key = `fuzz|${base.map && base.map.uuid}|${base.fuzzMap.uuid}|${Boolean(base.fuzzDim)}`;
		const variants = this.ownerOf(base).variants;
		let mat = variants.get(key);
		if (mat) return mat;
		if (!this.strand_field) this.strand_field = strandField();
		const state = this.fuzz_state;
		const most = Math.min(MAX_SHELLS, (base.fuzz && base.fuzz.shells) || FUZZ_DEFAULTS.shells);
		mat = shellMaterial(base, { field: this.strand_field, shells: { get value() { return Math.min(most, state.value); } }, dim: Boolean(base.fuzzDim) });
		variants.set(key, mat);
		return mat;
	}

	// Geometry is cached per die type and shape. A shaped die shares its type's physics shape, so it
	// moves exactly like the classic one. The SHAPED_CACHE most recently used shaped geometries are kept;
	// an older one still on the table is uploaded again if it is drawn.
	geometryOf(type, diceobj, shape) {
		let classic = this.geometries[type];
		if (!classic) {
			classic = this.createGeometry(diceobj.shape, diceobj.scale * this.baseScale);
			this.geometries[type] = classic;
		}
		if (!classic || !shape || !GEOM_PARAMS[diceobj.shape]) return classic;
		const key = `${type}|${shapeKey(shape)}`;
		let geom = this.shaped.get(key);
		if (geom) this.shaped.delete(key);
		else {
			geom = buildShaped(diceobj.shape, diceobj.scale * this.baseScale, shape);
			geom.cannon_shape = classic.cannon_shape;
		}
		this.shaped.set(key, geom);
		for (const [old, oldGeom] of this.shaped) {
			if (this.shaped.size <= SHAPED_CACHE) break;
			this.shaped.delete(old);
			oldGeom.dispose();
		}
		return geom;
	}

	get(type) {
		let dieSet
		if(DiceFactory.dice.hasOwnProperty(type)){
			dieSet = DiceFactory.dice[type]
		} else {
			dieSet = new DicePreset(type)
			DiceFactory.dice[type] = dieSet;
		}

		return dieSet
	}

	getGeometry(type) {
		return this.geometries[type];
	}

	scaleGeometry(){
		// console.log('this.geometries :>> ', this.geometries);
		// Object.entries(this.geometries).forEach(([key,geom]) => {
		// 	geom.scale(this.scale,this.scale,this.scale)
		// 	// remove cannon shape
		// 	// geom.cannon_shape.body.removeShape(geom.cannon_shape.body.shapes[0])
		// 	// recreate cannon shape with new scale
		// 	const newShape = this.createGeometry(key, this.scale, true)
		// 	console.log("🚀 ~ Object.entries ~ newShape", newShape)
		// 	geom.cannon_shape= newShape

		// })
	}

	createMaterials(diceobj, size, margin, allowcache = true, d4specialindex = 0) {

		let materials = [];
		let labels = diceobj.labels;
		if (diceobj.shape == 'd4') {
			labels = diceobj.labels[d4specialindex];
			size = this.baseScale / 2;
			margin = this.baseScale * 2;
		}
		
		for (var i = 0; i < labels.length; ++i) {
			var mat = this.cachedMaterial(diceobj, labels, i, size, margin, allowcache);
			if (mat) {
				materials.push(mat);
				continue;
			}
			const preset = this.materialPreset();
			if (this.dice_material == 'glass') {
				mat = this.makeGlass(new THREE.MeshPhysicalMaterial(preset), this.body_opacity);
			} else if (preset && (preset.anisotropy || preset.clearcoat || preset.sheen)) {
				mat = new THREE.MeshPhysicalMaterial(preset);
			} else if (preset) {
				mat = new THREE.MeshStandardMaterial(preset);
			} else {
				mat = new THREE.MeshPhongMaterial(this.material_options);
			}

			if (this.dice_material == 'none' || this.dice_material == 'wood') mat.onBeforeCompile = dielectricShader;

			let canvasTextures;
			if (i==0) { //edge
				//if the texture is fully opaque, we do not use it for edge
				let texture = {name:"none"};
				if(this.dice_texture_rand.composite != "source-over") texture = this.dice_texture_rand;

				canvasTextures = this.createTextMaterial(diceobj, labels, i, size, margin, texture, this.label_color_rand, this.label_outline_rand, this.edge_color_rand, allowcache);
				mat.map = canvasTextures.composite;
				// flat bevels would light up end to end like wires
				if (this.dice_material == 'glass') {
					mat.envMapIntensity = 0.7;
					mat.defines.GLASS_EDGE = '';
				}
				if (isMetal(this.dice_material)) mat.onBeforeCompile = metalShader;

			} else {
				canvasTextures = this.createTextMaterial(diceobj, labels, i, size, margin, this.dice_texture_rand, this.label_color_rand, this.label_outline_rand, this.dice_color_rand, allowcache);
				mat.map = canvasTextures.composite;
				mat.diceLabel = { theme: this.theme, diceobj, labels, index: i, size, margin, forecolor: this.label_color_rand, outline: this.label_outline_rand, backcolor: this.dice_color_rand, texture: this.dice_texture_rand, material: this.dice_material, opacity: this.body_opacity, accent: this.dice_accent, rainbow: this.dice_rainbow, font: this.label_font, highlight: this.colordata && this.colordata.highlight };
				if (isMetal(this.dice_material)) {
					mat.onBeforeCompile = metalShader;
					mat.metalnessMap = canvasTextures.bump;
				}

				// on metal a bump at the number edges would mirror stray bits of the room as sparkles
				if (this.bumpMapping && !this.pixel && this.dice_material != 'glass' && !isMetal(this.dice_material)) {
					if (false) {
						mat.bumpScale = 0.5;
					} else {
						let scale = 0.75;;
						if(size > 35)
							scale = 1;
						if(size > 40)
							scale = 2.5;
						if(size > 45)
							scale = 4;
						mat.bumpScale = scale;
					}

					if (canvasTextures.bump) {
						mat.bumpMap = canvasTextures.bump;
					}
					if (diceobj.shape != 'd4' && diceobj.normals[i]) {
						mat.bumpMap = new THREE.Texture(diceobj.normals[i]);
						mat.bumpMap.isNormalImage = true;
						mat.bumpScale = 4;
						mat.bumpMap.needsUpdate = true;
					}
				}
			}
			if (canvasTextures && canvasTextures.fuzz) {
				mat.fuzzMap = canvasTextures.fuzz;
				mat.fuzz = this.dice_texture_rand.fuzz;
			}
			const surface = this.dice_texture_rand.surface && this.surfaces.get(this.dice_texture_rand.surface);
			if (surface && surface.glint && canvasTextures.bump && !this.pixel && (this.dice_material == 'none' || this.dice_material == 'glass')) this.addGlint(mat, canvasTextures.bump);
			if (preset && preset.envMapIntensity) {
				mat.envBase = mat.envMapIntensity;
				this.applyEnvironment(mat);
			}
			mat.opacity = 1;
			mat.transparent = true;
			mat.depthTest = false;
			mat.needUpdate = true;
			mat.diceTheme = this.theme;
			if (this.pixel) this.pixelate(mat);
			if (canvasTextures && canvasTextures.key) this.mesh_materials_cache.set(this.materialKey(canvasTextures.key, i, size), mat);
			materials.push(mat);
		}

		return materials;
	}

	// A texture's finish applies to plastic; glass takes only its thin film. A colorset's iridescence
	// (0 to 1) sets or adds that film on plastic and glass.
	materialPreset() {
		let preset = MATERIALTYPES[this.dice_material];
		const finish = this.dice_texture_rand && this.dice_texture_rand.finish;
		if (finish && this.dice_material == 'none') preset = { ...preset, ...finish };
		if (finish && finish.iridescence && this.dice_material == 'glass') {
			const { iridescence, iridescenceIOR, iridescenceThicknessRange } = finish;
			preset = { ...preset, iridescence, iridescenceIOR, iridescenceThicknessRange };
		}
		if (this.dice_iridescence !== null && (this.dice_material == 'none' || this.dice_material == 'glass')) {
			preset = { iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 520], ...preset, iridescence: this.dice_iridescence };
		}
		return preset;
	}

	glints(mesh) {
		return Array.isArray(mesh.material) && mesh.material.some(mat => mat.glintMap);
	}

	addGlint(mat, map) {
		const compile = mat.onBeforeCompile;
		const glintState = this.glint_state;
		mat.glintMap = map;
		mat.defines = { ...mat.defines, DICE_GLINT: '' };
		mat.onBeforeCompile = function (shader, renderer) {
			glintShader(shader, this.glintMap, glintState);
			compile.call(this, shader, renderer);
		};
	}

	makeGlass(mat, opacity) {
		const theme = this.theme || this;
		mat.premultipliedAlpha = true;
		mat.defines = { ...mat.defines, GLASS_OPACITY: 'glassOpacity' };
		mat.glassUniforms = { refraction: theme.refraction, edges: theme.edges, opacity: { value: opacity } };
		mat.onBeforeCompile = glassCompile;
		mat.isGlass = true;
		if (theme.refraction.value.y > 0) mat.defines.GLASS_REFRACTION = '';
		mat.diceTheme = this.theme;
		return mat;
	}

	// The back faces of a glass die, drawn as one batch: fainter than the faces, deeper in colour and
	// catching faint internal reflections.
	interiorMaterial() {
		const key = `interior|${this.dice_color_rand}|${this.body_opacity}`;
		let mat = this.mesh_materials_cache.get(key);
		if (mat) return mat;
		const color = new THREE.Color(this.dice_color_rand);
		mat = this.makeGlass(new THREE.MeshStandardMaterial({
			color: color,
			roughness: MATERIALTYPES.glass.roughness,
			metalness: 0,
			side: THREE.BackSide,
			transparent: true,
			depthTest: false,
			opacity: this.body_opacity * 0.5,
			envMapIntensity: 0.6
		}), this.body_opacity * 0.5);
		mat.defines.GLASS_INTERIOR = '';
		mat.envBase = mat.envMapIntensity;
		this.applyEnvironment(mat);
		if (this.pixel) this.pixelate(mat);
		this.mesh_materials_cache.set(key, mat);
		return mat;
	}

	materialKey(textureKey, index, size) {
		return `${textureKey}|${index}|${size}|${this.dice_material}|${this.bumpMapping}`
	}

	// Dice of the same type and colours share materials (and so textures) instead of each die
	// building its own. Returns null on a miss.
	cachedMaterial(diceobj, labels, index, size, margin, allowcache) {
		if (!allowcache) return null;
		let texture = this.dice_texture_rand;
		let backcolor = this.dice_color_rand;
		if (index == 0) {
			texture = this.dice_texture_rand.composite != "source-over" ? this.dice_texture_rand : {name: "none"};
			backcolor = this.edge_color_rand;
		}
		texture = texture || this.dice_texture_rand;
		backcolor = backcolor || this.dice_color_rand;
		const key = this.textureKey(diceobj, labels, index, texture, this.label_color_rand, this.label_outline_rand, backcolor);
		if (!key || !this.materials_cache[key]) return null;
		return this.mesh_materials_cache.get(this.materialKey(key, index, size)) || null;
	}

	textureKey(diceobj, labels, index, texture, forecolor, outlinecolor, backcolor) {
		let text = labels[index];
		if (text === undefined) return null;
		let textCache = text;
		if (text instanceof HTMLImageElement) {
			textCache = text.src;
		} else if (text instanceof Array) {
			text.forEach(el => {
				textCache += el.src;
			});
		}
		const opacity = this.body_opacity < 1 ? this.body_opacity : '';
		let finish = isMetal(this.dice_material) || this.dice_material == 'wood' ? this.dice_material : '';
		if (texture.surface) finish += this.dice_material + this.dice_accent + (this.dice_rainbow ? 'rainbow' : '');
		if (this.dice_iridescence !== null) finish += `iridescence${this.dice_iridescence}`;
		finish += fontKey(this.labelFont(diceobj));
		if (diceobj.shape == 'd4') {
			return diceobj.type + textCache + texture.name + forecolor + outlinecolor + backcolor + opacity + finish;
		}
		return diceobj.type + textCache + index + texture.name + forecolor + outlinecolor + backcolor + opacity + finish;
	}

	// The colorset's number font, unless the die type brings its own (pips, poker cards, symbols).
	labelFont(diceobj) {
		return diceobj.ownFont ? null : this.label_font;
	}

	widestLabel(diceobj) {
		if (!diceobj.widest) {
			const labels = diceobj.labels.flat().filter(label => typeof label == 'string');
			diceobj.widest = labels.reduce((a, b) => b.length > a.length ? b : a, '') || '0';
		}
		return diceobj.widest;
	}

	// The size, CSS font and downward shift of a label laid out at `size` for Arial.
	fontAt(diceobj, size) {
		const font = this.labelFont(diceobj);
		if (!font) return { size, css: size + 'pt ' + diceobj.font, dy: 0 };
		const { scale, shift } = fontMetrics(font, this.widestLabel(diceobj));
		const scaled = size * scale * font.scale;
		return { size: scaled, css: `${font.weight} ${scaled}pt ${font.family}`.trim(), dy: size * (shift + font.offset) };
	}

	// With glow ({text}: only that number on a d4, or null for the face's label) it draws just the
	// numbers, haloed in their colour on black, for use as an emissive map. With strike (the same
	// {text}) the label is drawn as usual with that number crossed out.
	createTextMaterial(diceobj, labels, index, size, margin, texture, forecolor, outlinecolor, backcolor, allowcache, glow = null, strike = null, bare = null) {
		if (labels[index] === undefined) return null;
		if (glow) texture = { name: 'none' };

		texture = texture || this.dice_texture_rand;
		forecolor = forecolor || this.label_color_rand;
		outlinecolor = outlinecolor || this.label_outline_rand;
		backcolor = backcolor || this.dice_color_rand;
		allowcache = allowcache == undefined ? true : allowcache;

		let text = labels[index];
		let isTexture = false;

		// an attempt at materials caching
		let cachestring = this.textureKey(diceobj, labels, index, texture, forecolor, outlinecolor, backcolor);
		if (allowcache && this.materials_cache[cachestring] != null) {
			this.cache_hits++;
			return this.materials_cache[cachestring];
		}
		if (this.pixel) {
			const drawn = this.createPixelLabel(diceobj, labels, index, texture, forecolor, outlinecolor, backcolor, glow, strike, bare);
			if (!allowcache || glow) return drawn;
			this.cache_misses++;
			this.materials_cache[cachestring] = { ...drawn, key: cachestring };
			return this.materials_cache[cachestring];
		}

		let canvas = document.createElement("canvas");
		let context = canvas.getContext("2d", {alpha: true});

		context.globalAlpha = 0;
		context.clearRect(0, 0, canvas.width, canvas.height);

		let canvasBump = document.createElement("canvas");
		let contextBump = canvasBump.getContext("2d", {alpha: true});
		contextBump.globalAlpha = 0;
		contextBump.clearRect(0, 0, canvasBump.width, canvasBump.height);

		let ts;

		if (diceobj.shape == 'd4') {
			ts = this.calc_texture_size(size + margin) * 4;
		} else {
			ts = this.calc_texture_size(size + size * 2 * margin) * 4;
		}

		// Labels are laid out on a ts-sized square; the canvas itself can be smaller. Mipmapping
		// samples well below the full size at the sizes dice are drawn, and each halving saves
		// three quarters of the texture memory. Metal keeps full resolution: its number edges sit
		// against sharp, high-contrast reflections.
		const px = Math.max(32, ts * (isMetal(this.dice_material) ? 1 : this.textureScale));
		canvas.width = canvas.height = px;
		canvasBump.width = canvasBump.height = px;
		context.scale(px / ts, px / ts);
		contextBump.scale(px / ts, px / ts);

		// create color; a texture drawn with destination-in brings its own transparency
		context.globalAlpha = texture.composite == 'destination-in' || glow ? 1 : this.body_opacity;
		context.fillStyle = backcolor;
		context.fillRect(0, 0, ts, ts);
		context.globalAlpha = 1;

		contextBump.fillStyle = "#FFFFFF";
		contextBump.fillRect(0, 0, ts, ts);

		//create underlying texture
		if (texture.texture && texture.name != '' && texture.name != 'none') {
			context.globalCompositeOperation = texture.composite || 'source-over';
			context.drawImage(texture.texture, 0, 0, ts, ts);
			context.globalCompositeOperation = 'source-over';

			// at full strength a texture's bump turns the gloss into sandpaper; on metal it is the paint mask
			if (texture.bump) {
				contextBump.globalCompositeOperation = 'source-over';
				contextBump.globalAlpha = isMetal(this.dice_material) ? 1 : 0.4;
				contextBump.drawImage(texture.bump, 0, 0, ts, ts);
				contextBump.globalAlpha = 1;
			}
		} else if (texture.surface && !glow) {
			this.drawSurface(context, contextBump, ts, index, texture.surface, backcolor);
		} else if (this.dice_material == 'wood' && !glow) {
			this.drawWoodGrain(context, contextBump, ts, index);
		} else {
			context.globalCompositeOperation = 'source-over';
		}

		// create text
		context.globalCompositeOperation = 'source-over';
		context.textAlign = "center";
		context.textBaseline = "middle";

		contextBump.textAlign = "center";
		contextBump.textBaseline = "middle";

		if (glow) {
			context.shadowColor = forecolor;
			context.shadowBlur = ts * 0.035 * (px / ts);
		}
		const outlined = outlinecolor !== false && outlinecolor != 'none' && outlinecolor != backcolor;

		if (diceobj.shape != 'd4') {

			// fixes texture rotations on specific dice models
			const rotate = {
				d8: {even: -7.5, odd: -127.5},
				d10: {all: -6},
				d12: {all: 5},
				d20: {all: -7.5},
			};

			// fix for some faces being weirdly rotated
			let rotateface = rotate[diceobj.shape];
			if(rotateface) {
				let degrees
				if(rotateface.hasOwnProperty("all")){
					degrees = rotateface.all
				} else {
					if(index > 0 && (index % 2) != 0){
						degrees = rotateface.odd
					} else {
						degrees = rotateface.even
					}
				} 
				// let degrees = ((rotateface.hasOwnProperty("all") ? rotateface.all : false) || (index > 0 && (index % 2) != 0)) ? rotateface.odd : rotateface.even;

				if (degrees && degrees != 0) {

					var hw = (ts / 2);
					var hh = (ts / 2);

					context.translate(hw, hh);
					context.rotate(degrees * (Math.PI / 180));
					context.translate(-hw, -hh);

					contextBump.translate(hw, hh);
					contextBump.rotate(degrees * (Math.PI / 180));
					contextBump.translate(-hw, -hh);
				}
			}

			//custom texture face
			if (text instanceof HTMLImageElement) {
				isTexture = true;
				context.drawImage(text, 0,0,text.width,text.height,0,0,ts,ts);

			// text-only face
			} else {

				let fontsize = ts / (1 + 2 * margin);
				let textstarty = (ts / 2) + 10;
				let textstartx = (ts / 2);

				if(diceobj.shape == 'd10') {
					fontsize = fontsize*0.75;
					textstarty = (textstarty*1.15) - 10;
				} else if(diceobj.shape == 'd20') {
					textstartx = textstartx*0.98;
				}

				let textlines = text.split("\n");
				let font = this.fontAt(diceobj, textlines.length > 1 ? fontsize / textlines.length : fontsize);
				fontsize = font.size;
				context.font = contextBump.font = font.css;
				textstarty += font.dy;

				let lineHeight = context.measureText("M").width * 1.4;
				if (textlines.length > 1) {
					lineHeight = context.measureText("M").width * 1.2;
					textstarty -= (lineHeight * textlines.length) / 2;
				}

				for(let i = 0, l = textlines.length; i < l; i++){
					let textline = textlines[i].trim();

					// attempt to outline the text with a meaningful color
					if (outlined) {
						context.strokeStyle = outlinecolor;
						context.lineWidth = 5;
						context.strokeText(textlines[i], textstartx, textstarty);

						contextBump.strokeStyle = "#000000";
						contextBump.lineWidth = 5;
						contextBump.strokeText(textlines[i], textstartx, textstarty);

						if (textline == '6' || textline == '9') {
							const dotx = textstartx + context.measureText(textline).width / 2;
							context.strokeText('.', dotx, textstarty);
							contextBump.strokeText('.', dotx, textstarty);
						}
					}

					context.fillStyle = forecolor;
					context.fillText(textlines[i], textstartx, textstarty);
					if (glow) this.finishGlow(context, glow, textlines[i], textstartx, textstarty);

					contextBump.fillStyle = "#000000";
					contextBump.fillText(textlines[i], textstartx, textstarty);

					if (textline == '6' || textline == '9') {
						const dotx = textstartx + context.measureText(textline).width / 2;
						context.fillText('.', dotx, textstarty);
						contextBump.fillText('.', dotx, textstarty);
					}
					if (strike && textline) this.strikeThrough([context, contextBump], textline, textstartx, textstarty - fontsize * 0.1, fontsize, forecolor, outlined ? outlinecolor : null);
					textstarty += (lineHeight * 1.5);
				}
			}
		} else {

			var hw = (ts / 2);
			var hh = (ts / 2);

			const font = this.fontAt(diceobj, ts / 128 * 24);
			context.font = contextBump.font = font.css;
			const labely = hh - ts * 0.3 + font.dy;

			//draw the numbers
			for (let i=0; i<text.length; i++) {
				//custom texture face
				if (text[i] instanceof HTMLImageElement) {
					let scaleTexture = text[i].width / ts;
					context.drawImage(text[i], 0, 0, text[i].width, text[i].height, (100/scaleTexture), (25/scaleTexture), (60/scaleTexture), (60/scaleTexture));
				} else if (!glow || glow.text == text[i]) {
					// attempt to outline the text with a meaningful color
					if (outlined) {
						context.strokeStyle = outlinecolor;
						context.lineWidth = 5;
						context.strokeText(text[i], hw, labely);

						contextBump.strokeStyle = "#000000";
						contextBump.lineWidth = 5;
						contextBump.strokeText(text[i], hw, labely);
					}

					//draw label in top middle section
					context.fillStyle = forecolor;
					context.fillText(text[i], hw, labely);
					if (glow) this.finishGlow(context, glow, text[i], hw, labely);

					contextBump.fillStyle = "#000000";
					contextBump.fillText(text[i], hw, labely);
					if (strike && strike.text == text[i]) this.strikeThrough([context, contextBump], text[i], hw, labely - ts * 0.02, font.size, forecolor, outlined ? outlinecolor : null);
				}

				//rotate 1/3 for next label
				context.translate(hw, hh);
				context.rotate(Math.PI * 2 / 3);
				context.translate(-hw, -hh);

				contextBump.translate(hw, hh);
				contextBump.rotate(Math.PI * 2 / 3);
				contextBump.translate(-hw, -hh);
			}

			//debug side numbering
			// context.fillStyle = forecolor;
			// context.fillText(index, hw, hh);
		}

		var compositetexture = new THREE.CanvasTexture(canvas);
		compositetexture.colorSpace = THREE.SRGBColorSpace;
		compositetexture.anisotropy = this.maxAnisotropy;
		var bumpMap = null;
		if (glow) return {composite:compositetexture};
		const fuzzMap = texture.fuzz && this.dice_material != 'glass' && !isTexture ? this.drawFuzz(canvasBump, index, texture) : null;
		// The bump canvas is grey (a height and the paint mask) and uploads as one channel, except
		// where it also carries glitter flecks. Glass without flecks never samples it.
		const glinting = texture.surface && this.surfaces.get(texture.surface)?.glint && (this.dice_material == 'none' || this.dice_material == 'glass');
		if (!isTexture && (glinting || this.dice_material != 'glass')) {
			bumpMap = new THREE.CanvasTexture(canvasBump);
			bumpMap.anisotropy = this.maxAnisotropy;
			if (!glinting) bumpMap.format = THREE.RedFormat;
		}

		if (allowcache) {
			// cache new texture
			this.cache_misses++;
			this.materials_cache[cachestring] = {composite:compositetexture,bump:bumpMap,fuzz:fuzzMap,key:cachestring};
			return this.materials_cache[cachestring];
		}

		return {composite:compositetexture,bump:bumpMap,fuzz:fuzzMap};
	}

	// A pixel theme's material lights in flat bands (pixel.js) and writes depth wherever it draws, which
	// the pixel pass reads as the dice's silhouette. Its depth test always passes, so dice still draw back
	// to front over each other as they do without it.
	pixelate(mat) {
		const bands = this.pixel.bands;
		const compile = mat.onBeforeCompile;
		const key = mat.customProgramCacheKey();
		mat.onBeforeCompile = function (shader, renderer) {
			compile.call(this, shader, renderer);
			pixelShader(shader, bands);
		};
		mat.customProgramCacheKey = () => `${key}|pixel${bands}`;
		mat.depthTest = true;
		mat.depthFunc = THREE.AlwaysDepth;
		mat.depthWrite = true;
	}

	// How many texels a pixel label has across, so one texel is about one pixel of a die resting face up
	// at the theme's pixel size: the die type's face scale (world units per UV unit, from its classic
	// geometry) times the pixels per world unit that size gives.
	labelTexels(diceobj, pixel = this.pixel) {
		let geom = this.geometries[diceobj.type];
		if (!geom) geom = this.geometries[diceobj.type] = this.createGeometry(diceobj.shape, diceobj.scale * this.baseScale);
		if (!geom.worldPerUV) {
			const position = geom.getAttribute('position');
			const uv = geom.getAttribute('uv');
			const group = geom.groups.find(g => g.materialIndex > 0) || geom.groups[0] || { start: 0 };
			const a = group.start, b = group.start + 1;
			const world = Math.hypot(position.getX(b) - position.getX(a), position.getY(b) - position.getY(a), position.getZ(b) - position.getZ(a));
			const span = Math.hypot(uv.getX(b) - uv.getX(a), uv.getY(b) - uv.getY(a));
			geom.worldPerUV = span > 0 ? world / span : diceobj.scale * this.baseScale;
		}
		return Math.max(8, Math.round(pixel.size / (2 * this.baseScale) * geom.worldPerUV));
	}

	// A label for the pixel style: the body (and its texture) shrunk to a few texels across, then the
	// numbers in a bitmap font with a one texel ring in the outline colour, every texel drawn as a
	// PIXEL_UNIT square so a turned number keeps crisp edges. Sampled with nearest filtering. The bump
	// canvas is the numbers' mask, for the metal paint and the fuzz.
	createPixelLabel(diceobj, labels, index, texture, forecolor, outlinecolor, backcolor, glow, strike, bare) {
		const text = labels[index];
		const texels = this.labelTexels(diceobj);
		const unit = PIXEL_UNIT;
		const ts = 512;
		const work = document.createElement('canvas');
		work.width = work.height = 128;
		const context = work.getContext('2d');
		context.scale(work.width / ts, work.height / ts);
		const bumpWork = document.createElement('canvas');
		bumpWork.width = bumpWork.height = 4;
		const contextBump = bumpWork.getContext('2d');
		context.globalAlpha = texture.composite == 'destination-in' || glow ? 1 : this.body_opacity;
		context.fillStyle = glow ? '#000000' : backcolor;
		context.fillRect(0, 0, ts, ts);
		context.globalAlpha = 1;
		let isTexture = false;
		if (!glow) {
			if (texture.texture && texture.name != '' && texture.name != 'none') {
				context.globalCompositeOperation = texture.composite || 'source-over';
				context.drawImage(texture.texture, 0, 0, ts, ts);
				context.globalCompositeOperation = 'source-over';
			} else if (texture.surface) {
				this.drawSurface(context, contextBump, ts, index, texture.surface, backcolor);
			} else if (this.dice_material == 'wood') {
				this.drawWoodGrain(context, contextBump, ts, index);
			}
			if (text instanceof HTMLImageElement) {
				isTexture = true;
				context.drawImage(text, 0, 0, text.width, text.height, 0, 0, ts, ts);
			}
		}
		const small = document.createElement('canvas');
		small.width = small.height = texels;
		const smallContext = small.getContext('2d', { willReadFrequently: true });
		smallContext.imageSmoothingQuality = 'high';
		smallContext.drawImage(work, 0, 0, texels, texels);
		if (!glow && index > 0 && this.theme && !this.theme.samples) this.theme.samples = this.sampleColors(smallContext, texels);

		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = texels * unit;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
		const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const bump = glow ? null : new ImageData(new Uint8ClampedArray(image.data.length).fill(255), canvas.width, canvas.height);

		const placements = isTexture || bare === true ? [] : this.pixelPlacements(diceobj, text, index, texels, glow).filter(p => bare === null || p.text != bare);
		if (placements.length) {
			const outlined = outlinecolor !== false && outlinecolor != 'none' && outlinecolor != backcolor;
			const lines = String(placements[0].text).split('\n').length;
			const share = diceobj.shape == 'd4' ? 0.18 : diceobj.shape == 'd10' ? 0.24 : 0.32;
			const { font, scale } = fontFor(share * texels / lines);
			let fill = rgba(forecolor), ring = outlined ? rgba(outlinecolor) : null;
			if (glow) {
				const lit = rgba(forecolor);
				fill = glow.knockout ? [0, 0, 0, 255] : lit;
				ring = glow.knockout ? lit : lit && [lit[0] * 0.45, lit[1] * 0.45, lit[2] * 0.45, 255];
			}
			if (strike) placements.forEach(p => { p.strike = strike.text == null || p.text == strike.text; });
			paintLabels(image, bump, { placements, font, scale, unit, fill, ring });
		}
		ctx.putImageData(image, 0, 0);
		const composite = nearestTexture(canvas);
		if (glow) return { composite };

		const bumpCanvas = document.createElement('canvas');
		bumpCanvas.width = bumpCanvas.height = canvas.width;
		bumpCanvas.getContext('2d').putImageData(bump, 0, 0);
		const bumpMap = !isTexture && this.dice_material != 'glass' ? nearestTexture(bumpCanvas, THREE.NoColorSpace) : null;
		if (bumpMap) bumpMap.format = THREE.RedFormat;
		const fuzz = this.pixel.fuzz && texture.fuzz && this.dice_material != 'glass' && !isTexture ? this.drawFuzz(bumpCanvas, index, texture) : null;
		return { composite, bump: bumpMap, fuzz };
	}

	// Where a label's numbers go, in texels: the middle of the face (a d10's sits a little low, a d20's a
	// little left), turned like the classic labels; a d4's three numbers each near a corner.
	pixelPlacements(diceobj, text, index, texels, glow) {
		const half = texels / 2;
		const turn = (x, y, angle) => ({
			x: half + (x - half) * Math.cos(angle) - (y - half) * Math.sin(angle),
			y: half + (x - half) * Math.sin(angle) + (y - half) * Math.cos(angle),
		});
		if (diceobj.shape == 'd4') {
			return text.map((label, i) => {
				if (typeof label != 'string' || (glow && glow.text != null && glow.text != label)) return null;
				const angle = i * Math.PI * 2 / 3;
				return { text: label, ...turn(half, texels * 0.2, angle), angle };
			}).filter(Boolean);
		}
		if (typeof text != 'string' || !text.trim()) return [];
		if (glow && glow.text != null && !text.includes(glow.text)) return [];
		const rotate = { d8: index > 0 && index % 2 != 0 ? -127.5 : -7.5, d10: -6, d12: 5, d20: -7.5 };
		const angle = (rotate[diceobj.shape] || 0) * Math.PI / 180;
		const x = diceobj.shape == 'd20' ? half * 0.98 : half;
		const y = diceobj.shape == 'd10' ? texels * 0.558 : half;
		return [{ text, ...turn(x, y, angle), angle }];
	}

	// The opaque colours of a label's body, sRGB 0 to 1, for the theme's palette.
	sampleColors(context, size) {
		const data = context.getImageData(0, 0, size, size).data;
		const samples = [];
		for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 24) samples.push([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255]);
		return samples;
	}

	// The palette a pixel theme's dice snap to (pixel.js), built once its first label has been drawn.
	pixelPalette(theme) {
		if (!theme || !theme.pixel) return [];
		if (theme.palette) return theme.palette;
		const { colordata } = theme;
		const foreground = Array.isArray(colordata.foreground) ? colordata.foreground[0] : colordata.foreground;
		const highlights = [colordata.highlight || '#F2743B', '#B8892E', foreground && this.glowColor(foreground).color].filter(Boolean);
		const palette = buildPalette(theme.pixel.palette, colordata, theme.samples || [], highlights);
		if (theme.samples || theme.pixel.palette !== 'auto') theme.palette = palette;
		return palette;
	}

	// Where a fuzzy texture's strands grow on this label, as a grey map at half the label's size: the
	// surface's fuzz field (or everywhere, for a texture without one) turned and shifted like its
	// colours, times the bump canvas, whose black numbers and strike bars leave bare patches.
	drawFuzz(canvasBump, index, texture) {
		const size = Math.max(16, canvasBump.width / 2);
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		const context = canvas.getContext('2d');
		const surface = texture.surface && this.surfaces.get(texture.surface);
		context.fillStyle = surface && surface.fuzz ? '#000000' : '#FFFFFF';
		context.fillRect(0, 0, size, size);
		if (surface && surface.fuzz) this.drawPattern(context, surface.fuzz, size, index);
		context.globalCompositeOperation = 'multiply';
		context.drawImage(canvasBump, 0, 0, size, size);
		const map = new THREE.CanvasTexture(canvas);
		map.format = THREE.RedFormat;
		return map;
	}

	// A bold slanted bar across a number, in its colour over its outline; black on the bump canvas,
	// which also makes it matte paint on metal.
	strikeThrough([context, contextBump], text, x, y, fontsize, color, outline) {
		const half = context.measureText(text).width / 2 + fontsize * 0.2;
		const rise = fontsize * 0.22;
		const width = fontsize * 0.2;
		const bar = (ctx, style, lineWidth) => {
			ctx.save();
			ctx.shadowBlur = 0;
			ctx.lineCap = 'round';
			ctx.strokeStyle = style;
			ctx.lineWidth = lineWidth;
			ctx.beginPath();
			ctx.moveTo(x - half, y + rise);
			ctx.lineTo(x + half, y - rise);
			ctx.stroke();
			ctx.restore();
		};
		if (outline) bar(context, outline, width + 10);
		bar(context, color, width);
		bar(contextBump, '#000000', width + (outline ? 10 : 0));
	}

	// Each face gets a shared pattern turned and shifted by its index, so neighbouring faces differ.
	drawPattern(ctx, image, ts, index) {
		ctx.save();
		ctx.translate(ts / 2, ts / 2);
		ctx.rotate((index * 47 % 360) * Math.PI / 180);
		ctx.drawImage(image, -ts + (index * 0.37 % 1) * ts * 0.5, -ts, ts * 2, ts * 2);
		ctx.restore();
	}

	drawWoodGrain(context, contextBump, ts, index) {
		if (!this.wood_grain) this.wood_grain = woodGrain();
		context.globalCompositeOperation = 'overlay';
		this.drawPattern(context, this.wood_grain, ts, index);
		context.globalCompositeOperation = 'source-over';
		contextBump.globalAlpha = 0.2;
		this.drawPattern(contextBump, this.wood_grain, ts, index);
		contextBump.globalAlpha = 1;
	}

	// A procedural surface (surfaces.js), generated once per box: its coloured layers over the body
	// colour, and its height faintly into the bump canvas (except on metal, where that canvas is the
	// paint mask). The numbers are drawn on top of both, so no grain shows through them.
	drawSurface(context, contextBump, ts, index, name, backcolor) {
		if (!this.surfaces.has(name)) this.surfaces.set(name, makeSurface(name));
		const surface = this.surfaces.get(name);
		if (!surface) return;
		const accent = this.dice_accent || `#${new THREE.Color(backcolor).lerp(new THREE.Color(0xffffff), 0.55).getHexString()}`;
		context.globalCompositeOperation = 'source-over';
		// in glass the layers are inclusions: partly opaque, so the room still shows through them
		const glass = this.dice_material == 'glass';
		const body = new THREE.Color(backcolor);
		const lightness = 0.2126 * body.r + 0.7152 * body.g + 0.0722 * body.b;
		const tone = lightness > 0.55 ? 'pale' : lightness < 0.15 && this.dice_material != 'glass' ? 'deep' : 'clear';
		surface.layers.forEach((layer, k) => {
			const spectrum = layer.color == 'spectrum' || (layer.hue && this.dice_rainbow);
			const image = spectrum ? this.tintedLayer(name, k, layer, this.dice_accent && `#${new THREE.Color(this.dice_accent).getHexString()}`, tone) : layer.color == 'accent' ? this.tintedLayer(name, k, layer, this.dice_accent || layer.fallback || accent) : layer.mask;
			context.globalAlpha = glass ? layer.glass || surface.glass || 0.5 : 1;
			this.drawPattern(context, image, ts, index);
		});
		context.globalAlpha = 1;
		if (surface.glint && !isMetal(this.dice_material)) this.drawPattern(contextBump, surface.glint, ts, index);
		if (surface.height && !isMetal(this.dice_material)) {
			contextBump.globalAlpha = surface.bump;
			this.drawPattern(contextBump, surface.height, ts, index);
			contextBump.globalAlpha = 1;
		}
	}

	// An accent layer's white mask in the colorset's accent, or, given a tone, its hue field in the
	// spectrum the accent picks, made once per colour.
	tintedLayer(name, k, layer, color, tone = null) {
		const key = `${name}|${k}|${color}|${tone}`;
		let canvas = this.surface_tints.get(key);
		if (canvas) return canvas;
		if (tone !== null) {
			canvas = spectrumLayer(layer, color, tone);
			this.surface_tints.set(key, canvas);
			return canvas;
		}
		canvas = document.createElement('canvas');
		canvas.width = layer.mask.width;
		canvas.height = layer.mask.height;
		const ctx = canvas.getContext('2d');
		ctx.drawImage(layer.mask, 0, 0);
		ctx.globalCompositeOperation = 'source-in';
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		this.surface_tints.set(key, canvas);
		return canvas;
	}

	// Doubles the halo, and with knockout leaves the number itself unlit.
	finishGlow(context, glow, text, x, y) {
		context.fillText(text, x, y);
		if (!glow.knockout) return;
		context.save();
		context.shadowBlur = 0;
		context.fillStyle = '#000000';
		context.fillText(text, x, y);
		context.restore();
	}

	applyColorSet(colordata, useFont = true) {
		this.colordata = colordata;
		this.label_font = useFont ? fontOf(colordata) : null;
		this.label_color = colordata.foreground;
		this.dice_color = colordata.background;
		this.label_outline = colordata.outline;
		this.dice_texture = colordata.texture;
		const material = colordata?.texture?.material || 'none';
		this.dice_material = material == 'plastic' ? 'none' : material;
		this.edge_color = colordata.hasOwnProperty("edge") ? colordata.edge:colordata.background;
		this.dice_accent = colordata.accent || '';
		this.dice_rainbow = !!colordata.rainbow;
		this.dice_iridescence = typeof colordata.iridescence == 'number' ? Math.min(1, Math.max(0, colordata.iridescence)) : null;
		this.body_opacity = this.dice_material == 'glass' ? Math.min(1, Math.max(0, colordata.glass_opacity ?? this.glass_opacity)) : 1;
		this.pixel = pixelOf(colordata);
	}

	// pass in colorset data from dice-box
	setMaterialInfo(colorset = '') {
		let prevcolordata = this.colordata;
		let prevtexture = this.dice_texture;
		let prevmaterial = this.dice_material;

		//reset random choices
		this.dice_color_rand = '';
		this.label_color_rand = '';
		this.label_outline_rand = '';
		this.dice_texture_rand = '';
		this.dice_material_rand = '';
		this.edge_color_rand = '';

		// set base color first
		if (Array.isArray(this.dice_color)) {

			var colorindex = Math.floor(Math.random() * this.dice_color.length);

			// if color list and label list are same length, treat them as a parallel list
			if (Array.isArray(this.label_color) && this.label_color.length == this.dice_color.length) {
				this.label_color_rand = this.label_color[colorindex];

				// if label list and outline list are same length, treat them as a parallel list
				if (Array.isArray(this.label_outline) && this.label_outline.length == this.label_color.length) {
					this.label_outline_rand = this.label_outline[colorindex];
				}
			}
			// if texture list is same length do the same
			if (Array.isArray(this.dice_texture) && this.dice_texture.length == this.dice_color.length) {
				this.dice_texture_rand = this.dice_texture[colorindex];
				this.dice_material_rand = this.dice_texture_rand.material;
			}

			//if edge list and color list are same length, treat them as a parallel list
			if (Array.isArray(this.edge_color) && this.edge_color.length == this.dice_color.length) {
				this.edge_color_rand = this.edge_color[colorindex];
			}

			this.dice_color_rand = this.dice_color[colorindex];
		} else {
			this.dice_color_rand = this.dice_color;
		}

		// set edge color if not set
		if(this.edge_color_rand == ''){
			if (Array.isArray(this.edge_color)) {

				var colorindex = Math.floor(Math.random() * this.edge_color.length);

				this.edge_color_rand = this.edge_color[colorindex];
			} else {
				this.edge_color_rand = this.edge_color;
			}
		}

		// if selected label color is still not set, pick one
		if (this.label_color_rand == '' && Array.isArray(this.label_color)) {
			var colorindex = this.label_color[Math.floor(Math.random() * this.label_color.length)];

			// if label list and outline list are same length, treat them as a parallel list
			if (Array.isArray(this.label_outline) && this.label_outline.length == this.label_color.length) {
				this.label_outline_rand = this.label_outline[colorindex];
			}

			this.label_color_rand = this.label_color[colorindex];

		} else if (this.label_color_rand == '') {
			this.label_color_rand = this.label_color;
		}

		// if selected label outline is still not set, pick one
		if (this.label_outline_rand == '' && Array.isArray(this.label_outline)) {
			var colorindex = this.label_outline[Math.floor(Math.random() * this.label_outline.length)];

			this.label_outline_rand = this.label_outline[colorindex];
			
		} else if (this.label_outline_rand == '') {
			this.label_outline_rand = this.label_outline;
		}

		// same for textures list
		if (this.dice_texture_rand == '' && Array.isArray(this.dice_texture)) {
			this.dice_texture_rand = this.dice_texture[Math.floor(Math.random() * this.dice_texture.length)];
			this.dice_material_rand = this.dice_texture_rand.material || this.dice_material;
		} else if (this.dice_texture_rand == '') {
			this.dice_texture_rand = this.dice_texture;
			this.dice_material_rand = this.dice_texture_rand.material || this.dice_material;
		}

		//apply material
		if (this.dice_material_rand == '' && Array.isArray(this.dice_material)) {
			this.dice_material_rand = this.dice_material[Math.floor(Math.random() * this.dice_material.length)];
		} else if (this.dice_material_rand == '') {
			this.dice_material_rand = this.dice_material;
		}

		// console.log('this.colordata', this.colordata)

		if (this.colordata &&this.colordata.id != prevcolordata.id) {
			this.applyColorSet(prevcolordata, prevtexture, prevmaterial);
			// this.applyTexture(prevtexture);
			// this.applyMaterial(prevmaterial);
		}
	}

	calc_texture_size(approx) {
		return Math.pow(2, Math.floor(Math.log(approx) / Math.log(2)));
	}

	createGeometry(type, radius, onlyShape = false) {
		const func = onlyShape ? "create_shape" : "create_geom"
		switch (type) {
			case 'd2':
				var geom = new THREE.CylinderGeometry(1*radius, 1*radius, 0.1*radius, 32);
				geom.cannon_shape = new CANNON.Cylinder(1*radius, 1*radius, 0.1*radius, 8);
				return geom;
			case 'd4': case 'd6': case 'd8': case 'd10': case 'd12': case 'd20': {
				const { tab, af, chamfer } = GEOM_PARAMS[type];
				return this[func](DICE_GEOM[type].vertices, DICE_GEOM[type].faces, radius, tab, af, chamfer);
			}
			default:
				console.error(`Geometry for ${type} is not available`)
				return null;
		}
	}

	fixmaterials(mesh, unique_sides) {
		// this makes the mesh reuse textures for other sides
		for (let i = 0, l = mesh.geometry.groups.length; i < l; ++i) {
			var matindex = mesh.geometry.groups[i].materialIndex - 2;
			if (matindex < unique_sides) continue;

			let modmatindex = (matindex % unique_sides);

			mesh.geometry.groups[i].materialIndex = modmatindex + 2;
		}
		mesh.geometry.elementsNeedUpdate = true;
		return mesh;
	}

	create_shape(vertices, faces, radius) {
		var vectors = new Array(vertices.length);
		for (var i = 0; i < vertices.length; ++i) {
			vectors[i] = (new THREE.Vector3).fromArray(vertices[i]).normalize();
		}
		var cv = new Array(vertices.length), cf = new Array(faces.length);
		for (var i = 0; i < vectors.length; ++i) {
			var v = vectors[i];
			cv[i] = new CANNON.Vec3(v.x * radius, v.y * radius, v.z * radius);
		}
		for (var i = 0; i < faces.length; ++i) {
			cf[i] = faces[i].slice(0, faces[i].length - 1);
		}
		const shape = new CANNON.ConvexPolyhedron({vertices:cv,faces:cf});
		// console.log("🚀 ~ create_shape ~ shape", shape)
		return shape
	}

	make_geom(vertices, faces, radius, tab, af) {
		let geom = new THREE.BufferGeometry();

		for (let i = 0; i < vertices.length; ++i) {
				vertices[i] = vertices[i].multiplyScalar(radius);
		}

		let positions = [];
		const normals = [];
		const uvs = [];

		const cb = new THREE.Vector3();
		const ab = new THREE.Vector3();
		let materialIndex;
		let faceFirstVertexIndex = 0;

		for (let i = 0; i < faces.length; ++i) {
				let ii = faces[i], fl = ii.length - 1;
				let aa = Math.PI * 2 / fl;
				materialIndex = ii[fl] + 1;
				for (let j = 0; j < fl - 2; ++j) {

						//Vertices
						positions.push(...vertices[ii[0]].toArray());
						positions.push(...vertices[ii[j + 1]].toArray());
						positions.push(...vertices[ii[j + 2]].toArray());

						// Flat face normals
						cb.subVectors( vertices[ii[j + 2]], vertices[ii[j + 1]] );
						ab.subVectors( vertices[ii[0]], vertices[ii[j + 1]] );
						cb.cross( ab );
						cb.normalize();

						// Vertex Normals
						normals.push(...cb.toArray());
						normals.push(...cb.toArray());
						normals.push(...cb.toArray());

						//UVs
						uvs.push((Math.cos(af) + 1 + tab) / 2 / (1 + tab), (Math.sin(af) + 1 + tab) / 2 / (1 + tab));
						uvs.push((Math.cos(aa * (j + 1) + af) + 1 + tab) / 2 / (1 + tab), (Math.sin(aa * (j + 1) + af) + 1 + tab) / 2 / (1 + tab));
						uvs.push((Math.cos(aa * (j + 2) + af) + 1 + tab) / 2 / (1 + tab), (Math.sin(aa * (j + 2) + af) + 1 + tab) / 2 / (1 + tab));

				}

				//Set Group for face materials.
				let numOfVertices = (fl - 2) * 3;
				for (let i = 0; i < numOfVertices/3; i++) {
					geom.addGroup(faceFirstVertexIndex, 3, materialIndex);
					faceFirstVertexIndex += 3;
				}

		}


		geom.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
		geom.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
		geom.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
		geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
		return geom;
	}

	make_d10_geom(vertices, faces, radius, tab, af) {
		let geom = new THREE.BufferGeometry();

		for (let i = 0; i < vertices.length; ++i) {
				vertices[i] = vertices[i].multiplyScalar(radius);
		}

		let positions = [];
		const normals = [];
		const uvs = [];

		const cb = new THREE.Vector3();
		const ab = new THREE.Vector3();
		let materialIndex;
		let faceFirstVertexIndex = 0;

		for (let i = 0; i < faces.length; ++i) {
			let ii = faces[i], fl = ii.length - 1;
			let aa = Math.PI * 2 / fl;
			materialIndex = ii[fl] + 1;
			var w = 0.65;
			var h = 0.85;
			var v0 = 1 - 1*h;
			var v1 = 1 - (0.895/1.105)*h;
			var v2 = 1;
			for (let j = 0; j < fl - 2; ++j) {

				//Vertices
				positions.push(...vertices[ii[0]].toArray());
				positions.push(...vertices[ii[j + 1]].toArray());
				positions.push(...vertices[ii[j + 2]].toArray());

				// Flat face normals
				cb.subVectors( vertices[ii[j + 2]], vertices[ii[j + 1]] );
				ab.subVectors( vertices[ii[0]], vertices[ii[j + 1]] );
				cb.cross( ab );
				cb.normalize();

				// Vertex Normals
				normals.push(...cb.toArray());
				normals.push(...cb.toArray());
				normals.push(...cb.toArray());

				//UVs
				if(faces[i][faces[i].length-1] == -1 || j >= 2){
					uvs.push((Math.cos(af) + 1 + tab) / 2 / (1 + tab), (Math.sin(af) + 1 + tab) / 2 / (1 + tab));
					uvs.push((Math.cos(aa * (j + 1) + af) + 1 + tab) / 2 / (1 + tab), (Math.sin(aa * (j + 1) + af) + 1 + tab) / 2 / (1 + tab));
					uvs.push((Math.cos(aa * (j + 2) + af) + 1 + tab) / 2 / (1 + tab), (Math.sin(aa * (j + 2) + af) + 1 + tab) / 2 / (1 + tab));
				} else if(j==0) {
					uvs.push(0.5-w/2, v1);
					uvs.push(0.5, v0);
					uvs.push(0.5+w/2, v1);
				} else if(j==1) {
					uvs.push(0.5-w/2, v1);
					uvs.push(0.5+w/2, v1);
					uvs.push(0.5, v2);
				}
			}
			//Set Group for face materials.
			let numOfVertices = (fl - 2) * 3;
			for (let i = 0; i < numOfVertices/3; i++) {
				geom.addGroup(faceFirstVertexIndex, 3, materialIndex);
				faceFirstVertexIndex += 3;
			}
		}


		geom.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
		geom.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
		geom.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
		geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);

		return geom;
	}

	chamfer_geom(vectors, faces, chamfer) {
		var chamfer_vectors = [], chamfer_faces = [], corner_faces = new Array(vectors.length);
		for (var i = 0; i < vectors.length; ++i) corner_faces[i] = [];
		for (var i = 0; i < faces.length; ++i) {
			var ii = faces[i], fl = ii.length - 1;
			var center_point = new THREE.Vector3();
			var face = new Array(fl);
			for (var j = 0; j < fl; ++j) {
				var vv = vectors[ii[j]].clone();
				center_point.add(vv);
				corner_faces[ii[j]].push(face[j] = chamfer_vectors.push(vv) - 1);
			}
			center_point.divideScalar(fl);
			for (var j = 0; j < fl; ++j) {
				var vv = chamfer_vectors[face[j]];
				vv.subVectors(vv, center_point).multiplyScalar(chamfer).addVectors(vv, center_point);
			}
			face.push(ii[fl]);
			chamfer_faces.push(face);
		}
		for (var i = 0; i < faces.length - 1; ++i) {
			for (var j = i + 1; j < faces.length; ++j) {
				var pairs = [], lastm = -1;
				for (var m = 0; m < faces[i].length - 1; ++m) {
					var n = faces[j].indexOf(faces[i][m]);
					if (n >= 0 && n < faces[j].length - 1) {
						if (lastm >= 0 && m != lastm + 1) pairs.unshift([i, m], [j, n]);
						else pairs.push([i, m], [j, n]);
						lastm = m;
					}
				}
				if (pairs.length != 4) continue;
				chamfer_faces.push([
					chamfer_faces[pairs[0][0]][pairs[0][1]],
					chamfer_faces[pairs[1][0]][pairs[1][1]],
					chamfer_faces[pairs[3][0]][pairs[3][1]],
					chamfer_faces[pairs[2][0]][pairs[2][1]],
					-1
				]);
			}
		}
		for (var i = 0; i < corner_faces.length; ++i) {
			var cf = corner_faces[i], face = [cf[0]], count = cf.length - 1;
			while (count) {
				for (var m = faces.length; m < chamfer_faces.length; ++m) {
					var index = chamfer_faces[m].indexOf(face[face.length - 1]);
					if (index >= 0 && index < 4) {
						if (--index == -1) index = 3;
						var next_vertex = chamfer_faces[m][index];
						if (cf.indexOf(next_vertex) >= 0) {
							face.push(next_vertex);
							break;
						}
					}
				}
				--count;
			}
			face.push(-1);
			chamfer_faces.push(face);
		}
		return { vectors: chamfer_vectors, faces: chamfer_faces };
	}

	create_geom(vertices, faces, radius, tab, af, chamfer) {
		var vectors = new Array(vertices.length);
		for (var i = 0; i < vertices.length; ++i) {
			vectors[i] = (new THREE.Vector3).fromArray(vertices[i]).normalize();
		}
		var cg = this.chamfer_geom(vectors, faces, chamfer);
		if(faces.length != 10) {
			var geom = this.make_geom(cg.vectors, cg.faces, radius, tab, af);
		}
		else {
			var geom = this.make_d10_geom(cg.vectors, cg.faces, radius, tab, af);
		}
		//var geom = make_geom(vectors, faces, radius, tab, af); // Without chamfer
		geom.cannon_shape = this.create_shape(vertices, faces, radius);
		geom.name = "d"+faces.length
		return geom;
	}
}

export { DiceFactory }