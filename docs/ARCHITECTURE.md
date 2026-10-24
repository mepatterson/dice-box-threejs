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
| `src/fonts.js` | Waits for a colorset's number font and measures it against Arial. |
| `src/shapes.js` | Shaped dice (`shape: { edges, dish }`): rounded or sharp edges and dished faces, drawn over the plain physics shape. |
| `src/surfaces.js` | Generates the procedural textures (bone, swirl, stone, pearl, opal, obsidian, sparkles, moss, growth) and the wood grain. |
| `src/fuzz.js` | Fur shells for fuzzy textures: the strand field, shell geometry and shell material. |
| `src/pixel.js` | The pixel render style: options, palettes, the bitmap font and label painting, the toon patch and the low-resolution pass. |
| `src/const/*` | Data: die definitions and vertex/face tables (`dice.js`), colorsets, textures, material presets, surfaces. |

## How a roll flows

`await box.roll("2d20@14,6")`:

1. **Parse.** `startClickThrow` picks a random throw vector and boost, then
   `getNotationVectors` runs `DiceNotation`, which splits the string at `@` into dice sets
   and forced results (`result: ["14", "6"]`). For every die it computes a start position on
   the edge of the box, a velocity, an angular velocity and a random orientation. Sets with
   the same type, operator and function are merged, so forced results follow set order, not
   the order the dice were written in.
2. **Create.** `roll` clears the old dice (unless `clear: false`), then `spawnThrow` asks
   `DiceFactory.create` for a mesh per die in its theme (see below) and gives it a cannon `Body` using
   the shape stored on the geometry, at its start state.
