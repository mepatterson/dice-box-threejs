export const MATERIALTYPES = {
  'none': {
    name: 'Plastic',
    roughness: 0.4,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.25
  },
  'perfectmetal': {
    name: 'Perfect Metal',
    color: 0xffffff,
    roughness: 0.04,
    metalness: 1,
    envMapIntensity: 1.2
  },
  'metal': {
    name: 'Metal',
    color: 0xffffff,
    roughness: 0.2,
    metalness: 1,
    envMapIntensity: 1.3
  },
  'brushedmetal': {
    name: 'Brushed Metal',
    color: 0xffffff,
    roughness: 0.38,
    metalness: 1,
    anisotropy: 0.8,
    envMapIntensity: 1.4
  },
  'wood': {
    name: 'Wood',
    color: 0xdddddd,
    roughness: 0.75,
    metalness: 0.0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.2
  },
  'glass': {
    name: 'Glass',
    color: 0xffffff,
    roughness: 0.07,
    metalness: 0.0,
    envMapIntensity: 0.9
  }
}