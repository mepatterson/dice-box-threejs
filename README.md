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
	theme_texture: "", // "bone" | "swirl" | "stone" | "pearl" | "opal" | "obsidian" | "sparkles" | "moss" | "growth", or an image texture from https://github.com/3d-dice/dice-box-threejs/blob/main/src/const/texturelist.js
	theme_material: "glass", // "none" | "metal" | "wood" | "glass" | "plastic"
	gravity_multiplier: 400, // gravity is 9.8 times this; updateConfig changes it for the throws that follow
	light_intensity: 0.7,
	baseScale: 100,
	strength: 1, // toss strength of dice
	restitution: { desk: 0.5, wall: 1.0, dice: 0.5 }, // bounce off the table, the walls and other dice
	friction: 0.6,
	damping: 0.1, // speed lost in the air; higher settles sooner
	settleTime: 0.9, // seconds a die must stay slow before it counts as settled (a die off flat is nudged flat first)
	maxPixelRatio: 2, // caps devicePixelRatio; 3x phones render at 2x
	rollingPixelRatio: null, // e.g. 1 to render moving dice at 1x and the settled dice at full ratio
	textureScale: 0.5, // label texture resolution relative to the original 512px faces (metal always uses full resolution)
	glass_opacity: 0.35, // how much of what's behind a glass die its body hides, 0 to 1
	glass_refraction: true, // false | { ior: 1.5, strength: 1, dispersion: 0.02 }: the room seen through glass
	glass_edges: 0.35, // 0 to 1: how much glass bevels stand out
	environment: "room", // "studio", a URL, or { url, intensity: 1, rotation: 0 }; what metal, glass and clear coats reflect
	sparkles: "auto", // inner sparkles per glass die that asks for them: by device, a number, or false. See Inner sparkles
	fontTimeout: 3000, // ms to wait for a colorset's number font before falling back to the default
	highlightResult: false, // true | { glow: true | number, pop: true }: light up the result when dice settle
	throwFrom: "any", // "sides" | "left" | "right": where dice come in from
	spread: 1, // 0 to 1: how much the dice of one side throw differ in where they come in, speed and heading
	arc: 0, // 0 to 1: how high dice hop as they are thrown; 0 low along the table, 1 a hop of about two radii
	shape: null, // { edges, dish }: sharp to worn edges and concave faces; a colorset's own shape wins. See Shapes
	fuzz: "auto", // fur shells on fuzzy textures (moss, growth): "auto" by device, a number of shells per die, or false. See Fuzz
	preloadDice: null, // e.g. ["d20", "d6"] to build textures and compile shaders in initialize()
	themeCache: 8, // themes (colorsets) kept ready beyond those on the table; see Several players on one table
	onRollComplete: () => {},
	onImpact: null, // ({ speed, die, x, at }) => {}: each collision as the throw plays back; see Impacts
	impact: { min: 120, full: 2400, interval: 0.06 }, // which collisions onImpact reports, and how loud
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
Metal, glass, plastic and wood reflect a room environment the box generates once, the first time a
colorset needs it (see Reflection environment).

### Plastic and wood
Plastic (`none`, or `plastic`) is glossy acrylic: a clear coat with faint reflections that get stronger
towards the edges. Stock colorsets keep their colours; they gain that gloss and their sides read a
little darker than the old fully matte finish. Wood without a texture gets a wood grain drawn in its
body colour and a satin varnish, so it is told apart from plastic at a glance.

### Neon and bloom
`material: "neon"` is dark glossy acrylic (the body colour at a fifth) whose edges and numbers are tubes of
light in the colorset's `accent` (or the number colour): emissive, with a white-hot core in each number and
a soft halo round it, so they glow on any page without any light. The result highlight burns a neon number
brighter instead of drawing a second glow over it.

A colorset's `bloom` (a strength, 1 the usual; 0 or left out for none) makes what glows on its dice bloom:
lava's cracks, neon tubes, and on other textures the result glow. Only those dice are drawn again, writing
nothing but their own glow, into a small half-float target that three's `UnrealBloomPass` blurs, and the
blur is laid over the canvas as premultiplied light whose opacity is its brightness (at most 0.65, so a
number under its glow stays crisp). Over the page it reads as glow in its own colour, with no dark fringe
and no box. Pixel dice never bloom.
```
theme_customColorset: { name: "hyper", foreground: "#ffffff", background: "#1a1030", outline: "none", material: "neon", accent: "#ff2bd6", bloom: 1 }
```
The box's `bloom` option sets what it costs: `"auto"` (the default) draws it at half the canvas's resolution on
a desktop, 0.4 on a tablet and 0.3 on a phone, and while dice roll with bloom it lowers that by 40% each time
30 frames run at a median over 34 ms, down to 0.12 of the canvas, then turns bloom off for the box (and says
so in the console). A number (0 to 1) sets the share and never adapts; `false` leaves bloom off.

