# Architecture

dice-box-threejs is a small library (about 3,800 lines, half of it data tables) that
throws 3D dice with three.js for rendering and cannon-es for physics, and can make any
die land on a value chosen in advance.

## Files

| File | Role |
| --- | --- |
| `src/index.js` | Default export of `DiceBox`. |
| `src/DiceBox.js` | The public class: renderer, scene, camera, lights, physics world, roll lifecycle, results. |
| `src/DiceFactory.js` | Builds die meshes: geometry (chamfered polyhedra), cannon shapes, canvas textures and materials. |
| `src/DiceNotation.js` | Parses `2d20+1d6+3@14,6,2` into sets, an optional constant and forced results. |
| `src/DicePreset.js` | One die type (labels, values, mass, inertia, scale) built from `const/dice.js`. |
| `src/DiceColors.js` | Resolves a colorset (stock or custom) and loads its texture images. |
| `src/surfaces.js` | Generates the procedural textures (bone, swirl, stone, pearl, obsidian) and the wood grain. |
| `src/const/*` | Data: die definitions and vertex/face tables (`dice.js`), colorsets, textures, material presets, surfaces. |

## How a roll flows

`await box.roll("2d20@14,6")`:

1. **Parse.** `startClickThrow` picks a random throw vector and boost, then
   `getNotationVectors` runs `DiceNotation`, which splits the string at `@` into dice sets
   and forced results (`result: ["14", "6"]`). For every die it computes a start position on
   the edge of the box, a velocity, an angular velocity and a random orientation. Sets with
   the same type, operator and function are merged, so forced results follow set order, not
   the order the dice were written in.
2. **Create.** `rollDice` clears the old dice, then `spawnDice` asks `DiceFactory.create`
   for a mesh per die and gives it a cannon `Body` using the shape stored on the geometry.
3. **Simulate.** `simulateThrow` steps the cannon world synchronously, at a fixed
   `framerate` (1/60 s), until every die sleeps or `iterationLimit` steps pass. `throwFinished`
   is checked before every step: as dice fall asleep their face is read (`storeRolledValue`
   via `getFaceValue`, which finds the face normal closest to straight up, or straight down
   for a d4) and they turn kinematic.
4. **Rewind.** `spawnDice(vector, mesh)` replaces each body with a fresh one at the same
   start state. cannon-es is deterministic for identical inputs, so replaying the same
   steps lands each die on the same face.
5. **Relabel (the predetermined trick).** For every forced result that differs from the
   simulated face, `swapDiceFace` swaps which material (label texture) is drawn on the face
   that will end up on top and the face that carries the wanted number. Each face group of the
   geometry has a `materialIndex`; the mesh gets its own copy of the material array with the
   two entries swapped, and a `faceMap` that tells `getFaceValue` which label each face group
   now shows. Physics and the shared geometry are untouched. A d4 shows three numbers per
   face, so `swapDiceFace_D4` rotates every face by the difference and uses the label set
   rotated by the same amount. The stored result is cleared so the replay reads the forced
   value.
6. **Animate.** `animateThrow` runs on `requestAnimationFrame`, steps the world as many
   fixed steps as wall-clock time allows (at most 60 frames a second), copies body positions
   and quaternions to the meshes and renders. `throwFinished` runs before every step, exactly
   as in the simulation, so dice freeze on the same step and land on the same face. Faces are
   read again on the relabelled meshes, so the results report the forced values.
7. **Results.** When everything sleeps the callback builds the results object
   (`getDiceResults`: sets, rolls, modifier, total), calls `onRollComplete`, dispatches a
   `rollComplete` DOM event and resolves the promise. `animateAfterThrow` renders one more
   frame and the loop stops.

`add("1d12@7")` runs the same steps for the new dice only. The dice already on the table
are kinematic, so they act as obstacles in both the simulation and the replay. `reroll`
and `remove` act on existing dice by id.

