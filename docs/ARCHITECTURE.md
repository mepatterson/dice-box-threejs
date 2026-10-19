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
  cached by type, label and colours.
- **Materials** (`createMaterials`): one material per label slot, cached alongside its
  texture, so every d20 of one colorset shares the same materials. A colorset material of
  `none` gives `MeshPhongMaterial`, anything else gives `MeshStandardMaterial` with a
  preset from `const/materialtypes.js`. All are transparent with depth testing off,
  which is fine for convex dice drawn back to front.
- Nothing is created per die except the mesh, its material array and its cannon body, so
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
  the walls at 93% of the half-extent. During a throw a resize is held back until the dice
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