3. **Simulate.** `launch` runs `simulate`, which steps the cannon world synchronously, at a fixed
   `framerate` (1/60 s), until every new die sleeps or `iterationLimit` steps pass, recording every
   die's position and quaternion at every step. Before each step, a die that has fallen asleep has its
   face read (`storeRolledValue` via `getFaceValue`, which finds the face normal closest to straight up,
   or straight down for a d4) and turns kinematic with zero velocity, so it stays put and later dice
   bounce off it. Unless it is off flat (`unsettle`): more than 3 degrees from lying on a face of its
   physics shape (`tiltOf`), once it has been slow for `STUCK_TIME` (0.1 s) or has fallen asleep. Cannon
   counts a die as asleep once its speed stays under 75 for `settleTime`, which a die tipping slowly off
   an edge passes, and a die propped against a wall or a frozen die never gives way, so frozen there it
   rested cocked (0.7 to 2 of 10d6 per throw, 3.5 to 4 of 10d20, on the bench's heavy physics). `nudge` turns it
   towards its nearest face, hops it 0.15 radii and slides it away from the walls and dice it touches
   (the last step's contacts), at most `NUDGES` (4) times, and it settles again over `RESETTLE_TIME`
   (0.1 s); a die still cocked after that rests that way. Since no die freezes mid-tip any more, a shorter
   `settleTime` is safe and gives back the nudges' time.
   Collisions that would make a sound are recorded with their step, and with `onImpact`
   so are impacts (`scanImpacts`, after each step): every contact's approach speed along its normal
   from the velocities the solver saw, so a die tumbling onto a new face counts even though it never
   left the table; per step the hardest table or wall contact of each die and the hardest die-on-die
   contact of each pair, skipping those below `impact.min` or 1.5 times what gravity adds in a step, and
   repeats of one die within `impact.interval`.
4. **Relabel (the predetermined trick).** For every forced result that differs from the
   simulated face, `swapDiceFace` swaps which material (label texture) is drawn on the face
   that will end up on top and the face that carries the wanted number. Each face group of the
   geometry has a `materialIndex`; the mesh gets its own copy of the material array with the
   two entries swapped, and a `faceMap` that tells `getFaceValue` which label each face group
   now shows. Physics and the shared geometry are untouched. A d4 shows three numbers per
   face, so `swapDiceFace_D4` rotates every face by the difference and uses the label set
   rotated by the same amount (`DiceFactory.labelSet`, in the die's own theme and colour picks). The
   stored result is cleared so it is read again from the relabelled mesh.
5. **Play back.** The throw is queued with its recording and a start step `LEAD_STEPS` (2) ahead
   of the shared step clock (`clockStep`: `performance.now()` in fixed steps), so the simulation has
   normally finished by then. `frame`, the one `requestAnimationFrame` loop, puts every throw's meshes
   at the recorded pose for the current step, plays its sounds, hands `onImpact` the impacts due
   within `IMPACT_LEAD_MS` (`reportImpacts`, a cursor into the throw's recording), runs the pops, sweeps and twinkles, and
   renders only when something changed. Playback is the simulation itself, so the dice land exactly
   where the simulation read them; no second physics run has to repeat it.
6. **Results.** When a throw's last frame is reached its cleared faces are read again (they report the
   forced values), the callback builds the results (`rollResults`: sets, rolls, modifier, total, for
   the dice of that throw), highlights its dice, calls `onRollComplete`, dispatches a `rollComplete` DOM
   event and resolves the promise. The loop stops once nothing moves or pops.

`add("1d12@7")` runs the same steps for the new dice only, and `reroll` for dice woken on the table.
The dice already at rest are kinematic, so they act as obstacles.

**Concurrent throws.** A throw may start while others are still playing back. Its simulation starts
at its own start step; the dice of the other throws are kinematic bodies that `drive` puts at the pose
their recording has for that same step, with the velocity and spin that carry them to the next one, so
cannon resolves contacts against moving dice. The new dice bounce off them; they have infinite mass to
the solver and follow their recording whatever happens, so their results never change. Afterwards
their bodies go back to their final pose, where they rest once their playback ends. Interaction is one
way (a later die can be shoved by an earlier one, never the reverse), which reads naturally at the
speeds involved. The cost is one synchronous simulation per throw, with every die on the table in the
broadphase. Queueing throws instead would keep two-way contact but delay a second player's dice by a
whole throw (2 to 4 s); a single re-simulation of all moving dice would change faces already chosen.

## Geometry, textures and materials

- **Geometry** (`DiceFactory.createGeometry`): the vertex and face tables in
  `const/dice.js` are normalised, chamfered (`chamfer_geom`, which adds the bevel faces) and
  turned into a non-indexed `BufferGeometry` with flat normals, per-face UVs and one group
  per triangle. Numbered faces get `materialIndex` 1 or 2 and up; bevels get 0. The
  matching `CANNON.ConvexPolyhedron` (unchamfered) hangs off `geometry.cannon_shape`. A d2
  is a cylinder. Geometry is cached per die type.
- **Shapes** (`shapes.js`, `DiceFactory.geometryOf`): a throw's shape (its colorset's `shape`, else the
  box's) picks the geometry; the theme key leaves it out, so shapes share textures and materials. A shaped
  geometry is cached per die type and shape (`shaped`, the `SHAPED_CACHE` most recent; an evicted one still on
  the table is uploaded again when drawn) and takes its type's `cannon_shape`, so physics, settling and the
  face swap never change. `buildShaped` keeps each face's classic chamfered polygon and label corners (the
  table in `GEOM_PARAMS`). Rounding (`edges`) is the polyhedron shrunk by the rim and swept by a ball: with
  the shrink factor c, face k's polygon is `c * V + (1 - c) * centre_k`, exactly the classic chamfer, so the
  rounded surface between faces is the arc of those offsets from one face's direction to the next (strips
  along edges, barycentric patches at corners), with smooth normals along the offsets. `edges` sets the
  rounding radius in die radii (the same for every type, at most `BEVEL.most` of a face), and the label UVs
  are scaled about the label's middle so a smaller face keeps most of its number's size (not on a d4).
  Without `edges` the bevels and corners are the classic flat ones. A dish (`dish`, on `DISH_TYPES`) grids
  each fan triangle of a face and lowers it by a profile of a p-norm of the face's edge distances (a circle on
  a square, a rounded triangle on a d20) out to `DISH.extent`, normals from its slope, UVs interpolated from
  the classic corners so the label follows the dish. The geometry is indexed (vertices welded where position,
  normal and UV match) and has one group per face part plus one for every bevel and corner, so it draws in a
  few calls. Dice draw without depth testing, so each face's dish group comes before every flat group: a
  grazing view where a face's rim hides part of its dish draws the rim over it. `faceNormals` and `facePoints`
  hold each group's face plane, which `topFace` and the halo read instead of a triangle's normal.
