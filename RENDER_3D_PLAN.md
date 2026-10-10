# RENDER_3D_PLAN.md

The plan for moving the board's graphics from the 2D Pixi renderer to a real 3D
scene, still seen from above.

Status: **BUILT**, all ten steps in one pass, and the 3D board is the default
renderer on `dev`. The plan below is kept as written, with the places the build
departed from it marked **[CHANGED]** and the reason given, the convention of
the other plan docs.

The one thing NOT done is the thing that needs hardware: step 0's measurement
on a named low-end Android phone. This sandbox has only a software GPU, so the
gate was replaced by guards that act on the device itself (the quality
governor and the fallback chain, step 8) and the owner's test on a phone is the
open item. See "What is still open" at the end.

Departures, in order of how much they changed the shape:

1. **The 2D layers were not ported; they became the 3D board's paint.** The
   plan ported sleek's layers to three one by one, bottom up. Instead, sleek
   draws the board's flat marks (ground, lattice, areas, props, the tops of
   walls and slabs, trails, pocket fills) into ONE surface texture, under a
   flat light, and every 3D surface samples it at its own world (x, y). The 3D
   side adds height, lights and shadows; how anything LOOKS still comes from
   the 2D layers. Step 6's long tail therefore collapsed: every kind of object
   the 2D board draws is on the 3D board on day one, and the checklist test
   it called for is not needed because nothing can be missing.
