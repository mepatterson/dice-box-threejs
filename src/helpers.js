import * as THREE from "three"

/**
 * Debounce functions for better performance
 * (c) 2021 Chris Ferdinandi, MIT License, https://gomakethings.com
 * @param  {Function} fn The function to debounce
 */
 export const debounce = (fn) => {

	// Setup a timer
	let timeout;

	// Return a function to run debounced
	return function () {

		// Setup the arguments
		let context = this;
		let args = arguments;

		// If there's a timer, cancel it
		if (timeout) {
			window.cancelAnimationFrame(timeout);
		}

		// Setup the new requestAnimationFrame()
		timeout = window.requestAnimationFrame(function () {
			fn.apply(context, args);
		});
	};
}

// A soft round dot as a texture: white, its alpha falling from the middle to the rim through `stops`
// ([offset, alpha] pairs, offsets 0 to 1 as in a canvas gradient). Computed rather than drawn as a canvas
// gradient: WebKit uploads a canvas's soft alpha to WebGL with stray colours in it, which show as speckles.
export function radialDot(size, stops) {
	const data = new Uint8Array(size * size * 4);
	const half = size / 2;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const r = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
			let alpha = 0;
			for (let k = 1; k < stops.length; k++) {
				const [r0, a0] = stops[k - 1], [r1, a1] = stops[k];
				if (r <= r1) {
					alpha = r <= r0 ? a0 : a0 + (a1 - a0) * (r - r0) / (r1 - r0);
					break;
				}
			}
			const i = (y * size + x) * 4;
			data[i] = data[i + 1] = data[i + 2] = 255;
			data[i + 3] = Math.round(alpha * 255);
		}
	}
	const texture = new THREE.DataTexture(data, size, size);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.generateMipmaps = true;
	texture.needsUpdate = true;
	return texture;
}