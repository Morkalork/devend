# Architecture

This document explains how the game is put together. Read it once before touching code — every section links to the files it describes.

## The game in one paragraph

Balls of Fire and Ice is a JezzBall-style arcade game. Balls bounce around a square board; the player draws *fences* (growing walls) to cut the board into regions. Regions without balls are captured. Capture enough of the board and the level is won. Between levels the player spends *overtime hours* (the score) in an upgrade shop; across runs they earn *Certificate Hours* to buy permanent bonuses in the Certificate Store. Beating the final level offers **Ascension**: draft a curse-and-blessing *mutator* and loop back to level 1 at higher intensity, or retire and bank the run. While ascended, fences *wear out*: each fence survives a limited number of ball hits (fewer on later levels) and then crumbles, re-merging the areas it separated — except fences bordering captured space, which never break (see [physics/breakFenceWall.ts](src/lib/physics/breakFenceWall.ts)).

## Tech stack

React 18 + TypeScript + Vite, Tailwind CSS, framer-motion for screen transitions. The game itself is **not** React — it runs on a raw `<canvas>` with an imperative game loop. React renders the chrome around it.

There is no backend. All persistence is `localStorage`; all game content is YAML files in [public/](public/) fetched at runtime.

## Directory map

```
src/
├── pages/Index.tsx          The only page. Switches between full-screen views.
├── components/
│   ├── game/                One file per screen/overlay (WelcomeScreen, GameScreen, …)
│   ├── admin/               Dev-only tools: map builder, modifier playground
│   └── ui/                  Generic primitives (tooltip, progress bar)
├── hooks/                   React state managers, one per subsystem (see below)
├── contexts/                AccentColorContext — level-based UI colour theme
├── lib/                     Pure game logic, no React:
│   ├── physics/             Ball movement, collisions, fence growth, cuts
│   ├── rendering/           renderFrame.ts — the whole per-frame draw pass
│   ├── spaceGrid.ts         Authoritative grid model of captured space
│   ├── regionOwnership.ts   Invariant: every ball belongs to exactly one region
│   ├── polygon.ts           Geometry primitives
│   ├── initGame.ts          Builds the world from a level config
│   └── scoring.ts           Score calculation + scoring-config.yml loader
├── types/                   Shared TypeScript types (one file per domain)
└── test/                    Vitest setup
public/
├── map.yml                  All levels (see public/README-modifiers.md)
├── upgrades.yml             Shop upgrades
├── loadouts.yml            Loadouts (run-start draft + Ascension loop)
├── certificates.yml         Meta-progression certificates
├── achievements.yml         Achievements
├── colors.yml               Accent colour per level range
├── game-config.yml          Global tuning (opacity, fence speed curve)
├── scoring-config.yml       Scoring bonuses/multipliers
└── README-modifiers.md      Reference for every YAML field and modifier key
```

## Screen flow

`Index.tsx` renders exactly one screen at a time, chosen by [useScreenNavigation](src/hooks/useScreenNavigation.ts) (a simple state machine over the `GameScreen` union in [types/game.ts](src/types/game.ts)):

```
welcome ──► runDraft ──► game ──► (LevelCompleteOverlay) ──► upgradeShop ──► game … ──► result
   │        (loadout)      │ (final level)            ▲                                   │
   │                       │                          │ (ContinuePrompt on death,         │
   │                       │                          └─ spend a Continue to retry level) │
   │                       └──► ascensionDraft ──► game (loop) or result                  │
   ├──► tutorial / options / achievements / certificateStore ◄───────────────────────────┘
   └──► admin ──► mapBuilder / animationTest        (dev builds only)
```

A fresh run first visits **runDraft** ("Sprint Planning"), where the player drafts one curse+blessing mutator (or skips) to shape the run from level 1. On running out of lives, the **ContinuePrompt** overlay offers a per-run revive (`continuesRemaining`): spend one to retry the current level with score + upgrades intact, or end the run. The `?level=` debug jump skips the draft.

All run state (score, lives, owned upgrades, current level) lives in [useGameSession](src/hooks/useGameSession.ts), which composes the smaller managers below and is created once in `Index.tsx`.

## The hooks layer

