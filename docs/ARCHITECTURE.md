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
   that will end up on top and the face that carries the wanted number. The geometry's face
   groups carry a `materialIndex`, so swapping those indices, or the materials they point at,
   moves the labels without touching physics. A d4 shows three numbers per face, so
   `swapDiceFace_D4` rotates every face index and swaps in the label set rotated by the
   same amount.
6. **Animate.** `animateThrow` runs on `requestAnimationFrame`, steps the world as many
   fixed steps as wall-clock time allows, copies body positions and quaternions to the
   meshes, renders, and checks `throwFinished`. Faces are read again on the relabelled
   meshes, so the results report the forced values.
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
  map. These become `CanvasTexture`s, cached by type, label and colours.
- **Materials** (`createMaterials`): one material per label slot. A colorset material of
  `none` gives `MeshPhongMaterial`, anything else gives `MeshStandardMaterial` with a
  preset from `const/materialtypes.js`. All are transparent with depth testing off,
  which is fine for convex dice drawn back to front.
- **Colours** (`DiceColors`): a colorset names foreground, background, outline, an optional
  texture and an optional material. Arrays pick a random entry per die. A custom colorset
  takes its material from `theme_customColorset.material` (or the texture's material);
  `theme_material` only applies to stock colorsets.

## Scene, render and physics loops

- `setDimensions` builds the camera (20 degree FOV, looking straight down), a spotlight
  that casts the shadows, a hemisphere light, and an invisible `ShadowMaterial` plane as the
  table. It runs on `initialize` and on debounced window resizes.
- `makeWorldBox` creates the static cannon planes: the floor and four walls at 93% of the
  container size.
- There is no idle render loop. Frames are rendered only while a throw animates, plus a
  single render after setup, resize, clear and remove.
- The physics world uses gravity of `-9.8 * gravity_multiplier` on z, the naive broadphase,
  14 solver iterations and sleeping (dice sleep after 0.9 s below speed 75). The synchronous
  simulation and the animated replay use the same fixed step, which is what makes the
  forced results line up.