### Procedural textures
Eight textures are generated in code instead of loaded from `public/textures`, so they need no asset
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
- `moss`: moss on rock. Soft cushions of moss in deep, mid and bright yellow-green, thicker in the
  hollows of a mottled rock in the body colour and thinner on its high spots, with fuzzy edges, damp
  green-stained rock round them and fine shadows between the stems. A matte finish with a faint sheen,
  and a bump that raises the moss over the rock. Its fuzz grows real strands that stand off the die's
  edges (see Fuzz). Grey, slate and brown bodies make good rock; light numbers read best.
- `growth`: moss in the colorset's `accent`. The same cushions, rock, bump, finish and fuzz as moss,
  with every green moved to the accent in OKLCH: the accent stands in for moss's light green on top of
  the cushions, and the deep base, mid tone, bright tips, damp stain, shadows, sheen and strands keep
  the lightness steps, chroma ratios and hue turns they have from it in moss. So `accent: "#6f9a34"` (or
  no accent) is moss, a red accent grows red moss, and a grey one grey. Nothing keeps the colours
  readable against the body or the numbers; a very light or very dark accent pushes the ramp to white
  or black.
- `lava`: dark rock with molten cracks that glow and flow, after three.js's lava shader example. The
  body colour is darkened into a mottled basalt crust, and two textures drawn in code scroll against each
  other over it: where they line up the rock melts into cracks and pools in the colorset's `accent` (ember
  without one), white-hot where it runs hottest. The cracks are emissive, so they glow without light. They
  flow while the dice tumble and keep flowing at 30 fps once they settle, like inner sparkles, and hold
  still under `prefers-reduced-motion`. The numbers stay rock; light numbers read best.
- `leather`: pebble-grained leather in the body colour. A soft, uneven dyed tone is drawn into the label
  and the grain is a normal map drawn in code (rounded pebbles of a cellular noise with creases between
  them), tiled finer than the label, darker and rougher in the creases, flat under the numbers. A satin
  finish with a faint sheen. `stitching: true` (on any procedural texture, made for leather) sews a seam
  just inside every numbered face's edges in the `accent` (or a lighter body colour).
```
theme_customColorset: { name: "satchel", foreground: "#F4E6C8", background: "#6b3a1e", outline: "none", texture: "leather", accent: "#e8c27a", stitching: true }
```
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
Metal, glass, clear coats and the glass refraction reflect an environment the box builds once in
code, the first time a colorset needs it. It is never drawn as a background, so the canvas stays
transparent. `environment` picks it:
- `"room"` (the default): three's procedural `RoomEnvironment` (a lit room with a few boxes), stood up
  and tipped for this scene (so a die lying flat reflects a wall, not the ceiling light, and its number
  stays readable) with a few soft light panels hung in it, so metal reads as satin with crisp highlights
  on tilted facets and glass stays clear. `{ url: "room", intensity: 1.4 }` scales it (0 to 2 is a
  sensible range: dull to bright) and `rotation` turns it.
- `"studio"`: the older dark studio, a low band of light and a few panels, with harder contrast.
- a photo of a room:
```
environment: { url: "/img/room.jpg", intensity: 1, rotation: 0 }
```
- `url`: an equirectangular (2:1) panorama. JPEG or WebP is best for the web (a 1024x512 JPEG is
  about 30 to 80 KB); a `.hdr` also works but is much larger (about 1.5 MB at 1k). An LDR photo's
  near-white areas (lamps, windows) are stretched brighter so they light the dice like an HDR would.
- `intensity` scales the reflections, `rotation` spins the room around the vertical axis (radians).
- The image loads once, when a metal or glass colorset first needs it; `initialize()` (and
  `updateConfig()`) wait for it, so the first dice already reflect the room. If it fails to load the
  box falls back to the room and logs a warning.
- Swap it at runtime, for example when a page toggles between a dark and a light theme:
  `await box.setEnvironment({ url: "/img/day.jpg" })` or `await box.updateConfig({ environment: "room" })`.
  The cached materials switch over, the old environment is freed and the dice are drawn once.