- **Textures** (`createTextMaterial`): each face label is drawn to a 2D canvas (colour,
  optional texture image composited in, outlined text) plus a second canvas for the bump
  map. The layout is computed on the original square (512px for most dice) and drawn at
  `textureScale` of it. These become `CanvasTexture`s (sRGB for colour, linear for bump),
  cached by type, label, colours and finish (metal labels are always drawn at full resolution, since
  their number edges sit against sharp reflections). Both get the renderer's anisotropic filtering
  (at most 8x).
- **Number font** (`fonts.js`): a colorset's `font` (`fontOf`: family, weight, `fontScale`, `fontOffset`)
  is part of the texture cache key. `loadTheme` awaits `loadFont` before `applyColorSet`, so no label is
  drawn before the face is ready: `document.fonts.load()` for the digits, retried every 100 ms while it
  finds no face (a stylesheet still loading) unless the family is installed (it changes the width of a
  test string against two fallbacks), up to `fontTimeout`; then a warning and the default font, and later
  loads of that face only check. `fontAt` turns a size laid out for Arial into the font's size and a
  vertical shift from `fontMetrics`, measured once per font and widest label of the die type: the median
  digit's ink height matched to Arial's (old-style figures have ascenders and descenders), capped so the
  widest label is at most 1.3 times Arial's width (1.6 for single digits), and the digits' ink centred
  where Arial's is. The dot of a 6 or 9 is drawn at the digit's right edge, which for Arial is where the
  old `'  .'` put it. Die types whose definition sets a font (`ownFont`) keep it; variants are drawn with
  the font in `diceLabel`.
