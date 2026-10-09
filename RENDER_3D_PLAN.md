# RENDER_3D_PLAN.md

The plan for moving the board's graphics from the 2D Pixi renderer to a real 3D
scene, still seen from above.

Status: **PLANNED**. Nothing here is built yet. The plan follows the convention
of the other plan docs: when the build departs from it, the departure is marked
**[CHANGED]** with the reason, rather than the plan being quietly rewritten.

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
- **Fences and walls.** Each segment is extruded into a bevelled prism and
  merged into one `BufferGeometry` per fence type. The merged mesh is rebuilt
  when a cut lands; the fence in flight is a separate small dynamic mesh.
  - Breakable dents (today carved into the 2D hull) become notches in the
    extrusion.
  - The outer frame becomes a real bevelled rim.
  - Heights come from one table, which replaces `SLAB_HEIGHT_WORLD`. Fences
    can now differ in height, so a guardrail could be taller than a standard
    fence.
- **Balls.** Instanced spheres. The squash effects (`getSquishEffect`,
  `getWallHitEffect`) become a non-uniform scale along the impact normal,
  which is what the 2D squash was imitating.
- **Obstacles, props, chests and destructibles.** Extruded polygon slabs with
  real heights. Rubble and debris become small rigid chunks. They are animated
  by the existing render-side debris state, not by a physics engine.

### Rolling

Rolling is purely cosmetic and lives entirely in the renderer. Each frame,
from the interpolated position delta `d` and radius `r`:

- the ball turns about the axis `up x d` by the angle `|d| / r`;
- that rotation is accumulated into a quaternion kept in a renderer-side
  `WeakMap<Ball, Quaternion>`, the same pattern as the existing `Lag` state.

It never touches the simulation, so lockstep is unaffected.

**This changes the lamp design, and it is a design decision for the user, not
a technical one.** A ball with a centred bulb has nothing on it to show it
turning. The proposal: keep the emissive body (so the ball is still the
brightest, easiest thing to track, which is why it became a lamp), and etch a
darker pattern into it that rolls with the ball. Seams or circuit traces suit
the theme, with each ball type's look coming from `ballLook.ts`. The etching
must stay subtle enough that a ball at speed does not shimmer.

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

On top of the lights:

- ACES or AgX tone mapping;
- bloom, which replaces the hand-built coronas and pixi-filters;
- an optional ambient-occlusion pass (GTAO) on high-tier devices only.

## 4. How the migration runs: two renderers on one context

PixiJS 8 can take over a WebGL context created by three.js, so both draw into
the **same canvas**. Each frame:

1. `three.resetState()`, render the 3D scene;
2. `pixi.renderer.resetState()`, render the Pixi stage on top.

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
   - The level-clear sweep, the shatter dissolve and the startup pulse,
     re-pointed at three's output.
8. **Quality tiers and devices.** (M)
   - Low, medium and high presets: shadow-map size, the number of shadowed
     lights, ambient occlusion on or off, bloom resolution.
   - `adaptiveDpr` extends into a tier ramp, upward only as it is today, and
     the perf HUD reports which tier is chosen.
   - Validate in the Android build (Capacitor WebView), including a cold
     start and a context loss.
   - Admin gets a tier override.
9. **Default and retirement.** (S)
   - three becomes the default.
   - Sleek stays one release as the second fallback, then its layers are
     deleted, and the about 61 test files that pin Sleek source are migrated
     or retired with them.
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
