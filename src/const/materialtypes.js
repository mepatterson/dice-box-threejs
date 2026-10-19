export const MATERIALTYPES = {
  'none': {
    name: 'Plastic'
  },
  'perfectmetal': {
    name: 'Perfect Metal',
    color: 0xdddddd,
    roughness: 0,
    metalness: 1,
    envMapIntensity: 1
  },
  'metal': {
    name: 'Metal',
    color: 0xdddddd,
    roughness: 0.5,
    metalness: 0.6,
    envMapIntensity: 0.7
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