- **Themes** (`DiceFactory.useTheme`): each colorset, keyed by its content (`themeKey`, ignoring its
  name), gets a theme holding its own texture, material, highlight and accent-tint caches, plus its
  glass edge and refraction uniforms when the colorset sets them (otherwise the box's shared ones).
  `selectTheme` points the factory's flat colorset state and cache references at it before a die is
  built, and every material, label and die remembers its theme (`diceTheme`), so variants (glow,
  dim, strike, the d4 relabel) are drawn in the die's own theme. Geometry, programs, the procedural
  surfaces and the wood grain are shared by all themes. Themes live in a `Map` in least recently used
  order; after a throw spawns, `trimThemes` frees the oldest beyond `themeCache` that no die on the
  table uses (nor the box's own theme, nor one being preloaded), and the box forgets its resolved
  colorset. `resolveTheme` loads images, the font and the environment once per theme and caches the
  result, so throws in a ready theme start synchronously.
- **Materials** (`createMaterials`): one material per label slot, cached alongside its
  texture, so every d20 of one colorset shares the same materials. A colorset material of
  `none` (or `plastic`) or `wood` gives `MeshPhysicalMaterial` with a clear coat, `metal` and
  `perfectmetal` `MeshStandardMaterial`, `brushedmetal` and `glass` `MeshPhysicalMaterial`, with
  presets from `const/materialtypes.js`; an unknown material falls back to `MeshPhongMaterial`. A texture
  finish with no clear coat but a sheen (moss) keeps `MeshPhysicalMaterial`, since only it has sheen. Plastic
  and wood drop the environment's diffuse light (`dielectricShader`) so it only adds reflections.
  Wood with no texture overlays a procedural grain (`woodGrain`, generated once with its own random
  numbers so seeded throws repeat), turned and shifted per face, on the label and faintly on the bump. An image
  texture's bump is drawn at 40% (full strength on metal, where it is the paint mask). All materials are
  transparent with depth testing off, which is fine for convex dice drawn back to front.
- **Procedural textures** (`surfaces.js`, `drawSurface`): a texture with a `surface` name is generated the first
  time a label needs it, at 512px with its own seeded value noise, and kept per box (`surfaces`, freed in
  `dispose()`). It is a few alpha masks, each with a colour (fixed, or `accent`: the colorset's `accent` or the
  body colour lightened, or `spectrum`), plus an optional height field. Fixed colours are baked into their masks; accent masks are tinted once per colour
  (`surface_tints`), then drawn into the label canvas over the body colour, turned and shifted per face like
  the wood grain; the height goes faintly into the bump canvas (not on metal, where that canvas is the paint mask; glass has no bump). The numbers are drawn
  last on both canvases, so no grain shows under them. Nothing new reaches the GPU: the pattern lives in the
  label textures the dice already have. On glass the masks are drawn at half strength (or the layer's or surface's `glass`
  strength; opal's, sparkles' and obsidian's flecks are full), so they read as partly opaque inclusions. A layer with `hue` also keeps its alpha and a hue field
  (0 to 1, wrapping), and a `spectrum` layer (or pearl's sheets with the colorset's `rainbow`) is coloured per pixel
  by `spectrumLayer` through a 256-entry lookup: OKLCH at the layer's lightness and chroma, so every hue is equally
  light, along `PLAY` (mostly blue, green and violet, as in opal and abalone, no yellow-green), or within 70 degrees of
  a coloured accent's OKLCH hue. The body sets a tone: pale bodies get softer, thinner colour, near-black opaque ones
  lighter, fuller colour. An accent layer can name a `fallback` colour for colorsets without an accent
  (obsidian's pale silver), or a `shade`: a fixed colour it moves to the accent (`shade` in surfaces.js, OKLCH
  lightness shifted, chroma scaled and hue turned by what takes `MOSS_GREEN` to the accent, chroma cut to fit
  the gamut). Growth is moss's generator with each green as such a layer; its texture entry has `shades`, so
  `DiceFactory.shaded` also moves its finish's `sheenColor` and its fuzz `color` and `tip`. With no accent it
  shades to moss green, which gives moss back. A surface with a `glint` canvas (obsidian, sparkles) marks its flecks in the bump
  canvas (red 1, green the fleck's tilt direction, blue 1 minus its glint, so red minus blue is the glint, zero on
  the white background and the black numbers, and the red bump height is untouched); on plastic and glass
  `addGlint` gives the material that canvas as `glintMap` and `glintShader` (run before the glass patch) turns each
  fleck into a tilted mirror. It always has a steady sheen that follows the face's light. Its glint (a blurred
  environment lookup in its reflected direction, past a threshold so only bright parts of the room count, plus two
  wide key-light lobes, capped) is scaled by `glint_state`, one uniform shared by every glinting material: x is 0
  while any throw is rolling, so tumbling flecks never flicker between frames, and y drives a slow
  per-fleck twinkle. When dice settle `highlightDice` asks the render loop (`popDice`) for `TWINKLE_MS` if any die on
  the table glints, fading x in and advancing y, then nothing renders. Sheen and glint are the fleck's colour a
  quarter of the way to white, so accent flecks gleam in the accent. Sparkle chips are hexagons with soft edges,
  sized so they stay several pixels across and survive mipmapping; the dust under them doesn't glint. Glass adds it to its reflections
  (`DICE_GLINT`), plastic to its light; glass otherwise leaves that canvas unused, so a glinting glass label uploads
  one more texture. Metal is skipped, since its bump canvas is the paint mask. These are cached in `surface_tints` like the accent tints, keyed by accent and tone. A texture's
  `finish` (roughness, clear coat, iridescence, sheen) is merged into the plastic preset (`materialPreset`); glass
  takes only its iridescence, and a colorset's `iridescence` (0 to 1) sets or adds it on plastic and glass.
- **Fuzz** (`fuzz.js`, `DiceFactory.addFuzz`): a texture with a `fuzz` entry gets, per label, a fuzz map
  (`drawFuzz`, half the label's size, one channel): the surface's fuzz field turned and shifted like its colours,
  multiplied by the bump canvas so the numbers and strike bars are bare. Not on glass. Each die with a fuzz map
  gets an `InstancedMesh` child of up to `MAX_SHELLS` instances (one shared identity `instanceMatrix`), on
  `shellGeometry`: the die geometry's own buffers, its consecutive groups of one material slot merged (a classic
  die's group per triangle becomes one per face), plus `fuzzDir`, the area-weighted normal of all triangles at
  each position (so the shells stay closed over edges) with the die radius in w. The vertex shader pushes
  shell `gl_InstanceID` out by `(i + 1) / shells` of the length, plus a sideways sway growing with the square
  of the height. The fragment shader reads a tiling 3D strand field (`strandField`, 48³ RG8: distance to the
  nearest jittered strand centre and that strand's random length) at the die's object-space position, so
  strands turn with the die and run across faces, and the fuzz map at the label UV (with a coarse mip to keep
  strands back from the numbers); it discards outside the strand, with a soft pixel of edge (`fwidth`) and a
  softer tip. The shells' `material` is a getter over the die's own array (`shellMaterials`, cached per array in
  a `WeakMap`; one Lambert shell material per label material in the theme's `variants`, keyed by its map and
  fuzz map and whether it is dimmed), so a face swap, the glow and a dropped die's dimming carry over; slots
  without a fuzz map get an invisible material. Shells depth-test and write depth (the dice don't), so their
  layers and neighbouring faces sort among themselves, and they draw right after their die (higher id, same
  depth). The shell count is one uniform (`fuzz_state`): `DiceBox.updateFuzz`, run from `scene.onBeforeRender`,
  shares the device's budget (`FUZZ_BUDGETS`) over the fuzzy dice on the table; each shell mesh sets its
  instance count in `onBeforeRender`. Shells cast no shadow and are never part of the physics.
- **Glass**: face backgrounds are drawn at `glass_opacity` alpha while labels stay opaque. The body
  opacity is a uniform (`glassOpacity`, behind the `GLASS_OPACITY` define), so glass of every opacity
  shares programs. Each
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
  uniform (`DiceFactory.setGlassEdges`), so it changes live without recompiling; back faces (`GLASS_INTERIOR`) are darker.
  Iridescent glass (`USE_IRIDESCENCE`) gets a thin-film shimmer added to the reflections after the faint ones are cut
  (which would drop three's own film term): `evalIridescence` for the domed normal, with the film thickening from
  the middle of the die to its rim, mostly its hue (`GLASS_FILM` saturation), lit by a blurred reflection of the room
  with a floor so it shows in a dark room, stronger at grazing angles and kept off the numbers. The paint mask is
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
- **Bump canvases** upload as one channel (`RedFormat`, a quarter of the bytes): the bump height and
  the metal paint mask only need red. Labels with glitter flecks keep RGBA, since the flecks' glint and
  tilt live in the other channels. Glass without flecks never samples that canvas, so it gets no texture.
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
  The pop scales the meshes (lifted so they stay on the table) from the render loop (`animatePops`); the
  bodies are kinematic and untouched, other throws keep popping while a new one rolls, and nothing renders
  after it. The highlight options are the throw's own (`highlightResult` per throw) or the box's.
- **Kept and dropped dice** (`markDice`): marks live on the meshes (`mesh.mark`). Settled dice are
  redrawn at once; dice still rolling get theirs in `highlightDice` when they settle, which strikes
  dropped dice (`dropResult`) and highlights and pops the rest. `dropResult` swaps every material
  for a dimmed, desaturated clone (`dimShader`, after the metal patch so the metal floor doesn't
  undo it, plus `DICE_DIM` for glass) that shares its textures, and the up face's label for one drawn
  with a bar through the number (also on the bump canvas, so it is paint on metal). Both are cached in
  `variant_cache` and freed in `dispose()`. Variants are drawn with the state the label was made with
  (`diceLabel`), not whatever colorset is current.
- **Throw direction** (`throwFrom`): `"any"` keeps the original random vector. `"sides"` (or
  `"left"`/`"right"`) throws from one side wall at a speed from the box width and gravity, so the dice
  cross the box on any screen size. `sideStarts` lays the dice out behind the wall, starting at the
  canvas edge: lanes across the throw's path (a band up to 80% of the box height) and rows behind each
  other, cells at least 2.2 radii apart so cannon never starts with two dice inside each other. Dice in
  front go fastest (each die's speed drops with its row rank, by up to 40% at `spread` 1, plus a little
  noise), each heads up to about 10 degrees away from the middle lane, and each starts at its own height,
  high enough to still be in the air when it is all the way in. So they come in one after another and
  fan out; started as one block at one speed (the old layout, just inside the wall), the dice crossed the
  box in the air and hit the far wall together, and on a narrow box bounced back to pile up by the entry
  wall. `spread` scales all of it. Each die's mask leaves out the entry wall's collision group (every
  plane has its own) until `passWall` sees it fully inside; until then it keeps at least the inward
  speed that gets it in sliding or before it comes down, so a die knocked back by another still comes
  in, and after `ENTRY_STEPS` the wall is back regardless. `arc` adds `lift`, an upward speed for a hop
  of `HOP_HEIGHT` (2) radii at 1, on a throw at its usual speed. Under the table's gravity a hop hung in
  the air (half a second and more at arc 0.5, whatever the gravity, while lofted dice crept along at a
  third of their speed to come down mid-table): at the sizes dice are drawn, gravity of 480 is about
  40 die radii per second squared, a fifteenth of what real dice fall. So the dice of a lofted throw fall
  at `airGravity` while they touch nothing (`pullDown` adds the difference as a force before each step,
  for dice that had no contact in the last one, until a die first slows to settle, since a resting die
  can lose its contacts for a step): `HOP_GRAVITY` (250) radii per second squared, or the table's if
  stronger, from arc 0.25 up and scaled down below it. Sliding, tumbling and settling are
  under the table's gravity as before. A lofted die is in the air about 0.25 s, at full speed, and lands
  hard; it may reach the far wall first.
  Both paths only use `Math.random`, so seeded runs repeat.
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
- **Pixel style** (`pixel.js`, a colorset's `pixel`, kept on its theme): every render goes through `draw()`.
  Pixel dice (and their children) are put on `PIXEL_LAYER`; the lights see every layer and the table is on
  both. Without pixel dice it is one plain render. With them, the classic dice render first as usual (their
  shadows only, since shadow casters follow the camera's layers), then the camera sees only `PIXEL_LAYER` and
  `PixelPass` renders it into a low-resolution sRGB target with a depth texture, at `pixelScale` (canvas
  pixels per pixel, rounded, so a die of `baseScale` is about `size` pixels across). The projection is widened
  so the target covers whole blocks from the canvas's bottom left corner, a fixed grid. Pixel materials write
  depth with a depth test that always passes (`pixelate`), so they still draw back to front while the depth
  texture marks the dice's silhouette; the table writes none. The post pass (one fragment per low pixel)
  unpremultiplies, snaps to the merged palettes of the pixel themes on the table (`pixelPalette`, OKLab,
  dithering between the two nearest with a 4x4 Bayer threshold), steps glass alpha, dithers empty pixels'
  shadow alpha, and draws the outline on empty pixels beside the silhouette. Settled dice's stamps
  (`stampResult`: the result upright in the bitmap font, the up face swapped for a variant without its
  number, `bareMaterial`) are drawn into that image as quads one texel per pixel at the up face's projected
  point, then the image is drawn over the canvas, `scale` x `scale` blocks with premultiplied blending.
  `pixelShader` patches the lighting chunks: banded `dotNL`, specular and clear coat in quarter steps. Pixel
  labels (`createPixelLabel`) are the body and texture shrunk to `labelTexels` texels (one per pixel of a die
  face up at the theme's size), drawn back up at `PIXEL_UNIT` canvas pixels per texel, with the numbers
  painted turned at that resolution; no bump, glint or fuzz map (unless `pixel.fuzz`). The first label's body
  colours (`sampleColors`) feed the palette. A pixel die dims by darkening only. Choppy pixel themes (`fps`)
  make `frame` draw at most that often while anything changes, and once more at the end. Pixel programs
  compile against the target (`preloadTheme` sets it), since a render target's programs differ from the
  canvas's.
- There is no idle render loop. Frames are rendered only while a throw plays back or pops, plus a
  single render after setup, resize, clear and remove. `clearDice({fade})` fades the canvas
  with CSS, so a fade-out renders nothing.
- Lights use three's physical units (r155+): decay 0 and intensities scaled from
  `light_intensity` so the look matches the old r143 renders; output is sRGB.
- The physics world uses gravity of `-9.8 * gravity_multiplier` on z, the naive broadphase,
  14 solver iterations and sleeping (dice sleep after `settleTime`, 0.9 s by default, below speed 75,
  and freeze only lying flat or once their nudges are used up; see Simulate). The animation is
  the recorded simulation, so forced results line up without relying on cannon repeating itself.
