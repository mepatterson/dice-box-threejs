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
	theme_texture: "", // "bone" | "swirl" | "stone" | "pearl" | "opal" | "obsidian" | "sparkles", or an image texture from https://github.com/3d-dice/dice-box-threejs/blob/main/src/const/texturelist.js
	theme_material: "glass", // "none" | "metal" | "wood" | "glass" | "plastic"
	gravity_multiplier: 400,
	light_intensity: 0.7,
	baseScale: 100,
	strength: 1, // toss strength of dice
	maxPixelRatio: 2, // caps devicePixelRatio; 3x phones render at 2x
	rollingPixelRatio: null, // e.g. 1 to render moving dice at 1x and the settled dice at full ratio
	textureScale: 0.5, // label texture resolution relative to the original 512px faces (metal always uses full resolution)
	glass_opacity: 0.35, // how much of what's behind a glass die its body hides, 0 to 1
	glass_refraction: true, // false | { ior: 1.5, strength: 1, dispersion: 0.02 }: the room seen through glass
	glass_edges: 0.35, // 0 to 1: how much glass bevels stand out
	environment: "studio", // or a URL, or { url, intensity: 1, rotation: 0 }; what metal and glass reflect
	fontTimeout: 3000, // ms to wait for a colorset's number font before falling back to the default
	highlightResult: false, // true | { glow: true | number, pop: true }: light up the result when dice settle
	throwFrom: "any", // "sides" | "left" | "right": where dice come in from
	preloadDice: null, // e.g. ["d20", "d6"] to build textures and compile shaders in initialize()
	onRollComplete: () => {}
}
```

`theme_material` applies to stock colorsets. A `theme_customColorset` takes its material from its
own `material` key (for example `material: "glass"`); without one it renders with the plain
(Phong) material.

Glass dice are translucent: the page or scene behind shows through the tinted body and its back
faces, while the numbers stay opaque. Reflections are the faint, untinted ones of real glass (strong
only at grazing angles, with small, soft glints); the colour is in the light passing
through, clear in the middle of a die and deeper towards its rim. Bevels read as thicker glass:
deeper body colour, with their reflections tinted by it and a thin bright rim only where they face
a bright part of the room. `glass_edges` (0 to 1, default 0.35, live with `updateConfig`) sets how
much they stand out; 0 leaves only the deeper colour and 1 gives bright, pale edges. `glass_opacity` sets how solid the body is, and a custom
colorset can set its own:
```
theme_customColorset: { name: "amber", foreground: "#F2743B", background: "#3A2418", outline: "#1A0E07", material: "glass", glass_opacity: 0.5 }
```
Metal, glass, plastic and wood reflect a small studio environment the box generates once, the first
time a colorset needs it.

### Plastic and wood
Plastic (`none`, or `plastic`) is glossy acrylic: a clear coat with faint reflections that get stronger
towards the edges. Stock colorsets keep their colours; they gain that gloss and their sides read a
little darker than the old fully matte finish. Wood without a texture gets a wood grain drawn in its
body colour and a satin varnish, so it is told apart from plastic at a glance.

### Procedural textures
Seven textures are generated in code instead of loaded from `public/textures`, so they need no asset
files. Each is drawn in the colorset's own colours, with a finish to match:
- `bone`: ivory. Faint warm staining, fine grain lines, tiny pores and the odd hairline crack, a satin
  finish and a very slight bump. Dark brown or near-black numbers read best on it.
- `swirl`: poured resin or agate. Flowing ribbons of an accent colour (the colorset's `accent`, or a
  lighter body colour) with a soft haze and thin dark veins, under the usual glossy plastic. With
  `material: "glass"` the ribbons are milky inclusions inside the glass.
- `stone`: granite. Dark and light mineral grains over a fine speckle with faint pale veins, a satin
  to matte finish and a gentle bump, so light rakes across it.
- `pearl`: mother of pearl. Soft nacre sheets with hints of rose and green, a clear coat, iridescence
  and a pink sheen at grazing angles. Dark numbers read best on it. `rainbow: true` gives the sheets
  soft colours from the whole spectrum instead of the accent.
- `opal`: precious opal or abalone. Flowing sheets whose colour sweeps through blue, green and violet
  with rarer magenta and orange, small bright flecks of fire and an iridescent clear coat. With a
  coloured `accent` the colours stay within about 70 degrees of its hue (a grey or black accent, or
  none, gives the full play of colour). Made for black glass (`background: "#000000"`, `material:
  "glass"`) and also good on deep coloured glass and on pale or near-black plastic, where it is
  softer and milkier or fuller to match. White numbers read best on dark bodies.
- `obsidian`: volcanic glass. Tiny bright flecks (pale silver, or the colorset's `accent`) that glint
  once the die settles and faint silvery bands for a near-black body under a mirror-like clear coat. White
  numbers read best; gold looks richer. On glass the flecks keep full strength, so they show on pale
  and mid bodies too.
- `sparkles`: glitter resin. Hexagonal chips a few pixels across and a few larger ones, in white and
  the accent (or a lighter body colour), over a faint dust of tiny specks. Each chip is a small tilted
  mirror: while the dice tumble the chips hold a steady sheen, and once they settle the glints fade in
  and twinkle slowly for about a second, gleaming in the chip's own colour, then hold still. Works on
  light and dark glass and on plastic; the numbers are drawn over it, clear of flecks. Obsidian's flecks
  behave the same way.
```
theme_customColorset: { name: "amethyst", foreground: "#F6E7C1", background: "#4A2363", outline: "#1E0B2A", texture: "swirl", accent: "#D9B45A" }
theme_customColorset: { name: "ivory", foreground: "#3B2414", background: "#E8DCC4", outline: "none", texture: "bone" }
```
They default to plastic; `material` (or `theme_material` for a stock colorset) picks another. The
finish applies to plastic; on glass only its iridescence carries over (see below). Each face shows a different part of the pattern, and the numbers are
painted over it, so they stay as crisp as on plain dice.

### Iridescence
`pearl` and `opal` have a thin-film iridescence: reflections pick up colours that shift with the
angle you see a face at, so the dice shimmer as they roll. It shows on plastic and on glass, where it
reads as a pearly sheen inside the glass that is clear of the numbers. A colorset's `iridescence`
(0 to 1) sets how strong it is, and adds it to plain plastic or glass too; 0 turns it off:
```
theme_customColorset: { name: "black pearl", foreground: "#ffffff", background: "#000000", outline: "#000000", accent: "#f250d4", texture: "pearl", material: "glass", glass_opacity: 0.6 }
theme_customColorset: { name: "black opal", foreground: "#ffffff", background: "#000000", outline: "#000000", texture: "opal", material: "glass", glass_opacity: 0.6 }
theme_customColorset: { name: "sapphire", foreground: "#ffffff", background: "#2A6FDB", outline: "#000000", material: "glass", glass_opacity: 0.6, iridescence: 0.8 }
```
On glass it costs one more environment lookup and thin-film evaluation per pixel, only for iridescent dice.

### Reflection environment
`environment` swaps the studio for a photo of a room, used only for reflections (and glass
refraction). It is never drawn as a background, so the canvas stays transparent:
```
environment: { url: "/img/room.jpg", intensity: 1, rotation: 0 }
```
- `url`: an equirectangular (2:1) panorama. JPEG or WebP is best for the web (a 1024x512 JPEG is
  about 30 to 80 KB); a `.hdr` also works but is much larger (about 1.5 MB at 1k). An LDR photo's
  near-white areas (lamps, windows) are stretched brighter so they light the dice like an HDR would.
- `intensity` scales the reflections, `rotation` spins the room around the vertical axis (radians).
- The image loads once, when a metal or glass colorset first needs it; `initialize()` (and
  `updateConfig()`) wait for it, so the first dice already reflect the room. If it fails to load the
  box falls back to the studio and logs a warning.
- Swap it at runtime, for example when a page toggles between a dark and a light theme:
  `await box.setEnvironment({ url: "/img/day.jpg" })` or `await box.updateConfig({ environment: "studio" })`.
  The cached materials switch over, the old environment is freed and the dice are drawn once.

### Metal
`metal` is polished (low roughness, fully metallic), `perfectmetal` is a mirror and `brushedmetal`
is satin with a directional sheen. The body colour tints the metal: a gold or silver background gives
gold or silver and dark brown gives copper. A dark grey or blue-grey body (for example `#3B444B`) stays
dark, for gunmetal, and black gives blackened steel. Numbers are painted on as matte,
non-metallic enamel so they stay readable against the reflections.