## Geometry, textures and materials

- **Geometry** (`DiceFactory.createGeometry`): the vertex and face tables in
  `const/dice.js` are normalised, chamfered (`chamfer_geom`, which adds the bevel faces) and
  turned into a non-indexed `BufferGeometry` with flat normals, per-face UVs and one group
  per triangle. Numbered faces get `materialIndex` 1 or 2 and up; bevels get 0. The
  matching `CANNON.ConvexPolyhedron` (unchamfered) hangs off `geometry.cannon_shape`. A d2
  is a cylinder. Geometry is cached per die type.
- **Textures** (`createTextMaterial`): each face label is drawn to a 2D canvas (colour,
  optional texture image composited in, outlined text) plus a second canvas for the bump
  map. The layout is computed on the original square (512px for most dice) and drawn at
  `textureScale` of it. These become `CanvasTexture`s (sRGB for colour, linear for bump),
  cached by type, label, colours and finish (metal labels are always drawn at full resolution, since
  their number edges sit against sharp reflections). Both get the renderer's anisotropic filtering
  (at most 8x).
- **Materials** (`createMaterials`): one material per label slot, cached alongside its
  texture, so every d20 of one colorset shares the same materials. A colorset material of
  `none` (or `plastic`) or `wood` gives `MeshPhysicalMaterial` with a clear coat, `metal` and
  `perfectmetal` `MeshStandardMaterial`, `brushedmetal` and `glass` `MeshPhysicalMaterial`, with
  presets from `const/materialtypes.js`; an unknown material falls back to `MeshPhongMaterial`. Plastic
  and wood drop the environment's diffuse light (`dielectricShader`) so it only adds reflections.
  Wood with no texture overlays a procedural grain (`woodGrain`, generated once with its own random
  numbers so seeded throws repeat), turned and shifted per face, on the label and faintly on the bump. An image
  texture's bump is drawn at 40% (full strength on metal, where it is the paint mask). All materials are
  transparent with depth testing off, which is fine for convex dice drawn back to front.
- **Procedural textures** (`surfaces.js`, `drawSurface`): a texture with a `surface` name is generated the first
  time a label needs it, at 512px with its own seeded value noise, and kept per box (`surfaces`, freed in
  `dispose()`). It is a few alpha masks, each with a colour (fixed, or `accent`: the colorset's `accent` or the
  body colour lightened), plus an optional height field. Fixed colours are baked into their masks; accent masks are tinted once per colour
  (`surface_tints`), then drawn into the label canvas over the body colour, turned and shifted per face like
  the wood grain; the height goes faintly into the bump canvas (not on metal, where that canvas is the paint mask; glass has no bump). The numbers are drawn
  last on both canvases, so no grain shows under them. Nothing new reaches the GPU: the pattern lives in the
  label textures the dice already have. On glass the masks are drawn at half strength, so they read as
  partly opaque inclusions. A texture's `finish` (roughness, clear coat, iridescence, sheen) is merged into the
  plastic preset.
- **Glass**: face backgrounds are drawn at `glass_opacity` alpha while labels stay opaque. Each
  die gets a child mesh with one shared `BackSide` material for its back faces. It is created
  before the die, so its lower id sorts it first at the same depth: per die, back faces then
  front faces, and neither pass overlaps itself on a convex die. `glassShader` (an
  `onBeforeCompile` patch) writes premultiplied colour so reflections are added on top of what
  shows through instead of fading with the alpha, and makes a pixel as opaque as its brightest
  reflection (so highlights hold over the page). Reflections are three's dielectric ones (no clear
  coat, F0 0.04), untinted, with faint ones cut and strong ones kept; faces count as slightly domed
  for two analytic glints, kept small and soft and capped below white (`1 - exp`) so neither covers a face. The body is the environment seen through the die (`glassSeen`: refracted,
  bent further by the pixel's offset from the die centre, which the vertex shader passes as
  `vGlassOffset`, and folded upwards as if bounced off the table) filtered by the glass colour over a
  depth that grows from the middle of the die to its rim and on faces turned away; that depth also
  raises the alpha, so the middle is clear and the rim deep. Bevels (`GLASS_EDGE`) are thicker
  glass: a deeper filter of the body colour, a little more opaque, and their grazing reflections
  tinted by the body colour except the bright ones (lamps, windows), which stay white as a thin rim.
  `glass_edges` scales the whitening, brightness, opacity and reflection strength through one shared
  uniform (`DiceFactory.setGlassEdges`), so it changes live without recompiling; back faces (`GLASS_INTERIOR`) are darker. The paint mask is
  the label alpha above the body's (`GLASS_OPACITY`), used linearly. Glass shadows are lighter.