Each hook owns one subsystem; most load a YAML file and/or persist to localStorage.

| Hook | Owns | Config file | localStorage key |
|---|---|---|---|
| [useGameSession](src/hooks/useGameSession.ts) | run state, orchestration | — | — |
| [useScreenNavigation](src/hooks/useScreenNavigation.ts) | visible screen | — | — |
| [useLevelManager](src/hooks/useLevelManager.ts) | level sequence | `map.yml` | — |
| [useUpgradeManager](src/hooks/useUpgradeManager.ts) | upgrade catalogue | `upgrades.yml` | — |
| [useLoadoutManager](src/hooks/useLoadoutManager.ts) | loadout catalogue (run-start + Ascension drafts) | `loadouts.yml` | — |
| [useActiveModifiers](src/hooks/useActiveModifiers.ts) | **GameModifiers pipeline** | — | — |
| [useCertificateManager](src/hooks/useCertificateManager.ts) | certificates, Certificate Hours | `certificates.yml` | `jezzball_certs_v1` |
| [useAchievementManager](src/hooks/useAchievementManager.ts) | achievements + bonuses | `achievements.yml` | `jezzball_achievements_v1` |
| [useMetaProgression](src/hooks/useMetaProgression.ts) | lifetime stats, super-upgrade unlocks, per-map highscores, encountered ball types | — | `jezzball_meta_stats`, `jezzball_unlock_state` |
| [useTutorialManager](src/hooks/useTutorialManager.ts) | one-time tutorial flags | — | `tutorials_seen_v1` |
| [useCheckpointSnapshots](src/hooks/useCheckpointSnapshots.ts) | level snapshots | — | `jezzball_checkpoints_v2` |
| [useColorProgression](src/hooks/useColorProgression.ts) | accent colour per level | `colors.yml` | — |
| [useGameConfig](src/hooks/useGameConfig.ts) | global tuning values | `game-config.yml` | — |
| [useGameInput](src/hooks/useGameInput.ts) | pointer → fence cuts (canvas-level) | — | — |
| [useGameLoop](src/hooks/useGameLoop.ts) | the rAF loop factory (canvas-level) | — | — |

**Renaming or removing a localStorage key loses player data.** If you must rename, read the old key as a fallback — see `loadPersistence()` in `useCertificateManager.ts` for the pattern.

## The modifier pipeline

Everything that changes gameplay numbers flows through one structure: **`GameModifiers`** ([useActiveModifiers.ts](src/hooks/useActiveModifiers.ts)). Three sources feed it:

```
owned upgrades (this run)        → useActiveModifiers(upgrades, ownedIds, extraBonuses)
achievement bonuses (permanent)  ─┐
certificate bonuses (permanent)  ─┼→ mergeBonuses() → extraBonuses
loadouts + depth ramp (ascension)─┘
```

The merged `GameModifiers` object is passed as a prop into `GameScreen` → `GameCanvas` and read by the physics code. Multiplicative keys (listed in `MULTIPLICATIVE_KEYS`) stack by multiplication, the rest by addition. The key names are a public contract: YAML files reference them as strings, so renaming a key means updating `upgrades.yml`, `certificates.yml`, `achievements.yml` and [public/README-modifiers.md](public/README-modifiers.md) together.

## Inside the game board

[GameCanvas.tsx](src/components/game/GameCanvas.tsx) is the React/imperative boundary. Understand this and you understand the game:

