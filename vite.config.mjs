import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	root: resolve(here, "src"),
	build: {
		lib: {
			entry: resolve(here, "src/index.js"),
			name: "dice-box-threejs",
			fileName: format => `dice-box-threejs.${format}.js`,
		},
		outDir: resolve(here, "dist"),
		emptyOutDir: true,
		rolldownOptions: {
			// The ES build ships as one self-contained file (an app can serve it straight from an
			// importmap), so minify it fully. Vite leaves whitespace in ES library output by default.
			output: { minify: true },
		},
	},
})