- **Environment** (`DiceBox.makeEnvironment`): a PMREM built once, when a colorset first needs
  it, and freed in `dispose()`. The default (`makeStudio`) is a small dark studio (a low band of
  light and a few soft panels). With `environment: {url}` it is an equirectangular photo instead:
  `.hdr` goes through `HDRLoader`; an LDR image is drawn to a canvas and turned into a half-float
  texture with its near-white pixels scaled up (`HIGHLIGHT_GAIN`), so lamps and windows act as light
  sources. Photos are y-up, so their materials get an `envMapRotation` that stands them up in this
  z-up scene, plus the option's azimuth. A failed load falls back to the studio. It is never the
  scene background. Materials whose preset has an `envMapIntensity` (all but unknown ones) reflect it and
  remember that preset value (`envBase`); `setEnvironment` builds the new PMREM, points every cached
  material at it (`DiceFactory.setEnvironment`), frees the old one and renders once.
- **Metal** (`metalShader`, an `onBeforeCompile` patch on `metal`, `perfectmetal` and
  `brushedmetal`): fully metallic, so the body colour is the reflection tint; a dark body has its
  brightest channel lifted to `METAL_FLOOR` (dark brown reads as copper), or, the closer the body is to
  neutral, only to `METAL_DARK_FLOOR`, so grey, blue-grey and black stay dark gunmetal. The
  label's bump canvas (white with black numbers) is also its `metalnessMap`, which the patch reads
  as a paint mask: numbers are matte and non-metallic. The mask is used close to linearly and metal
  has no bump map, since a bump or a hard threshold at the number edges mirrored stray bits of the
  room as sparkles. `brushedmetal` is a `MeshPhysicalMaterial` with anisotropy.
- **Glass refraction** (`glass_refraction`, on by default): toggles the `GLASS_REFRACTION` define on
  the cached glass materials, which makes `glassShader` sample the environment for the body (one
  lookup, three with `dispersion`, which also spreads the lens bend per channel so facet edges get
  coloured fringes). One shared uniform holds IOR, strength and dispersion.
- **Result highlight** (`highlightResult`): when a throw, `add()` or `reroll()` finishes,
  `highlightDice` swaps the label material on the face that landed up (`DiceFactory.topFace`, the
  same lookup `getFaceValue` uses; on a d4 the three faces showing the result) for a variant with an
  emissive map of just the number haloed in its colour, cached per material in `glow_cache` and
  freed in `dispose()`, and adds a `Sprite` child just above the up face (on a d4, over the top
  corner): additive, with one shared radial-gradient texture and a material per colour
  (`halo_cache`), so it is one extra draw per die and costs no per-die GPU memory. With `style` ink or
  gilded (auto picks ink when `glowColor` finds the number dark) the variant also gets the label redrawn
  with the number in the fill colour (not on a d4, where the emissive number alone recolours it), the
  emissive map is drawn in that colour, and the halo is a normally blended tint, since an additive one
  vanishes on a light body. Gilded adds `gildMaterial`, an `onBeforeCompile` patch that brightens a
  diagonal band of the emissive map at `gild_sweep`, one uniform shared by every gilded material; the pop
  loop runs it across once (`SWEEP_MS`) and parks it. Their redrawn labels are freed with the cache. The mesh keeps its
  unlit array in `baseMaterial`, restored (and the sprite removed) before a reroll.
  The pop scales the meshes (lifted so they stay on the table) on its own short `requestAnimationFrame`
  loop; the bodies are kinematic and untouched, a new throw ends it, and nothing renders after it.