- **State**: one big mutable object, `CanvasGameState` ([types/gameState.ts](src/types/gameState.ts)), held in a ref. It is *never* set via setState — the loop mutates it directly. React state exists only for UI-visible values (lives, cut count, screen flash).
- **Loop**: [useGameLoop.ts](src/hooks/useGameLoop.ts) runs fixed-timestep physics at 120 Hz with render interpolation, all inside `requestAnimationFrame`.
- **Coordinates**: gameplay runs in a 900×900 *world unit* space ([boardConstants.ts](src/lib/boardConstants.ts)); rendering scales world → screen via `boardRect`.
- **Space**: captured vs playable area is tracked by an explicit grid, [spaceGrid.ts](src/lib/spaceGrid.ts) — the authoritative source for "how much board is left".
- **Regions**: the playable area is a set of polygons ([types/game.ts](src/types/game.ts) `Region`). Core invariant, enforced by [regionOwnership.ts](src/lib/regionOwnership.ts): every ball belongs to exactly one region at all times.
- **A cut**: pointer input ([useGameInput.ts](src/hooks/useGameInput.ts)) starts a `GrowingWall`; [physics/updateFenceWall.ts](src/lib/physics/updateFenceWall.ts) grows it; when complete, [physics/applyCut.ts](src/lib/physics/applyCut.ts) splits the region, captures ball-free parts, locks lone balls and awards score.
- **Rendering**: a single stateless pass, [rendering/renderFrame.ts](src/lib/rendering/renderFrame.ts). Draw order is documented at the top of that file. Static imagery (region fill, ball spheres, glows) is cached on OffscreenCanvases — see `ballRenderCache.ts`, `ballEffects.ts`.
- **WebGL renderer (Stage A, opt-in)**: a PixiJS v8 port of the render pass lives in [rendering/pixi/](src/lib/rendering/pixi/PixiGameRenderer.ts), behind a runtime flag ([rendering/rendererSettings.ts](src/lib/rendering/rendererSettings.ts)): enable via `?renderer=pixi` (sticky) or the Playground toggle. It consumes the same game/rctx state, reuses the 2D bakes as GPU textures and renders at native device resolution (no 2x DPR cap). Stage-A simplifications: no data rain, no wall-impact ripples or damage cracks, simplified level-clear sweep and game-over dissolve. Default remains canvas2d until parity sign-off; the pixi chunk is dynamically imported so the default path never loads it.

React callbacks the physics needs (setters, game-over handling) are bundled in `GameCallbacks` ([physics/gameCallbacks.ts](src/lib/physics/gameCallbacks.ts)) so lib code stays React-free.

## Cookbook

**Add a level** — add an entry to [public/map.yml](public/map.yml) (field reference in [public/README-modifiers.md](public/README-modifiers.md)), or use the visual Map Builder: run `npm run dev`, Welcome → Admin → Map Builder. In dev it saves straight back to `map.yml` through a Vite middleware (see `mapApiPlugin` in [vite.config.ts](vite.config.ts)).

**Add an upgrade** — add an entry to [public/upgrades.yml](public/upgrades.yml) using existing `GameModifiers` keys. No code needed unless you need a brand-new modifier key.

**Add a loadout** — add an entry to [public/loadouts.yml](public/loadouts.yml) (`id`, `name`, `curse`, `blessing`, `modifiers` with existing `GameModifiers` keys; a curse is just an adverse value). Add `uniqueWinsRequired: N` to gate it behind N unique wins in the run-start draft (omit for the loadouts available from scratch). The per-depth difficulty ramp is the `ascension.speedRampPerDepth` field in the same file.

**Add a new modifier key** — add the field + default to `GameModifiers` and `DEFAULT_MODIFIERS` in [useActiveModifiers.ts](src/hooks/useActiveModifiers.ts) (and `MULTIPLICATIVE_KEYS` if it stacks by ×), consume it in the physics/scoring code, document it in `README-modifiers.md`, and add a slider entry in [PlaygroundScreen.tsx](src/components/admin/PlaygroundScreen.tsx) so it can be tested live.

**Add an achievement or certificate** — edit the YAML; the managers pick it up. Certificates referencing achievements use `sourceAchievementId`.

**Tune scoring** — [public/scoring-config.yml](public/scoring-config.yml), logic in [lib/scoring.ts](src/lib/scoring.ts).

**Test gameplay changes** — Welcome → Admin → Animation Test opens the Playground: every modifier adjustable live with apply-and-restart. Use `?level=N` in the URL to jump to a level.

## Known gaps

- Ascension state (depth, drafted loadouts) is not persisted across sessions: a quit ascended run starts over from depth 0 next launch. (In-run, the per-run Continue lets you retry a level after death at any depth.)
- Test coverage is minimal (one placeholder test). The `lib/` modules are pure and React-free, so they are the natural place to start adding unit tests.
- `eslint` reports 12 `react-hooks/exhaustive-deps` warnings that are intentional (adding the deps would re-trigger effects); review carefully before "fixing".