2. **Pixi composites the frame, not three.** three renders into a texture that
   sleek shows as a sprite under everything that sits on top. That is what kept
   the sweep, the shatter and the first-frame capture working with no changes
   (step 7's "re-point the transitions" was free). Textures cross between the
   two libraries in both directions on the shared context
   (`three/textureBridge.ts`), which the PixiJS guide does not cover.
3. **The lamp is the key light, not the monitor.** On nearly every map a ball
   holds the lamp (`lampBall.ts`), so the monitor is a fallback, not the light
   the board is usually lit by. The lamp is a shadowed point light over its
   ball; the monitor yields to it, and stops rendering its own shadow map
   while it does.
4. **Pools are lit, not painted, with two departures from physics.** See
   section 3, Lighting.
5. **Walls stand 1.4x their authored height by default.** Open question 3:
   under real lights the authored 13 units throws shadows too short to read.

---

What was asked for: much better light and shadows; fences with real height that
the balls roll against; balls that visibly roll; and shadows that are correct
for several light sources at once, explosions included.

---

## 1. Where the board is today

- **The renderer.** It is `SleekRenderer` (`src/lib/rendering/sleek/`), on
  PixiJS 8. It is about 16,500 lines in roughly 30 layers, sitting behind the
  8-member `BoardRenderer` contract (`rendering/boardRenderer.ts`). Its
  fallback, used when WebGL fails, is `fallbackBoard.ts`, a flat Canvas-2D
  board.
- **The lighting is hand-faked, and that is the ceiling.** Every shadow is a
  2D quad thrown by `shadowFor()` from one fixed slab height
  (`SLAB_HEIGHT_WORLD = 13`). Other passes fake further effects:
  - a wall's lit side is a rim stroke;
  - `faceLightLayer` shades the faces walls point at;
  - `bounceLayer` fakes bounce light;
  - `ballLightPass` builds occluded pools of ball light in a half-resolution
    RenderTexture.

  That last pass admits its own limit: a correct multi-light scene needs one
  pass per light, so it interleaves them, and ball A's shadow can eat ball B's
  light. Each new kind of light (lock flashes, impacts, the derived lights) has
  meant another bespoke approximation. Explosions would mean one more.
- **Balls are lamps with no rotation.** A ball is a baked bulb sprite with a
  corona (`ballLayer.ts`, "NO ROTATION"), so it cannot show that it is rolling.
- **What makes the move cheap, and must not change:**
  - Gameplay is a 2D, fixed-step simulation at 120 Hz in a 900x900 world. It
    is deterministic because Pair Programming lockstep depends on it.
  - The renderer only reads `CanvasGameState`. It never writes to it.
  - The world-to-screen mapping is affine and sits in two places: `w2s` in the
    renderer and `screenToWorld` for input.
  - The board's on-screen rect is latched (`boardLayoutLatch.ts`) and input is
    mapped against it.

**Decision: this is a rendering migration only. Physics stays 2D.** A 3D
physics engine (Rapier, cannon-es) would bring nothing the game needs and
would put lockstep determinism at risk. Height, rolling and lighting are all
worked out by the renderer from the 2D state it already receives.

## 2. Library options

| Option | What it is | Fit for this game | Verdict |
|---|---|---|---|
| **three.js** (WebGLRenderer, WebGL2) | The standard JS 3D library. Imperative scene graph, shadow maps for point, spot and directional lights, PBR materials, `onBeforeCompile` for custom shading, a large ecosystem. | Very good. It is imperative like the game loop. Tree-shaken, the part this game would use is small (measured in step 0). PixiJS 8 has an **official guide for sharing one WebGL context with three.js**, which makes a gradual, layer-by-layer port possible (section 4). | **Recommended** |
| three.js with WebGPURenderer and TSL | three's newer renderer. Shaders are written in TSL and it falls back to WebGL2 by itself. | Where three is heading, but sharing a context with Pixi needs a plain GL context, and WebGPU in Android WebView is not something to rely on yet. | Later. Write custom shading so it can move to TSL. |
| **Babylon.js** | A full engine: cascaded and PCSS shadows, GPU particles, an inspector, WebGPU. | The best shadow and FX tooling out of the box. The cost is size: forum reports of 2-5 MB unpacked even with tree-shaking. We just cut the first screen from 10.4 s to 3.9 s on 3G by saving 1.3 MB. | Strong runner-up if three's shadows prove too much hand work |
| **PlayCanvas engine** | A mobile-first engine with **clustered lighting**: many omni and spot lights, *with shadows*, from one shadow atlas. | It solves "many shadowed lights" most directly. But it is engine-shaped (entity/component, its own loop) and does not share a context with Pixi, so it would be a single big-bang rewrite. | Worth a spike only if the light count grows a lot |
| **React Three Fiber** (+ drei) | A React renderer for three.js. | The board is deliberately **not** React (ARCHITECTURE.md). R3F would put a reconciler between a 120 Hz loop and the GPU for no gain. | No |
| **Stay on Pixi, add 2.5D shaders** | Normal and height maps, with heightfield-traced shadows in Pixi filters. | Gets perhaps 70% of the lighting with no new dependency. But a rolling sphere, real wall faces and debris are all 3D problems faked in 2D, which is the treadmill the current lighting is already on. | The fallback if step 0 fails its budget |

Supporting libraries, only where they earn it:

- **`postprocessing`** (pmndrs): bloom, tone mapping and SMAA in one merged
  pass. It is cheaper on a phone than three's chain of `EffectComposer`
  passes.
- **A particle library** (for example `three.quarks`): only if hand-written
  instanced particles fall short in step 7.
- **Text:** none. Labels stay in the Pixi overlay (section 4).

## 3. The target scene

### Camera: the floor maps exactly as it does today

The camera is a **perspective camera looking straight down**, with a narrow
field of view (about 20-30 degrees). It uses an off-axis projection
(`setViewOffset`) so that the floor plane fills `boardRect` exactly.

**[CHANGED]** The off-axis frustum is written directly (`three/floorCamera.ts`,
26 degrees by default) rather than through `setViewOffset`, which is defined
against a full frame the board does not have. A test pins every floor point to
`boardRect` across surfaces and fields of view. Balls are the one raised thing
that does NOT lean: each sphere is nudged toward the eye by its own parallax,
so it sits under the 2D corona and rings drawn round it.

A plane parallel to the image plane projects affinely. So for the floor:

- `computeBoardRect`, the layout latch and `screenToWorld` stay
  **unchanged**;
- a tap lands on the same world point it does today.

Only things standing above the floor show parallax. A 13-unit wall at the edge
of the board leans out by 2 to 4 world units, depending on the field of view.
That is just enough to see a sliver of the wall's side, which is what makes a
fence read as a fence from above. The field of view gets an Admin knob.

A strictly orthographic camera was considered and rejected. Seen exactly from
above, a raised wall looks the same as a painted stripe: lighting would be the
only depth cue, which is the problem today.

### Geometry

- **Floor.** One plane. Its material samples the bakes GameCanvas already
  makes: the captured/live region canvas, coloured areas and the board grid,
  all as `CanvasTexture`s. `markStaticDirty()` keeps its meaning: re-upload.
  Captured ground could sit a hair lower or carry a different finish, which
  makes "locked away" physical.

  **[CHANGED]** GameCanvas no longer makes those bakes (sleek draws the board
  from the space grid), so the floor samples the surface texture instead
  (departure 1). The visible outline, triangulated, translucent over the page
  like the 2D surface. Captured ground has no separate finish yet.
- **Fences and walls.** Each segment is extruded into a bevelled prism and
  merged into one `BufferGeometry` per fence type. The merged mesh is rebuilt
  when a cut lands; the fence in flight is a separate small dynamic mesh.

  **[CHANGED]** One instanced box per straight run instead (`three/walls3d.ts`):
  one draw call for every wall, frame and growing cut, re-laid each frame for
  the cost of a few hundred matrices. No per-type material: a fence's top shows
  what the 2D wall layer painted for it, type colour included. The impact
  bulge splits a run into short blocks, sampled in world space like the 2D one.
  No bevel.
  - Breakable dents (today carved into the 2D hull) become notches in the
    extrusion.
  - The outer frame becomes a real bevelled rim.
  - Heights come from one table, which replaces `SLAB_HEIGHT_WORLD`. Fences
    can now differ in height, so a guardrail could be taller than a standard
    fence.
- **Balls.** Instanced spheres. The squash effects (`getSquishEffect`,
  `getWallHitEffect`) become a non-uniform scale along the impact normal,
  which is what the 2D squash was imitating.

  **[CHANGED]** One mesh per ball (a handful on any map, each with its own
  colour and glow), squashed and flight-stretched by a matrix built from the
  same functions the 2D body uses (`three/balls3d.ts`). A Bug Squash melt stays
  2D: the sphere hides and the 2D liquid shows.
- **Obstacles, props, chests and destructibles.** Extruded polygon slabs with
  real heights. Rubble and debris become small rigid chunks. They are animated
  by the existing render-side debris state, not by a physics engine.

  **[CHANGED]** Props stay flat marks on the floor. Obstacles, breakables,
  mirrors, deformables, bumpers (lower), movers (taller), launcher shells and
  phasing pillars (sinking as they fade) are one merged mesh, rebuilt only when
  a fingerprint of every footprint changes (`three/solids3d.ts`). Portals are
  never solid. Dents come from the same bulge the 2D hull uses.

### Rolling

Rolling is purely cosmetic and lives entirely in the renderer. Each frame,
from the interpolated position delta `d` and radius `r`:

- the ball turns about the axis `up x d` by the angle `|d| / r`;
- that rotation is accumulated into a quaternion kept in a renderer-side
  `WeakMap<Ball, Quaternion>`, the same pattern as the existing `Lag` state.

It never touches the simulation, so lockstep is unaffected.

**[CHANGED]** Kept in a `Map` keyed by ball id, the same key the sphere pool
uses, and dropped with the sphere when its ball leaves the board.

**This changes the lamp design, and it is a design decision for the user, not
a technical one.** A ball with a centred bulb has nothing on it to show it
turning. The proposal: keep the emissive body (so the ball is still the
brightest, easiest thing to track, which is why it became a lamp), and etch a
darker pattern into it that rolls with the ball. Seams or circuit traces suit
the theme, with each ball type's look coming from `ballLook.ts`. The etching
must stay subtle enough that a ball at speed does not shimmer.

**Decided:** the etched lamp. A seam winding round the ball like a tennis
ball's and six vias, darker than the glow, antialiased with `fwidth`. The 2D
corona over it is drawn at 0.55 strength under the 3D board, or it washes the
seam out.

**[CHANGED]** The thin seam read as movement but barely, so the shell became a
lampshade (`three/balls3d.ts`, `shell`):

- **Big shapes, one per type.** Seven patterns (seam, stripe, bands, quarters,
  panels, dimples, plain), each type's set by `pattern:` in `balls.yml`, so
  types can also be told apart without colour.
- **Light held back, not paint.** The pattern decides how much of the light
  inside gets through, and the body sits just under the output curve's knee
  so the ribs keep their contrast instead of being flattened into one colour.
- **A glint that holds still** toward the key light (the lamp, else the
  monitor) while the pattern turns under it.
- **No strobing.** The pattern fades out as the turn per presented frame
  passes half a radian, and on a ball under about 5 pixels of radius.
- **A halo, not a disc.** The 2D corona under the 3D board starts at the
  ball's edge (`bulb.haloStops`), so nothing lands on the patterned face.

The Playground has a slider for pattern depth and one for the glint, and a
picker that forces one pattern on every ball for comparing.

### Lighting

Today's rules carry over unchanged. They become geometry instead of
convention:

1. **The monitor is the key light.** It is one shadow-casting light placed past
   the bottom-right corner **in camera space**, not board space. So map
   rotation and board tilt turn the board under a light that stays put, as
   `light.ts` already insists.
2. **Balls are lamps.** Each ball is an emissive sphere plus a point light at
   its centre, and the ball is excluded as a caster of its own light. The lamp
   still fills in its own monitor shadow (today's `SELF_LIT_SHADOW`).
3. **Transient lights use the same light type, with an envelope:** lock
   flashes, impacts, the derived lights, and **explosions**. An explosion is a
   short, very bright point light with a falloff curve, plus particles and an
   optional ring of displacement on the floor. Its shadows are correct for
   free: walls block it the same way they block a ball's light.

**[CHANGED]** Rule 1 as written lasts only until a ball takes the lamp, which
on nearly every map is from the first second. The lamp is then the key light:
a shadowed point light 200 units over its ball, so a slab a typical distance
away throws about the 2D shadow length, lighting the board about as brightly
as the monitor did. The monitor drops to a quarter and its shadow fades out.

**[CHANGED]** Pools are lit, not painted, and that needed two departures from
physics (`three/surfaceMaterial.ts`, POOL LIGHTING). The 2D pools were ADDED to
the picture; a real light multiplies the surface, and on this board's
near-black live space a lamp multiplied in shows nothing. So point lights see
every surface as no darker than a faint grey (a "sheen" only they catch, so the
palette is untouched wherever none reaches), and most of a light's grazing
angle is ignored on the floor, leaving the pool's falloff to distance. Walls
still block them, which is the point.

**[CHANGED]** Rule 2's "a point light at its centre, the ball excluded as a
caster of its own light" is done with no exclusion list: the ball's material
casts shadows from its FRONT faces only, and seen from inside the sphere every
face is a back face.

Shadows: two strategies. Step 0 measures both and picks one.

- **A. three's built-in shadow maps.** The key light is a soft-shadowed
  directional or spot light. Ball lamps are `PointLight`s with cube shadow
  maps, kept small (256 px a face). Shadows are capped to the K lights nearest
  their effect, with the rest unshadowed. This is the least code. Maps have
  one to four balls (one map has four), so K = 4 covers nearly every frame.
  But each shadowed point light is 6 extra scene renders, and an explosion
  adds a light at the worst moment.
- **B. Heightfield-traced shadows.** This board is a heightfield: nothing
  overhangs, the walls are vertical prisms, and the balls are the only round
  casters.
  - Draw a small top-down height texture once per frame (walls, obstacles,
    balls as domes).
  - In the floor and wall shader, march from each pixel toward each light
    through that texture.
  - The cost scales with lights x steps, not with geometry.
  - Soft area-light penumbrae come naturally from cone width.
  - The same texture also gives contact ambient occlusion almost for free.

  This is about 300 lines of shader and suits explosions best.

The proposal is to **build A first, because it gives the fastest true picture,
and keep B ready for the moment A misses the budget on the reference phone.**

**[CHANGED]** A was built; B was not needed to get a picture and is still the
answer if the phone test says A is too slow. Two three.js behaviours had to be
worked round, both pinned by tests: a shadowed light whose map was never drawn
breaks EVERY draw that uses the shader (so each pooled light draws its map
once at creation), and shadow bias is in each light's own depth range (so it
is set per light from a world distance).

On top of the lights:

- ACES or AgX tone mapping;
- bloom, which replaces the hand-built coronas and pixi-filters;
- an optional ambient-occlusion pass (GTAO) on high-tier devices only.

**[CHANGED]** A shoulder instead of ACES or AgX (`three/outputPass.ts`): both
reshape the whole range and would have repainted the palette; the shoulder
passes everything at normal brightness through untouched and only rolls off
explosion cores and hot spots. No bloom: the 2D coronas still do that job over
the sphere. No GTAO.

## 4. How the migration runs: two renderers on one context

PixiJS 8 can take over a WebGL context created by three.js, so both draw into
the **same canvas**. Each frame:

1. `three.resetState()`, render the 3D scene;
2. `pixi.renderer.resetState()`, render the Pixi stage on top.

**[CHANGED]** Three passes, not two (departures 1 and 2): sleek draws the flat
marks into the surface texture; three draws the scene into an HDR target from
it and tone-maps into a texture; sleek composites that texture with the layers
that sit on top. The light-faking layers (the shadow plane's casts, the ball
light buffer, face light, bounce) are simply left out of the hybrid tree, and
the ball light pass runs in a lights-only mode that hands three its LIST.

This gives a strangler-fig migration instead of a big-bang rewrite:

- A new `ThreeRenderer` implements `BoardRenderer`, so GameCanvas, the loop,
  input and physics do not change.
- `SleekRenderer` gains a set of **skipped layers**. `ThreeRenderer` runs it as
  the overlay with the layers already ported switched off. Anything not yet
  ported keeps working from day one.
- Pixi draws after three, so a layer can only be handed to three once
  everything **below** it is in three. Porting therefore goes bottom-up: floor,
  areas, shadows, walls, objects, balls. The things that belong on top stay in
  Pixi, possibly for good:
  - text labels ("Info Unlocked", pickup labels, speed labels);
  - the cut preview;
  - chrome and the danger frame;
  - the perf HUD.
- Renderer selection extends the existing `devend:renderer` preference with a
  `three` option. Per CLAUDE.md, it gets a **control in Admin, not a URL
  parameter alone**. The fallback chain becomes three, then sleek, then
  Canvas 2D.
- The three chunk is dynamically imported when the board mounts, as the Pixi
  chunk is today, and never on the path to "Tap to start". So the first screen
  pays nothing for it, and the 97f3925 gain is kept.

One cost of the hybrid: an object still drawn by Pixi casts no 3D shadow and
does not occlude the 3D lights. That is acceptable on an Admin-only flag, and
it is the order in which porting removes the gaps.

**[CHANGED]** What stays flat for good under the surface-texture approach:
props, areas, data streams, circuit terminals, pickups and bugs, which are
marks ON the floor. They are lit and shadowed as floor, but cast nothing.

## 5. Steps

Each step lands complete with its tests, behind the flag, on `dev`. Sizes are
relative: S is one session, M is a few, L is many.

0. **Spike and go/no-go.** (M)
   - Build three and Pixi on one context, on the real board: the floor from
     the region bake, extruded walls, sphere balls, the key light and ball
     point lights, using shadow strategy A.
   - Measure, using `perfStats`:
     - frame time on a **named low-end Android reference phone**, chosen with
       the user;
     - the added bundle size, brotli.
   - Gate:
     - render time at most about 8 ms at 2x DPR with four lit balls;
     - at most about 200 KB brotli added;
     - no visual regression in board readability.
   - If it fails, try strategy B. If that also fails, fall back to the
     stay-on-Pixi row of section 2.
1. **Scaffolding.** (M)
   - `ThreeRenderer` behind the contract, with the camera mapping from
     section 3, including resize, DPR and the latch.
   - Handle a lost and restored WebGL context.
   - Selection: the flag, the Admin toggle and the fallback chain.
   - Skippable layers in Sleek.
   - `captureForDissolve` and `captureSceneCanvas` read the shared canvas
     straight after render.
   - Tests:
     - floor projection equals `boardRect` for every orientation and tilt
       angle;
     - input round-trip;
     - fallback order.
2. **Floor, regions and areas.** (S)
   - The region, coloured-area and slow-area bakes as floor textures;
     captured ground given a finish.
   - The split-warn tint and head-start strip move from Sleek to the floor
     material.
3. **Walls and fences.** (M)
   - Extrusion and merging.
   - Every fence type from the YAML catalogue gets a material (no hardcoded
     list).
   - The fence in flight, breakable dents, the deformable skin, wall impact
     ripples (as vertex displacement), and the outer frame.
4. **Balls.** (M)
   - Spheres, rolling and the etched lamp look (pending the design decision
     in section 3).
   - Squash, trails, frost and buff rings (as decals or overlay), the boss
     and splat looks.
   - Ball point lights.
5. **Lighting and shadows.** (L)
   - The monitor in camera space, monitor level and flicker
     (`monitorSignal`), and shadow strategy A or B.
   - Lock, impact and derived flashes as enveloped lights.
   - Tone mapping and bloom.
   - Retire, *in three only*: `shadowFor`/`contactFor`, `ballLightPass`,
     `faceLightLayer`, `bounceLayer`, `exposure.ts`. Most of the 16,500 lines
     are these approximations, which real light makes unnecessary.
6. **The long tail of objects.** (L)
   - Obstacles, movers, bouncers, portals, launchers, gravity wells and
     lodestones, chests, destructibles and rubble, mirrors, phasing objects,
     circuits, charges, data streams, delivery boxes and cages.
   - Use the same checklist discipline as Sleek's old `missingFeatures()`: a
     test lists every entity kind the game state can hold, and each one is
     either drawn by three or explicitly still in Pixi. A mechanic that
     silently is not drawn looks like a physics bug.
7. **Effects and transitions.** (M)
   - Explosions (light, particles, debris, a short camera shake), motes as
     instanced particles lit by the scene.

   **[CHANGED]** Explosions are read off the state the 2D fx layer reads (a
   destructible breaking or chipping, a Deploy Charge going off, a launcher
   shell letting go, a ball popping): a pooled light that casts shadows, a hot
   core, a shockwave ring, and the debris as real shards thrown up, bouncing
   and settling (`three/explosions3d.ts`). Rubble is 3D too. No camera shake:
   the flat layers over the scene would not shake with it. Motes stay 2D.
   - The level-clear sweep, the shatter dissolve and the startup pulse,
     re-pointed at three's output.
8. **Quality tiers and devices.** (M)
   - Low, medium and high presets: shadow-map size, the number of shadowed
     lights, ambient occlusion on or off, bloom resolution.
   - `adaptiveDpr` extends into a tier ramp, upward only as it is today, and
     the perf HUD reports which tier is chosen.

   **[CHANGED]** A separate governor (`three/quality.ts`) that steps DOWN only:
   `auto` starts at a tier guessed from the device (coarse pointer, core
   count), and a median frame over budget across 120 frames steps it down one,
   applied between maps, because a rebuild compiles shaders and a hitch
   mid-map is what it exists to prevent. The light pool is a fixed size per
   tier for the same reason. The perf HUD does not show the tier yet.
   - Validate in the Android build (Capacitor WebView), including a cold
     start and a context loss.
   - Admin gets a tier override.
9. **Default and retirement.** (S)
   - three becomes the default.
   - Sleek stays one release as the second fallback, then its layers are
     deleted, and the about 61 test files that pin Sleek source are migrated
     or retired with them.

   **[CHANGED]** Sleek is not retired and cannot be: under departure 1 it is
   half of the 3D board. Its light-faking layers are what a future clean-up can
   delete once the 2D-only path is no longer wanted.
   - The Canvas-2D emergency board stays as it is.
   - ARCHITECTURE.md and CLAUDE.md are updated.

## 6. Risks, and what answers each

| Risk | Answer |
|---|---|
| Phones run hot or drain the battery | Step 0's gate on a named low-end device; quality tiers; capped shadowed lights; strategy B as the cheaper shadow path |
| Bundle and load time | A lazy chunk after the gate; a measured budget in step 0 |
| Readability lost to realism | `light.ts`'s rules are kept as tests: the ball is always the brightest thing on the board, no shadow fully hides a ball, the light is pinned to the screen |
| Pixel crispness (Sleek snaps axis-aligned walls to device pixels) | MSAA plus a narrow field of view keeps walls near-orthogonal; compare with screenshots during the spike |
| A long parity tail | The strangler overlay: nothing has to be at parity before it ships behind the flag, and the step 6 checklist test keeps the tail visible |
| Two-player lockstep | Rendering stays read-only. Rolling and other render-side state live in renderer-owned maps, never in `CanvasGameState` |
| Android WebView GPU variety | WebGL2 baseline, not WebGPU; the existing fallback chain; context-loss handling in step 1 |

## 7. Open questions for the owner

1. **The rolling ball's look:** an etched emissive lamp, as proposed, or should
   balls stop being lamps (lit spheres with a visible pattern) now that the
   board can be lit properly?
2. **The reference phone** for the step 0 gate.
3. **How tall should fences be?** Taller reads better in 3D but hides more of
   the floor from the edge-on parallax. Proposed: keep today's 13 units as the
   default and tune with the Admin knob.

**[CHANGED]** Answered in the build, since the ask was to do it all in one go:
1 the etched lamp; 3 the Admin knob, defaulting to 1.4x. 2 is still open.

## 8. Light as a mechanic (built after the plan)

Once the board had real lights, the light could carry information the board
never showed. Six were built, all on the 3D board only, all reading state the
simulation already keeps and changing none of it, each with a Playground dial
where 0 is the board without it (`lightLook.ts`):

| Mechanic | What the light says | How it stays honest |
|---|---|---|
| Cut preview | While a cut is dragged, each ball lights its own side and the side the cut would capture goes dark | The dark side is the REAL capture, simulated on a copy of the grid (`lib/cutPreview.ts`, like smashReach and areaReach); the would-be fence also stands up as a wall only light sees, so pools stop at it |
| Pocket glow | A ball's light grows hotter as its pocket nears the lock threshold, gold within one halving of a superior lock | Graded with the lock check's own denominator and thresholds |
| Charge tell | An armed Deploy Charge lights exactly its blast radius red, pulsing faster to the blast | Centred where physics centres the blast; a cut-off light whose lit disc IS the radius |
| Pillar shadow | A phasing pillar's shadow grows in on the floor before the pillar turns solid | `phasing.secondsUntilSolid`, from the same cycle tickPhasing runs |
| Power drain | The room dims through a timed map's last stretch and stutters at 30s and 20s; the balls stay bright | Read off the map clock; room lights only, never the balls' |
| Circuit spark | Lighting a terminal sends a spark to the ball it wakes | Fires on the terminal's lit transition, not on terminals lit at map start |

The 2D board has none of these; they are a reason to keep the 3D board on.

## 9. The maps in 3D (built after the plan)

"Rewrite the maps to 3D", read as: finish the 3D look on every map, gameplay
untouched. Three parts:

- **Authored heights.** Every object's height is a multiple of the slab,
  `rise` on the entity (`lib/objectRise.ts`), editable in the Map Builder's
  entity panel. Absent, it takes its role's default - shards 0.6, chests 0.8,
  monoliths 1.25, one-way membranes and gates 0.35 - read off the live board
  by `solids3d.roleRises`, so the defaults apply to every map, random shapes
  included. All 19 ladder maps were then given heights by the same rule
  (MAP_DESIGN_GUIDELINES.md 6.5): the architecture that is each map's premise
  stands 1.3 to 1.8, the lips and shelves that invite a seal sit at 0.75, and
  each map says so in a `# Heights` line above its entry in map.yml.
  Rendering only.
- **Props as bodies** (`three/props3d.ts`). Pickup tokens and chest loot are
  faceted gems hovering over the floor, bugs are beetles on six legs facing
  their heading, charge fuses are canisters whose cap blinks with the fuse,
  terminals are pedestals with a lit lens. All cast real shadows. The 2D prop
  layer keeps only what lies on the floor under them (`propLayer.hybrid`):
  glows, the blast ring, the terminal's link, the bug's birth and warning
  rings.
- **Zones as plates, portals as rims** (`three/zones3d.ts`). Syntax areas,
  gravity wells, slow areas and fence-speed ground are plates 1.6 units proud
  of the floor, their tops showing what the 2D layer painted; they darken with
  the floor under the cut preview. Portals get a breathing emissive rim.

What did not change: the camera still looks straight down, so height reads
through shadow length, the lit edges and the parallax toward the board's
edges rather than through a slanted view. A slanted camera was offered and not
chosen; it would change how touch maps onto the board. The 2D renderer ignores
`rise` and draws its props as before.

## What is still open

- **A phone.** Nothing here has run on real GPU hardware. In this sandbox the
  3D board ran at about the same frame rate as the 2D board on a software GPU,
  and the bundle grew by 133 KB brotli (lazy, after "Tap to start"), but a
  phone's fill rate is the budget that matters. If it is too slow: Admin's
  quality knob pins `low`; `auto` steps down between maps on its own; Admin's
  renderer switch goes back to 2D.
- **Context loss** is handled (both libraries restore, and the shared
  textures are re-made and re-wrapped) but was not provoked on a device.
- **The perf HUD** does not report the 3D tier.
