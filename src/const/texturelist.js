const MOSS_FINISH = { roughness: 0.88, clearcoat: 0, clearcoatRoughness: 1, sheen: 0.3, sheenColor: '#b4c792', sheenRoughness: 0.8, envMapIntensity: 0.15 };
const MOSS_FUZZ = { shells: 16, length: 0.12, density: 36, thickness: 0.55, lean: 0.3, taper: 0.7, fade: 0.7, root: 1, color: '#4a7326', tint: 0.5, tip: '#d4e48a', tipMix: 0.4 };

export const TEXTURELIST = {
	'cloudy': {
		name: 'Clouds (Transparent)',
		composite: 'destination-in',
		source: 'textures/cloudy.webp',
		source_bump: 'textures/cloudy.alt.webp'
	},
	'cloudy_2': {
		name: 'Clouds',
		composite: 'multiply',
		source: 'textures/cloudy.alt.webp',
		source_bump: 'textures/cloudy.alt.webp'
	},
	'fire': {
		name: 'Fire',
		composite: 'multiply',
		source: 'textures/fire.webp',
		source_bump: 'textures/fire.webp',
		material: 'metal'
	},
	'marble': {
		name: 'Marble',
		composite: 'multiply',
		source: 'textures/marble.webp',
		source_bump: '',
		material: 'glass'
	},
	'water': {
		name: 'Water',
		composite: 'destination-in',
		source: 'textures/water.webp',
		source_bump: 'textures/water.webp',
		material: 'glass'
	},
	'ice': {
		name: 'Ice',
		composite: 'destination-in',
		source: 'textures/ice.webp',
		source_bump: 'textures/ice.webp',
		material: 'glass'
	},
	'paper': {
		name: 'Paper',
		composite: 'multiply',
		source: 'textures/paper.webp',
		source_bump: 'textures/paper-bump.webp',
		material: 'wood'
	},
	'speckles': {
		name: 'Speckles',
		composite: 'multiply',
		source: 'textures/speckles.webp',
		source_bump: 'textures/speckles.webp',
		material: 'none'
	},
	'glitter': {
		name: 'Glitter',
		composite: 'multiply',
		source: 'textures/glitter.webp',
		source_bump: 'textures/glitter-bump.webp',
		material: 'none'
	},
	'glitter_2': {
		name: 'Glitter (Transparent)',
		composite: 'destination-in',
		source: 'textures/glitter-alpha.webp',
		source_bump: '',
		material: 'none'
	},
	'stars': {
		name: 'Stars',
		composite: 'multiply',
		source: 'textures/stars.webp',
		source_bump: 'textures/stars.webp',
		material: 'none'
	},
	'stainedglass': {
		name: 'Stained Glass',
		composite: 'multiply',
		source: 'textures/stainedglass.webp',
		source_bump: 'textures/stainedglass-bump.webp',
		material: 'glass'
	},
	'wood': {
		name: 'Wood',
		composite: 'multiply',
		source: 'textures/wood.webp',
		source_bump: 'textures/wood.webp',
		material: 'wood'
	},
	'metal': {
		name: 'Stainless Steel',
		composite: 'multiply',
		source: 'textures/metal.webp',
		source_bump: 'textures/metal-bump.webp',
		material: 'metal'
	},
	'skulls': {
		name: 'Skulls',
		composite: 'multiply',
		source: 'textures/skulls.webp',
		source_bump: 'textures/skulls.webp'
	},
	'leopard': {
		name: 'Leopard',
		composite: 'multiply',
		source: 'textures/leopard.webp',
		source_bump: 'textures/leopard.webp',
		material: 'wood'
	},
	'tiger': {
		name: 'Tiger',
		composite: 'multiply',
		source: 'textures/tiger.webp',
		source_bump: 'textures/tiger.webp',
		material: 'wood'
	},
	'cheetah': {
		name: 'Cheetah',
		composite: 'multiply',
		source: 'textures/cheetah.webp',
		source_bump: 'textures/cheetah.webp',
		material: 'wood'
	},
	'dragon': {
		name: 'Dragon',
		composite: 'multiply',
		source: 'textures/dragon.webp',
		source_bump: 'textures/dragon-bump.webp',
		material: 'none'
	},
	'lizard': {
		name: 'Lizard',
		composite: 'multiply',
		source: 'textures/lizard.webp',
		source_bump: 'textures/lizard.webp',
		material: 'none'
	},
	'bird': {
		name: 'Bird',
		composite: 'multiply',
		source: 'textures/feather.webp',
		source_bump: 'textures/feather-bump.webp',
		material: 'wood'
	},
	'astral': {
		name: 'Astral Sea',
		composite: 'multiply',
		source: 'textures/astral.webp',
		source_bump: 'textures/stars.webp',
		material: 'none'
	},
	'acleaf': {
		name: 'AC Leaf',
		composite: 'multiply',
		source: 'textures/acleaf.webp',
		source_bump: 'textures/acleaf.webp',
		material: 'none'
	},
	'thecage': {
		name: 'Nicholas Cage',
		composite: 'multiply',
		source: 'textures/thecage.webp',
		source_bump: '',
		material: 'metal'
	},
	'isabelle': {
		name: 'Isabelle',
		composite: 'source-over',
		source: 'textures/isabelle.webp',
		source_bump: '',
		material: 'none'
	},
	'bronze01': {
		name: 'bronze01',
		composite: 'difference',
		source: 'textures/bronze01.webp',
		source_bump: '',
		material: 'metal'
	},
	'bronze02': {
		name: 'bronze02',
		composite: 'difference',
		source: 'textures/bronze02.webp',
		source_bump: '',
		material: 'metal'
	},
	'bronze03': {
		name: 'bronze03',
		composite: 'difference',
		source: 'textures/bronze03.webp',
		source_bump: '',
		material: 'metal'
	},
	'bronze03a': {
		name: 'bronze03a',
		composite: 'difference',
		source: 'textures/bronze03a.webp',
		source_bump: '',
		material: 'metal'
	},
	'bronze03b': {
		name: 'bronze03b',
		composite: 'difference',
		source: 'textures/bronze03b.webp',
		source_bump: '',
		material: 'metal'
	},
	'bronze04': {
		name: 'bronze04',
		composite: 'difference',
		source: 'textures/bronze04.webp',
		source_bump: '',
		material: 'metal'
	},
	'bone': {
		name: 'Bone',
		surface: 'bone',
		source: '',
		source_bump: '',
		material: 'none',
		finish: { roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.2 }
	},
	'swirl': {
		name: 'Swirl',
		surface: 'swirl',
		source: '',
		source_bump: '',
		material: 'none'
	},
	'stone': {
		name: 'Stone',
		surface: 'stone',
		source: '',
		source_bump: '',
		material: 'none',
		finish: { roughness: 0.6, clearcoat: 0.2, clearcoatRoughness: 0.45, envMapIntensity: 0.2 }
	},
	'pearl': {
		name: 'Pearl',
		surface: 'pearl',
		source: '',
		source_bump: '',
		material: 'none',
		finish: { roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [100, 480], sheen: 1, sheenColor: '#f3d9e6', sheenRoughness: 0.35, envMapIntensity: 0.6 }
	},
	'opal': {
		name: 'Opal',
		surface: 'opal',
		source: '',
		source_bump: '',
		material: 'none',
		finish: { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 520], envMapIntensity: 0.55 }
	},
	'obsidian': {
		name: 'Obsidian',
		surface: 'obsidian',
		source: '',
		source_bump: '',
		material: 'none',
		finish: { roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.5 }
	},
	'sparkles': {
		name: 'Sparkles',
		surface: 'sparkles',
		source: '',
		source_bump: '',
		material: 'none',
		finish: { roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.35 }
	},
	'moss': {
		name: 'Moss',
		surface: 'moss',
		source: '',
		source_bump: '',
		material: 'none',
		finish: MOSS_FINISH,
		fuzz: MOSS_FUZZ
	},
	// moss in the accent's colours: with `shades` its sheen and strand colours move to the accent too
	'growth': {
		name: 'Growth',
		surface: 'growth',
		source: '',
		source_bump: '',
		material: 'none',
		finish: MOSS_FINISH,
		fuzz: MOSS_FUZZ,
		shades: true
	},
	// dark rock with glowing cracks that flow (lava.js), in the colorset's accent or ember
	'lava': {
		name: 'Lava',
		surface: 'lava',
		source: '',
		source_bump: '',
		material: 'none',
		lava: true,
		finish: { roughness: 0.85, clearcoat: 0.15, clearcoatRoughness: 0.5, envMapIntensity: 0.12 }
	},
	// a dark storm cloud with lightning crackling through it (lava.js's storm), in the colorset's accent or ice blue
	'storm': {
		name: 'Storm',
		surface: 'storm',
		source: '',
		source_bump: '',
		material: 'none',
		lava: true,
		storm: true,
		finish: { roughness: 0.6, clearcoat: 0.4, clearcoatRoughness: 0.2, envMapIntensity: 0.2 }
	},
	// pebble-grained leather in the body colour, satin, with darker creases (the pebble relief)
	'leather': {
		name: 'Leather',
		surface: 'leather',
		source: '',
		source_bump: '',
		material: 'none',
		relief: 'pebble',
		finish: { roughness: 0.55, clearcoat: 0, clearcoatRoughness: 1, sheen: 0.1, sheenColor: '#ffffff', sheenRoughness: 0.5, envMapIntensity: 0.15 }
	},
	'none': {
		name: 'none',
		composite: 'source-over',
		source: '',
		source_bump: '',
		material: ''
	},
	'': {
		name: '~ Preset ~',
		composite: 'source-over',
		source: '',
		source_bump: '',
		material: ''
	}
};