### Metal
`metal` is polished (low roughness, fully metallic), `perfectmetal` is a mirror and `brushedmetal`
is satin with a directional sheen. The body colour tints the metal: a gold or silver background gives
gold or silver and dark brown gives copper. A dark grey or blue-grey body (for example `#3B444B`) stays
dark, for gunmetal, and black gives blackened steel. Numbers are painted on as matte,
non-metallic enamel so they stay readable against the reflections.

A metal colorset's `grain` gives the metal a surface, drawn in code as a tiling normal map:
```
theme_customColorset: { name: "pewter", foreground: "#1B2A41", background: "#C8D1DC", outline: "none", material: "metal", grain: "hammered" }
```
- `brushed`: fine parallel streaks, the roughness streaky with them.
- `hammered`: overlapping shallow dents with ridges where they meet.
- `worn`: soft dents, a few scratches and small pits, rougher in the pits.

The grain is flattened under the numbers, so they stay crisp. The three maps are 256px, made once per
box and shared by every theme. The pixel style leaves them out.

### Coats
`coat` gives a clear coat its own normal map, separate from whatever bump the surface has under it:
```
theme_customColorset: { name: "candy", foreground: "#FFFFFF", background: "#8B1E3F", outline: "#2a0a14", coat: "flake" }
```
- `scratched`: fine hairline scratches, most along two directions.
- `flake`: metallic flake, tiny facets each tilted its own way, so the coat glints in scattered points.
- `weave`: a carbon-fibre weave of round tows.

Plastic and wood have a clear coat already; a metal, glass or matte texture (moss) gets a light one
(`clearcoat` 0.6) when a coat is picked. On glass the coat's reflections join the glass's own. The pixel
style leaves coats out.

### Inner sparkles
A glass colorset's `inner` fills the die with a cloud of soft sparkles, drawn in code as point sprites inside
the die's own shape, in `inner_color` or else the accent (white, or ember for embers, without one):
```
theme_customColorset: { name: "snow globe", foreground: "#1B3A2A", background: "#8FD3C0", outline: "none", material: "glass", glass_opacity: 0.5, inner: "snow", inner_color: "#FFFFFF" }
```
- `snow` sinks slowly, swaying, as seen from inside the tumbling die: down is the world's down.
- `galaxy` is a thin disc of dust that turns about the die's own axis, faster near the middle.
- `embers` rise, glowing warm.

Each sparkle twinkles a little, and they keep drifting after the dice settle (at 30 frames a second, so a
table with sparkling glass on it keeps rendering until it is cleared). Under `prefers-reduced-motion` they
hold still but still show. `sparkles` sets how many per die: `"auto"` by device (260 on a desktop, 180 on a
tablet, 110 on a phone), a number, or `false` for none. The cloud is one small geometry per die type (a few
shared layouts), an additive draw per die; the dice's physics never see it.

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
- `"white"`: ink in plain white, whatever the colorset's `highlight` or `color` says.
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

