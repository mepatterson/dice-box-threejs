import * as THREE from "three"

// Fur shells: a texture with `fuzz` grows short strands that stand off the die's silhouette. The die
// is drawn again as an InstancedMesh child, one instance per shell, each pushed a little further out
// along the smoothed surface direction. Every shell keeps only the pixels inside a strand (alpha test,
// with a pixel of soft edge so fine strands don't shimmer), and a strand narrows as the shells rise, so
// the stack reads as tapered fibres. Strands are spots in a 3D field sampled at the die's own surface, so they run on unbroken
// over edges and corners and turn with the die. How long they grow comes from the label's fuzz map:
// the surface's fuzz field turned and shifted like its colours, with the numbers knocked out.

export const MAX_SHELLS = 24

const FIELD = { SIZE: 48, CELLS: 10, SEED: 91 }

export const FUZZ_DEFAULTS = { shells: 16, length: 0.12, density: 36, thickness: 0.55, lean: 0.3, taper: 0.7, fade: 0.7, root: 1, color: '#4a7326', tint: 0, tip: '#d4e48a', tipMix: 0.4 }

function random(seed) {
	return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

// A tiling 3D texture: red is the distance to the nearest strand centre (in cells, at most 1), green
// that strand's own random number, which sets its length. Strand centres are jittered inside their
// cells, kept off the cell walls so the strands stay evenly spread like a moss's stems.
export function strandField() {
	const { SIZE, CELLS, SEED } = FIELD
	const next = random(SEED)
	const points = Array.from({ length: CELLS ** 3 }, () => [0.15 + 0.7 * next(), 0.15 + 0.7 * next(), 0.15 + 0.7 * next(), next()])
	const wrap = i => ((i % CELLS) + CELLS) % CELLS
	const data = new Uint8Array(SIZE ** 3 * 2)
	for (let z = 0; z < SIZE; z++) {
		for (let y = 0; y < SIZE; y++) {
			for (let x = 0; x < SIZE; x++) {
				const px = (x + 0.5) / SIZE * CELLS, py = (y + 0.5) / SIZE * CELLS, pz = (z + 0.5) / SIZE * CELLS
				const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz)
				let best = Infinity, rand = 0
				for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
					const p = points[(wrap(cz + dz) * CELLS + wrap(cy + dy)) * CELLS + wrap(cx + dx)]
					const d = Math.hypot(cx + dx + p[0] - px, cy + dy + p[1] - py, cz + dz + p[2] - pz)
					if (d < best) {
						best = d
						rand = p[3]
					}
				}
				const i = ((z * SIZE + y) * SIZE + x) * 2
				data[i] = Math.round(Math.min(1, best) * 255)
				data[i + 1] = Math.round(rand * 255)
			}
		}
	}
	const texture = new THREE.Data3DTexture(data, SIZE, SIZE, SIZE)
	texture.format = THREE.RGFormat
	texture.type = THREE.UnsignedByteType
	texture.minFilter = texture.magFilter = THREE.LinearFilter
	texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping
	texture.unpackAlignment = 1
	texture.needsUpdate = true
	return texture
}

const shellGeometries = new WeakMap()

// The die's own geometry for its shells: the same buffers, its runs of groups with one material slot
// merged so a classic die (a group per triangle) draws its shells in a few calls, and `fuzzDir`, the
// direction each vertex is pushed (the area-weighted normal of every triangle at that point, so the
// shells stay closed over edges and corners) with the die's radius in w.
export function shellGeometry(geom) {
	let shell = shellGeometries.get(geom)
	if (shell) return shell
	shell = new THREE.BufferGeometry()
	for (const name of ['position', 'normal', 'uv']) shell.setAttribute(name, geom.getAttribute(name))
	if (geom.index) shell.setIndex(geom.index)
	let last = null
	for (const group of geom.groups) {
		if (last && last.materialIndex === group.materialIndex && last.start + last.count === group.start) last.count += group.count
		else {
			shell.addGroup(group.start, group.count, group.materialIndex)
			last = shell.groups[shell.groups.length - 1]
		}
	}
	const position = geom.getAttribute('position')
	const radius = geom.boundingSphere ? geom.boundingSphere.radius : (geom.computeBoundingSphere(), geom.boundingSphere.radius)
	const keyOf = i => `${Math.round(position.getX(i) * 100)},${Math.round(position.getY(i) * 100)},${Math.round(position.getZ(i) * 100)}`
	const keys = Array.from({ length: position.count }, (_, i) => keyOf(i))
	const sums = new Map()
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
	const corners = geom.index ? geom.index.count : position.count
	const vertex = i => (geom.index ? geom.index.getX(i) : i)
	for (let i = 0; i < corners; i += 3) {
		const [i0, i1, i2] = [vertex(i), vertex(i + 1), vertex(i + 2)]
		a.fromBufferAttribute(position, i0)
		b.fromBufferAttribute(position, i1).sub(a)
		c.fromBufferAttribute(position, i2).sub(a)
		b.cross(c)
		for (const v of [i0, i1, i2]) {
			const sum = sums.get(keys[v]) || sums.set(keys[v], new THREE.Vector3()).get(keys[v])
			sum.add(b)
		}
	}
	const dirs = new Float32Array(position.count * 4)
	for (let i = 0; i < position.count; i++) {
		const dir = sums.get(keys[i]).clone()
		if (dir.lengthSq() < 1e-12) dir.fromBufferAttribute(position, i)
		dir.normalize().toArray(dirs, i * 4)
		dirs[i * 4 + 3] = radius
	}
	shell.setAttribute('fuzzDir', new THREE.BufferAttribute(dirs, 4))
	shell.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.3)
	shellGeometries.set(geom, shell)
	geom.addEventListener('dispose', () => {
		shellGeometries.delete(geom)
		shell.dispose()
	})
	return shell
}

