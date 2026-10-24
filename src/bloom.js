import * as THREE from "three"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js"

// Bloom for the dice of colorsets that ask for it (`bloom`, a strength): only what glows blooms. Those dice
// are also on BLOOM_LAYER, and their materials carry `bloomShader`, which while `bloomOnly` is set writes
// nothing but their emissive light (lava's cracks, neon tubes, the result glow). After the canvas is drawn
// as usual, that layer is drawn again on its own into a small half-float target, three's UnrealBloomPass
// blurs it, and the blur is laid over the canvas as premultiplied light: its alpha is its brightest
// channel, so over the page it reads as glow in its own colour, never as a dark fringe or a box.

export const BLOOM_LAYER = 2
// Bloom renders at this share of the canvas by device (it is a blur, so it hardly shows), and halves its
// share again while the frames it adds run slow.
export const BLOOM_SCALES = { desktop: 0.5, tablet: 0.4, phone: 0.3 }
const LEAST = 0.12
const PASS = { radius: 0.3, threshold: 0.35, strength: 0.22 }
const FACTORS = [1, 0.75, 0.45, 0.15, 0]

// A material that glows on its own (lava, neon: their `diceGlow`) blooms only that, so the result glow
// over its numbers stays readable; any other blooms its whole emissive light, the result glow included.
export function bloomShader(shader, only) {
	const glow = shader.fragmentShader.includes('diceGlow') ? 'diceGlow' : 'totalEmissiveRadiance'
	shader.uniforms.diceBloomOnly = only
	shader.fragmentShader = shader.fragmentShader
		.replace('void main() {', 'uniform float diceBloomOnly;\nvoid main() {')
		.replace('#include <dithering_fragment>', `#include <dithering_fragment>
			if ( diceBloomOnly > 0.5 ) gl_FragColor = vec4( ${glow}, 1.0 );`)
}

const COMPOSITE = new THREE.ShaderMaterial({
	uniforms: { tBloom: { value: null } },
	vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
	// the glow never quite hides what it lies over, so a bloomed number stays crisp under its glow
	fragmentShader: `
		#define CAP 0.65
		uniform sampler2D tBloom;
		varying vec2 vUv;
		void main() {
			vec3 glow = max( texture2D( tBloom, vUv ).rgb, vec3( 0.0 ) );
			float peak = max( glow.r, max( glow.g, glow.b ) );
			float alpha = clamp( peak, 0.0, CAP );
			vec3 hue = glow / max( peak, 0.0001 );
			hue = mix( hue * 12.92, 1.055 * pow( hue, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, hue ) );
			// a little noise breaks the faint wide glow's 8-bit steps into grain instead of rings
			alpha = max( alpha + ( fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5 ) / 255.0, 0.0 );
			gl_FragColor = vec4( hue * alpha, alpha );
		}`,
	blending: THREE.CustomBlending,
	blendSrc: THREE.OneFactor,
	blendDst: THREE.OneMinusSrcAlphaFactor,
	blendSrcAlpha: THREE.OneFactor,
	blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
	depthTest: false,
	depthWrite: false,
	transparent: true,
})

export class DiceBloom {
	constructor() {
		this.source = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
		this.pass = new UnrealBloomPass(new THREE.Vector2(1, 1), PASS.strength, PASS.radius, PASS.threshold)
		// the widest mips only add a faint haze across the page
		this.pass.compositeMaterial.uniforms.bloomFactors.value = FACTORS
		this.composite = COMPOSITE.clone()
		this.quad = new FullScreenQuad(this.composite)
		this.size = new THREE.Vector2()
	}

	// After the canvas is drawn: the glowing dice again, bloomed and laid over it.
	render(renderer, scene, camera, { scale, strength, only }) {
		renderer.getDrawingBufferSize(this.size)
		const w = Math.max(1, Math.round(this.size.x * scale)), h = Math.max(1, Math.round(this.size.y * scale))
		if (this.source.width !== w || this.source.height !== h) {
			this.source.setSize(w, h)
			this.pass.setSize(w, h)
		}
		const previous = renderer.getRenderTarget()
		const autoClear = renderer.autoClear
		const shadows = renderer.shadowMap.autoUpdate
		const clear = renderer.getClearColor(new THREE.Color())
		const clearAlpha = renderer.getClearAlpha()
		try {
			only.value = 1
			renderer.shadowMap.autoUpdate = false
			camera.layers.set(BLOOM_LAYER)
			renderer.setRenderTarget(this.source)
			renderer.setClearColor(0x000000, 0)
			renderer.clear()
			renderer.render(scene, camera)
			this.pass.strength = PASS.strength * strength
			this.pass.render(renderer, null, this.source, 0, false)
			renderer.setRenderTarget(previous)
			renderer.autoClear = false
			this.composite.uniforms.tBloom.value = this.pass.renderTargetsHorizontal[0].texture
			this.quad.render(renderer)
		} finally {
			only.value = 0
			camera.layers.set(0)
			renderer.shadowMap.autoUpdate = shadows
			renderer.setClearColor(clear, clearAlpha)
			renderer.autoClear = autoClear
			renderer.setRenderTarget(previous)
		}
	}

	// Programs for the bloom target, compiled ahead like the canvas's.
	get target() {
		return this.source
	}

	dispose() {
		this.source.dispose()
		this.pass.dispose()
		this.composite.dispose()
		this.quad.dispose()
	}
}

export { LEAST as BLOOM_LEAST }