### Glass refraction
Glass bodies show the environment bent through them and filtered by the glass colour, lit from above as
if it bounced off the table, and shifting across each face like a lens. `glass_refraction: false` turns
it off (a flat tint, one environment lookup cheaper); `{ ior, strength, dispersion }` tunes it, and
`dispersion` (0.02 for `true`) adds coloured fringes towards the facet edges at two extra lookups. It
can be switched with `updateConfig({ glass_refraction })`.

### Result highlight
`highlightResult: true` makes the result stand out when a throw (or an `add()` or `reroll()`)
finishes: the number on the face that landed up glows in its own colour (a dark number gets a light
halo behind it), a soft additive glow sits over it, and the die pops, a quick 12% scale-up and settle
over 350 ms. `{ glow: false }` or
`{ pop: false }` turns either off; a number for `glow` sets its strength (default 1).

A glow is lost on dark numbers (dark ink on ivory or wood), so `style` picks how the number lights up:
- `"glow"`: the number glows in its own colour, as above (a dark number gets a light halo).
- `"ink"`: the number is repainted in a bright colour that glows, with a soft tint behind it.
- `"gilded"`: the number is repainted in antique gold and a shimmer sweeps across it once (800 ms).
- `"auto"` (the default): `"ink"` for dark numbers, `"glow"` for the rest.