// One shell material per label material: its colour map and fuzz map, lit like a matte surface,
// darker at the root and lighter towards the tips. `shells` is the shared uniform holding how many
// shells are drawn, so the strands keep their length whatever the count.
export function shellMaterial(base, { field, shells, dim }) {
	const fuzz = { ...FUZZ_DEFAULTS, ...base.fuzz }
	const mat = new THREE.MeshLambertMaterial({ map: base.map, transparent: true, depthTest: true, depthWrite: true })
	const uniforms = {
		fuzzMap: { value: base.fuzzMap },
		fuzzField: { value: field },
		fuzzShells: shells,
		fuzzLength: { value: fuzz.length },
		fuzzLean: { value: fuzz.lean },
		fuzzDensity: { value: fuzz.density / FIELD.CELLS },
		fuzzThickness: { value: fuzz.thickness },
		fuzzRoot: { value: fuzz.root },
		fuzzTip: { value: new THREE.Color(fuzz.tip) },
		fuzzColor: { value: new THREE.Color(fuzz.color) },
		fuzzTint: { value: fuzz.tint },
		fuzzTipMix: { value: fuzz.tipMix },
		fuzzFade: { value: fuzz.fade },
		fuzzTaper: { value: fuzz.taper },
	}
	mat.onBeforeCompile = shader => {
		Object.assign(shader.uniforms, uniforms)
		shader.vertexShader = shader.vertexShader
			.replace('void main() {', `attribute vec4 fuzzDir;
				uniform float fuzzShells;
				uniform float fuzzLength;
				uniform float fuzzLean;
				varying vec3 vFuzzPos;
				varying float vFuzzT;
				void main() {`)
			.replace('#include <begin_vertex>', `#include <begin_vertex>
				vFuzzT = ( float( gl_InstanceID ) + 1.0 ) / fuzzShells;
				vFuzzPos = position / fuzzDir.w;
				vec3 fuzzSway = sin( vFuzzPos.yzx * vec3( 5.1, 4.3, 6.7 ) + vFuzzPos.zxy * vec3( 3.7, 5.9, 4.1 ) );
				fuzzSway -= fuzzDir.xyz * dot( fuzzSway, fuzzDir.xyz );
				transformed += ( fuzzDir.xyz * vFuzzT + fuzzSway * ( fuzzLean * vFuzzT * vFuzzT ) ) * ( fuzzDir.w * fuzzLength );`)
		shader.fragmentShader = shader.fragmentShader
			.replace('void main() {', `uniform sampler2D fuzzMap;
				uniform highp sampler3D fuzzField;
				uniform float fuzzDensity;
				uniform float fuzzThickness;
				uniform float fuzzRoot;
				uniform vec3 fuzzTip;
				uniform vec3 fuzzColor;
				uniform float fuzzTint;
				uniform float fuzzTipMix;
				uniform float fuzzFade;
				uniform float fuzzTaper;
				varying vec3 vFuzzPos;
				varying float vFuzzT;
				void main() {`)
			.replace('#include <map_fragment>', `
				{
					diffuseColor *= texture( map, vMapUv, 1.5 );
					diffuseColor.rgb = mix( diffuseColor.rgb, fuzzColor, fuzzTint );
					float fuzzNear = texture( fuzzMap, vMapUv ).r;
					float fuzzWide = texture( fuzzMap, vMapUv, 2.5 ).r;
					vec2 strand = texture( fuzzField, vFuzzPos * fuzzDensity ).rg;
					float soft = fwidth( strand.x ) * 0.75 + 0.002;
					float reach = fuzzNear * smoothstep( 0.25, 0.6, fuzzWide ) * ( 0.45 + 0.55 * strand.y );
					if ( vFuzzT > reach ) discard;
					float rise = vFuzzT / reach;
					float radius = fuzzThickness * ( 1.0 - fuzzTaper * rise );
					float cover = 1.0 - smoothstep( radius - soft, radius + soft, strand.x );
					if ( cover < 0.04 ) discard;
					diffuseColor.rgb *= fuzzRoot + ( 1.0 - fuzzRoot ) * rise;
					diffuseColor.rgb = mix( diffuseColor.rgb, fuzzTip, fuzzTipMix * smoothstep( 0.3, 1.0, rise ) );
					diffuseColor.a = cover * ( 1.0 - fuzzFade * rise * rise );
					${dim ? 'diffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, 0.4 ) * 0.55;' : ''}
				}`)
	}
	mat.customProgramCacheKey = () => (dim ? 'fuzz|dim' : 'fuzz')
	return mat
}
