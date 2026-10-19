# dice-box-threejs
3D Dice implemented with ThreeJS and Cannon ES

Based on [Major's 3D Dice](https://majorvictory.github.io/3DDiceRoller/)

The goal of this project is to decouple the UI of Major's 3D Dice and strip down the dice box to just the essentials. Just a module that accepts simple dice notation input and outputs a JSON object when the dice finish rolling.

Why another dice roller when you have [@3d-dice/dice-box](https://github.com/3d-dice/dice-box)?
Teall dice had already solved predeterministic rolling, which is a feature some developers really need. Major's 3D dice are based on Teall Dice.

## Demo
https://codesandbox.io/s/dice-box-threejs-j79h35?file=/src/index.js

## Install using NPM
```
npm install @3d-dice/dice-box-threejs
```

## Config Options
```
const defaultConfig = {
	framerate: (1/60),
	sounds: false,
	volume: 100,
	color_spotlight: 0xefdfd5,
	shadows: true,
	theme_surface:  "green-felt",
	sound_dieMaterial: 'plastic',
	theme_customColorset: null,
	theme_colorset: "white", // see available colorsets in https://github.com/3d-dice/dice-box-threejs/blob/main/src/const/colorsets.js
	theme_texture: "", // see available textures in https://github.com/3d-dice/dice-box-threejs/blob/main/src/const/texturelist.js
	theme_material: "glass", // "none" | "metal" | "wood" | "glass" | "plastic"
	gravity_multiplier: 400,
	light_intensity: 0.7,
	baseScale: 100,
	strength: 1, // toss strength of dice
	maxPixelRatio: 2, // caps devicePixelRatio; 3x phones render at 2x
	rollingPixelRatio: null, // e.g. 1 to render moving dice at 1x and the settled dice at full ratio
	textureScale: 0.5, // label texture resolution relative to the original 512px faces
	glass_opacity: 0.35, // how much of what's behind a glass die its body hides, 0 to 1
	preloadDice: null, // e.g. ["d20", "d6"] to build textures and compile shaders in initialize()
	onRollComplete: () => {}
}
```

`theme_material` applies to stock colorsets. A `theme_customColorset` takes its material from its
own `material` key (for example `material: "glass"`); without one it renders with the plain
(Phong) material.

Glass dice are translucent: the page or scene behind shows through the tinted body and its back
faces, while the numbers stay opaque. `glass_opacity` sets how solid the body is, and a custom
colorset can set its own:
```
theme_customColorset: { name: "amber", foreground: "#F2743B", background: "#3A2418", outline: "#1A0E07", material: "glass", glass_opacity: 0.5 }
```
Metal and glass reflect a small studio environment the box generates once, the first time a
colorset needs it.

## Getting Results
### There are three ways to get results
1. You can define an `onRollComplete` callback function when creating the Dice Box
```
const Box = new DiceBox("#scene-container",{
  onRollComplete: (results) => {
    console.log(`I've got results :>> `, results);
  }
});
```
2. You can listen for the custom event that is triggered when results are ready
```
document.addEventListener("rollComplete",(e => {
  console.log(`I've got custom event results :>> `, e.detail);
}))
```
3. You can await the results from the `roll` method. Just be sure the function this call is in is `async`
```
setTimeout(async () => {
  const result = await Box.roll("6d6")
  console.log('result :>> ', result);
}, 1000);
```

## Predetermined Outcomes
As mentioned previously, this project was forked for it's predeterministic rolling capability. The notation to roll your predetermined outcomes looks like this:
```
Box.roll("6d6@4,4,4,4,4,4") // rolls six dice that will land on 4's
```

## Clearing and teardown
```
Box.clearDice()                      // remove the dice now
await Box.clearDice({ fade: 400 })   // fade the canvas out over 400 ms, then remove them
await Box.preload(["d20", "d6"])     // optional: build textures and compile shaders ahead of the first roll
Box.dispose()                        // stop listening for resizes, free GPU memory, remove the canvas
```
A roll or `add()` that starts during a fade cancels it. Dice share cached geometry, textures and
materials, so clearing frees nothing per die and memory stays flat across rolls; `dispose()` frees
the caches. Call it when the element goes away (for example on a page navigation), since browsers
cap the number of live WebGL contexts.

## Full-viewport overlay
The canvas is transparent apart from the dice and their shadows, so the box works as an overlay
over a page:
```
#dice-box { position: fixed; inset: 0; pointer-events: none; }
```
The box follows window and container resizes (it uses a `ResizeObserver`). Walls sit just inside
the container edges, so dice bounce off the viewport edges. A resize during a throw moves the walls
once the dice settle (moving them mid-throw would change where the dice land), and resting dice
that end up outside a smaller box slide back in.

## Development
```
npm run build   # dist/dice-box-threejs.es.js (minified, three and cannon-es bundled) and .umd.js
npm run bench   # predetermined-roll checks, timing, memory and bundle size in headless Chrome
node bench/run.mjs main=path/to/old.es.js branch=dist/dice-box-threejs.es.js --profiles=phone,laptop
```
The bench needs Chrome installed. It renders with SwiftShader (software GL), so frame times are
only meaningful relative to another build. See `docs/ARCHITECTURE.md` for how a roll works.

Built on three.js r186 (sRGB output, physically based light units) and cannon-es 0.20.

## Notes
In order to use textures or sounds, you will need to manually copy the assets out of the `./public` folder and into your static assets folder where you're building your app.
