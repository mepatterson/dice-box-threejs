export const MATERIALTYPES = {
  'none': {
    name: 'Plastic'
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
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0
  },
  'glass': {
    name: 'Glass',
    color: 0xffffff,
    roughness: 0.05,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1
  }
}