### Several players on one table
One box (one canvas, one WebGL context) can show everybody's dice, each player's in their own
colorset, with throws that start while others are still rolling:
```
const alice = { name: "alice", foreground: "#ffffff", background: "#2A6FDB", outline: "#000000", material: "glass", glass_opacity: 0.6 }
const bram = { name: "bram", foreground: "#3B2414", background: "#E8DCC4", outline: "none", texture: "bone", font: "Georgia, serif" }

await box.preloadTheme(alice)                    // optional, e.g. when a player joins
box.roll("1d20@17", { colorset: alice, clear: false })
box.roll("2d6@3,5", { colorset: bram, clear: false, throwFrom: "left" })
box.add("1d8@6", { colorset: alice })            // add() never clears the table
box.roll("4d6", { colorset: [alice, bram, "fire", alice] })   // one colorset per die, in order
```
- `colorset` takes a custom colorset (as `theme_customColorset`), a stock colorset name (resolved like
  `theme_colorset`, with the box's `theme_texture` and `theme_material`) or an array of them, used per die
  in throw order and cycled (sets of one notation are merged by type, so the order is the merged one).
  Without it a throw uses the box's theme. Dice keep their look until they leave the table, whatever later
  throws or `updateConfig` use.
- Everything a colorset sets applies per die: colours, material, texture, `accent`, `rainbow`, `font`,
  `iridescence`, `glass_opacity`, and two keys that are otherwise box-wide, `glass_edges` and
  `glass_refraction` (a colorset without them follows the box's, live).
- `clear: false` keeps the dice on the table and the throws still rolling, and resolves with the results of
  this throw only (`sets`, `total`, and each die's `id` for `markDice`, `reroll` and `remove`). The default
  (`clear: true`) clears the table first, as before; throws it cuts short never resolve.
- `throwFrom`, `spread`, `arc`, `highlightResult` and `onImpact` can be given per throw too. The rest stays box-wide: the environment,
  lights and shadows (glass shadows follow the box's theme), pixel ratio, `textureScale`, sounds and
  physics. The glitter twinkle and gilded sweep are shared: flecks hold still while any die is rolling.
- `preloadTheme(colorset, types = ["d20"])` loads the colorset's images and font, draws and uploads the
  label textures of those die types and compiles any new shaders, so the player's first throw starts as
  fast as any other. A throw whose colorset isn't ready yet starts after it is (`roll()` and `add()` stay
  synchronous for ready colorsets, so `markDice` can follow them at once).
- Two colorsets with the same keys (apart from `name`) are the same theme.

Throws run at the same time without disturbing each other's results: each throw is simulated to the end
when it starts, with the dice of throws still rolling moving along their own recorded paths, so the new
dice bounce off them but never push them. Forced results are exact for every throw. A throw costs one
synchronous simulation when it starts (10 to 80 ms for two dice in the bench, more with many dice on the
table), during which the dice already rolling hold their frame.

**Memory.** Each theme has its own label textures: at the default size about 8 MB for a d20 on glass,
10 MB on plastic or wood and 38 MB on metal (drawn at full resolution). The box keeps
the `themeCache` least recently used themes (8 by default) and frees the others once none of their dice
are on the table, so texture memory stays flat however many colorsets come and go; themes with dice on
the table are always kept. Programs are shared between colorsets of the same material, so a new colorset
rarely compiles a shader. A page that keeps every throw on the table holds every theme, so remove old
throws (`remove(ids)`) or clear the table now and then. For many players on phones, `textureScale: 0.35`
or a lower `themeCache` cuts texture memory further.

### Impacts
For an app that plays its own sounds (Web Audio, its own recordings), `onImpact` is called for each
collision of a throw as its playback reaches it, without loading or playing the library's sounds
(`sounds` stays off unless you turn it on):
```
const box = new DiceBox("#dice-box", {
  onImpact: ({ speed, die, x, at }) => playClick({ volume: speed, clack: die, pan: x * 2 - 1, delay: at }),
})
```
- `speed`: 0 to 1, the impact velocity along the contact normal (so a die sliding or rolling on the
  table is quiet and a drop is loud), linear from 0 to `impact.full` world units per second.
- `die`: `true` when two dice hit each other (reported once, not once per die), `false` for the table
  or a wall.
- `x`: where on the screen it happened, 0 (left edge) to 1 (right edge), for panning.
- `at`: seconds from the call until the frame showing the impact is due, 0 to about 0.04. Impacts are
  reported a little ahead so a sound can be scheduled on time (`AudioBufferSourceNode.start(currentTime + at)`).

Every throw is simulated to rest before it plays, so its collisions are recorded with their step during
the simulation and reported from the playback loop, throw by throw; concurrent throws and per-throw
colorsets each report their own, and a cleared throw reports nothing more. Every contact of every step
counts, not only a pair's first touch, so a die tumbling onto a new face while it still touches the
table is an impact too. Contacts slower than `impact.min` are never recorded, nor slower than 1.5 times
the speed gravity adds in one step (what a resting die's contacts approach at, so resting jitter and a
die settling on a face stay quiet), and a die reports at most one table or wall impact and one
die-on-die impact per `impact.interval` seconds. A 1d20 throw reports about 8 impacts, 2d20 about 20
and 10d6 about 90 (the bench's `--impacts`). An impact due more than a quarter second before its frame
ran (a hidden tab, a long stall) is dropped instead of reported late. Nothing is recorded, and nothing
is allocated per frame, without `onImpact`; with it, the simulation costs a little more (under 1 ms
for 10d6 in the bench) and each impact is one small object made during the simulation and handed over
as is (copy it to keep it). The
listener can be set or cleared with `updateConfig({ onImpact })`, and `impact` the same way. A throw
can bring its own listener, which replaces the box's for that throw only, for example to play another
player's dice a little quieter:
```
box.roll("2d6@3,5", { colorset: bram, clear: false, onImpact: hit => playClick({ volume: hit.speed * 0.6 }) })
```

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
right wall at random for each throw, and `"left"` and `"right"` always use that side. A side throw comes
in over that wall from the edge of the canvas like a thrown handful: each die starts in its own spot
behind the wall (in lanes across the throw's path and rows behind each other, so dice never start inside
each other), the front ones fastest, each heading a little away from the middle and starting at its own
height. So the dice come in one after another, string out and fan out as they cross the box, instead of
landing as one block and reaching the far wall together, where they piled up. They travel mostly sideways,
fast enough to cross the box on any screen size.

- `spread` (0 to 1, default 1) scales those differences. 0 sends the dice in as one block: same depth,
  height, speed and heading.
- `arc` (0 to 1, default 0) tosses the dice up as they are thrown, at the same speed: a quick hop of about
  two die radii at 1, in the air for about a quarter of a second, landing hard. In the air a lofted die
  falls faster than the table's gravity (which is weak for the size the dice are drawn at, so a hop under
  it floats), and it may reach the far wall before it lands. Seen from above it swells slightly at the
  top of its hop and its shadow separates from it.

Both can be set per throw: `box.roll("5d6", { throwFrom: "sides", arc: 0.5 })`. The entry wall lets each
die of a side throw pass until it is all the way in.

### Shapes
`shape: { edges, dish }` changes how the dice are drawn, never how they move: each die keeps the
physics shape of the plain polyhedron, so throws, settling and forced results are the same in every shape.

- `edges` (0 to 1) rounds the edges and corners: 0 is a sharp, casino-style hairline, 1 rounded and worn
  like an old resin or stone die (the same rounding for every die type, at most 30% of a face). Left out,
  dice keep the library's classic flat bevel.
- `dish` (0 to 1) hollows each face of a d6, d8, d12 and d20 into a shallow dish inside a flat rim, the
  rim the die rests on, as on dice with concave faces. The number follows the dish down. A d4 (numbers
  in its corners) and a d10 (kite faces) stay flat.

Set it for the box, or per colorset, which also makes it per throw:
```
box.roll("2d20", { colorset: { foreground: "#ffffff", background: "#7d7d7d", material: "metal", shape: { edges: 0 } } })
```
A colorset's shape doesn't make it a new theme: colorsets that differ only in shape share their textures
and materials. Shaped geometry is built the first time a shape and die type is used and cached (the 24
most recent), 4 to 130 KB of vertices and indices per die type; a shaped die draws in one call per face (two with a dish)
plus one for its edges, against one per triangle for a classic die. The highlight, kept and dropped
marks, glass and metal all work on every shape. `node bench/run.mjs --shapes` draws contact sheets of
every die type in each shape.

### Fuzz
A texture with a `fuzz` entry (moss and growth have one) grows short strands that stand off the die's silhouette,
since a bump map can only shade inside it. The die is drawn a few more times as fur shells, each pushed a
little further out, keeping only the pixels inside a strand; the strands thin and lighten towards their
tips. They grow where the surface's fuzz field says (moss: thick where its cushions are thick, none on bare
rock) and never over the numbers, and run on unbroken over edges and corners. The shells are a child of
each die, so they follow it and its pop and never touch the physics; the highlight and the dropped look
carry over to them.

`fuzz: "auto"` picks how many shells by device and shares a budget across the fuzzy dice on the table:
up to 16 per die on a desktop (160 in all), 12 on a tablet (96), 8 on a phone (60), never fewer than 6, 5
and 5. Longer fur (`growth` above 1) gets up to twice the shells on a desktop and one and a half times on a
tablet, so it doesn't read as stacked slices, and counts that much more against the budget; a phone keeps
its count.

A moss or growth colorset's `growth` (0 to 2, 1 when left out) turns up how much of the rock the moss
covers and how long its fur grows, together: 0 is bare stone, 1 the usual look and 2 overgrown, every face
covered in fur twice as long. Past 1.5 the fur starts to grow over the numbers too.
```
theme_customColorset: { name: "overgrown", foreground: "#F4EBD0", background: "#5A5A55", outline: "#1A1A16", texture: "moss", growth: 1.8 }
``` A number caps the shells per die; `false` leaves the fuzz to the bump map. `updateConfig({ fuzz })`
changes it for the dice that follow. A texture's own entry tunes the strands:
```
fuzz: { shells: 16, length: 0.12, density: 36, thickness: 0.55, lean: 0.3, taper: 0.7, fade: 0.7, root: 1, color: '#4a7326', tint: 0.5, tip: '#d4e48a', tipMix: 0.4 }
```
`length` is in die radii, `density` strands per radius, `thickness` a strand's width at its root (in strand
spacings), `lean` how far tips sway sideways, `taper` how much a strand narrows, `fade` how soft its tip is,
`root` how dark its root, `tint` how far strands lean from the label's colour to `color`, `tipMix` how far
the tips lighten to `tip`. Shells cost one more draw call per face (their runs of groups are merged) and
the fragments of each shell; glass never grows fuzz.

### Pixel style
A colorset with `pixel` draws its dice as chunky pixel art. They tumble with the same physics and land on
the same faces; only how they are drawn changes.
```javascript
box.roll("1d20+2d6", { colorset: { foreground: "#ffe0c0", background: "#b8321c", outline: "#2a0a04", texture: "swirl", pixel: true } })
// every option, with its default
pixel: { size: 40, palette: "auto", dither: 0.35, bands: 3, outline: "auto", fps: 0, fuzz: false }
```
- **Low resolution.** Pixel dice render into a target at a fraction of the canvas, so a die of `baseScale`
  is about `size` pixels across, and it is drawn over the canvas with nearest filtering. The grid is fixed
  to the canvas's corner, so it never shimmers as dice move.
- **Palette.** A post pass snaps every pixel to a palette, with ordered (4x4 Bayer) dithering between the
  two nearest colours; `dither` 0 picks the nearest colour only. `"auto"` builds the palette from the
  colorset's colours and the colours its labels show (median cut), each with a short ramp of shades, plus
  a near black and white. A list of CSS colours is used as given (up to 64), a number n is n levels per
  channel (at most 4), and `false` keeps the rendered colours. Result stamps keep their own colours, unless
  the palette is a list. Glass is dithered
  into a few steps of opacity and shadows into a dithered dark.
- **Flat shading.** Direct light falls in `bands` steps (0 for smooth) and highlights are flat spots in a
  few levels, so each face reads as one facet. Metal, glass, wood and the textures keep their own materials.
- **Pixel numbers and outline.** Labels are drawn small in a bitmap font (3x5, or 5x7 on bigger faces) and
  sampled with nearest filtering. `outline` draws a one pixel outline around the dice: `"auto"` a dark
  shade of the pixel beside it, a CSS colour, or `false`.
- **The result.** A die turned at any angle can't keep a one pixel number crisp, so when pixel dice settle
  the result is stamped upright over the up face (whose own number is left off), one font pixel per pixel:
  in the highlight colour with a dark ring when `highlightResult` is on, a dropped die's struck through
  and dimmed, otherwise in the number's own colours.
- **Choppy motion.** `fps` (4 to 30, 12 is "on twos") redraws at that rate while the dice move; the
  playback still runs at full rate and the last pose always shows.
- **Fuzz.** Fur shells are off in the pixel style (at this size they only roughen the outline); `fuzz: true`
  keeps them.

Pixel and classic dice share a table: the classic ones draw at full resolution and the pixel ones over
them, each with their own shadows. A table without pixel dice draws exactly as before.

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
materials, so clearing frees nothing per die and memory stays flat across rolls (themes beyond
`themeCache` are freed as new ones arrive); `dispose()` frees the caches. Call it when the element goes away (for example on a page navigation), since browsers
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
node bench/run.mjs --multi   # themes in rotation: texture bytes, programs, crowd frame times, first-throw latency
node bench/run.mjs main=path/to/old.es.js branch=dist/dice-box-threejs.es.js --profiles=phone,laptop
node bench/run.mjs --impacts         # what onImpact reports per throw size, concurrent throws, audio made
node bench/run.mjs --on-impact       # the profiles with an onImpact listener attached
node bench/run.mjs --spread          # where side throws of 2, 5 and 10 dice land, crowd and rest, how long they are aloft and how far off flat they rest (heavy dice unless --physics=default)
node bench/run.mjs --physics=heavy   # any mode with heavier, quicker-settling dice and soft walls
node bench/run.mjs --spread --shots --browser=webkit   # contact sheets of side throws at phone and tablet sizes
node bench/run.mjs --shapes --browser=webkit --dpr=2   # contact sheets of every die type in each shape, glass, metal and stone (--each for single rows)
```
The bench needs Chrome installed. It renders with SwiftShader (software GL), so frame times are
only meaningful relative to another build. See `docs/ARCHITECTURE.md` for how a roll works.

Built on three.js r186 (sRGB output, physically based light units) and cannon-es 0.20.

## Notes
In order to use textures or sounds, you will need to manually copy the assets out of the `./public` folder and into your static assets folder where you're building your app.