`color` sets the ink or gold colour; otherwise a colorset's `highlight` key, then ember (`#F2743B`)
for ink and `#B8892E` for gilded:
```
highlightResult: { style: "gilded", color: "#C9962F" }
theme_customColorset: { name: "ivory", foreground: "#2B1D0E", background: "#E8DCC4", outline: "none", highlight: "#E0592A" }
``` Only how the dice
are drawn changes, never which face is up or the results, and nothing renders once the pop ends.

### Kept and dropped dice
After a roll resolves, mark which dice count, for example the lower die of an advantage roll:
```
const result = await box.roll("2d20@17,6")
box.markDice([{ index: 1, state: "dropped" }])   // or { index: 0, state: "kept" }
```
`index` is the die's `id` in the results: its place in throw order, counting on across `roll()` and
`add()` calls until the next `roll()` (the sets of one notation are merged by type, so read it from
`rolls[].id`). A dropped die has the number that landed up struck through and is dimmed and
desaturated, and it never gets the result highlight; kept and unmarked dice do, as before. `state:
null` clears a mark, and a reroll clears it too. Marks can also be set while the dice are still rolling
(call `markDice` right after `roll()` without awaiting it) so a dropped die never lights up. Results and
faces never change.

### Labels
A colorset's `outline` draws an outline round the numbers in that colour; `outline: "none"` (or
`false`) leaves it off.

### Number font
A colorset can pick the font its numbers are drawn in (Arial by default):
```
theme_customColorset: { name: "ivory", foreground: "#2B1D0E", background: "#E8DCC4", outline: "none", texture: "bone", font: "Cinzel, serif", fontWeight: 700 }
```
- `font`: a CSS font family list, as in the `font` shorthand (quote names that need it, for example
  `"'Roboto Slab', serif"`).
- `fontWeight`: optional, for example `800` or `"bold"`.
- `fontScale`: optional size factor (default 1).
- `fontOffset`: optional vertical nudge in font sizes, positive moves the numbers down (default 0).

The page includes the font, for example with a Google Fonts stylesheet:
```
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700&family=Nunito:wght@800&display=swap">
```
The box never fetches fonts itself. Labels are drawn once and cached, so `initialize()` and
`updateConfig()` wait for the face (`document.fonts.load()`, retried while a stylesheet is still
loading) before building any dice, and the first roll never shows a fallback. If it isn't available
within `fontTimeout` (3 s) the box logs a warning and draws that colorset with Arial; later calls only
check for it instead of waiting again. Installed fonts (`Georgia`) and generic families work as well.

Each font is measured once: its digits are scaled to the height of Arial's and centred where Arial's
sit, and a font much wider than Arial is shrunk to fit the die's widest label (two-digit faces get
less room than a lone digit), so most fonts need no tuning. `fontScale` and `fontOffset` adjust on
top. The font applies to every number, the d4 corners, the dot under 6 and 9, the strike through a
dropped die and the result highlights. Die types that bring their own font (pips, poker dice, the
symbol dice) keep it.

Fonts that read well at die size: Nunito 800 (rounded, the clearest), Roboto Slab 700 (sturdy slab),
Bricolage Grotesque 800 (chunky display) and Cinzel 700 (engraved serif, its 1 looks like a Roman I).
Thin faces and old-style figures (Marcellus) are hard to read on small dice, and a pixel font like
Silkscreen only reads at its regular weight, and best on the larger single-digit dice.

### Throw direction
`throwFrom: "any"` throws in a random direction from the edge opposite it. `"sides"` picks the left or
right wall at random for each throw: the dice come in from just inside it, somewhere in the middle of
its height, and travel mostly sideways fast enough to cross the box, bounce off the far wall and settle
near the middle. Each die starts in its own spot (further in from the wall, or higher, when many dice
don't fit), so dice never start inside each other. `"left"` and `"right"` always use that side.

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