- **Kept and dropped dice** (`markDice`): marks live on the meshes (`mesh.mark`). Settled dice are
  redrawn at once; dice still rolling get theirs in `highlightDice` when they settle, which strikes
  dropped dice (`dropResult`) and highlights and pops the rest. `dropResult` swaps every material
  for a dimmed, desaturated clone (`dimShader`, after the metal patch so the metal floor doesn't
  undo it, plus `DICE_DIM` for glass) that shares its textures, and the up face's label for one drawn
  with a bar through the number (also on the bump canvas, so it is paint on metal). Both are cached in
  `variant_cache` and freed in `dispose()`. Variants are drawn with the state the label was made with
  (`diceLabel`), not whatever colorset is current.
- **Throw direction** (`throwFrom`): `"any"` keeps the original random vector. `"sides"` (or
  `"left"`/`"right"`) spawns each die just inside one side wall in the middle 60% of its height and
  sends it mostly sideways (|vy| at most 0.35 |vx|) at a speed from the box width and gravity, so it
  crosses the box on any screen size. `sideSlots` gives each die its own cell 2.2 radii apart (the band
  grows, then columns step in from the wall, then layers stack higher when the dice don't fit), so
  cannon never starts with two dice deep inside each other. Both paths only use `Math.random`, so
  seeded runs repeat.
- Nothing is created per die except the mesh (and a glass die's interior mesh, and a highlighted
  die's halo sprite), its material array and its cannon body, so
  `clearDice` has nothing to free; `dispose()` frees the caches and the renderer.
- **Colours** (`DiceColors`): a colorset names foreground, background, outline, an optional
  texture and an optional material. Arrays pick a random entry per die. A custom colorset
  takes its material from `theme_customColorset.material` (or the texture's material);
  `theme_material` only applies to stock colorsets.

## Scene, render and physics loops

- `setDimensions` creates, once, the camera (20 degree FOV, looking straight down), a
  spotlight that casts the shadows, a hemisphere light, and an invisible `ShadowMaterial`
  plane as the table, then updates them to the container size. The canvas is transparent,
  so only dice and shadows cover the page. It runs on `initialize` and on debounced window
  and container (`ResizeObserver`) resizes. The pixel ratio is `devicePixelRatio` capped at
  `maxPixelRatio`, and `rollingPixelRatio` while dice move if set.
- World units are half a CSS pixel: the camera height is set so the visible half-height in
  world units equals the container's height in CSS pixels.
- `makeWorldBox` creates the static cannon planes once (the floor and four walls) and puts
  the walls at 93% of the half-extent, or further in on short boxes where perspective would
  push the top of a die resting against a wall past the canvas edge. Dice spawn just inside them. During a throw a resize is held back until the dice
  settle, then the walls move and resting dice outside them slide back in.
- There is no idle render loop. Frames are rendered only while a throw animates, plus a
  single render after setup, resize, clear and remove. `clearDice({fade})` fades the canvas
  with CSS, so a fade-out renders nothing.
- Lights use three's physical units (r155+): decay 0 and intensities scaled from
  `light_intensity` so the look matches the old r143 renders; output is sRGB.
- The physics world uses gravity of `-9.8 * gravity_multiplier` on z, the naive broadphase,
  14 solver iterations and sleeping (dice sleep after 0.9 s below speed 75). The synchronous
  simulation and the animated replay use the same fixed step, which is what makes the
  forced results line up.
