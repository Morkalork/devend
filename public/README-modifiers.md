# Modifier & Configuration Reference

This document covers every modifier key, effect type, stat, and field that can be used when editing the YAML configuration files.

---

## Table of Contents

1. [upgrades.yml](#upgradesyml)
2. [certificates.yml](#certificatesyml)
3. [achievements.yml](#achievementsyml)
4. [loadouts.yml](#loadoutsyml)
5. [map.yml](#mapyml)
6. [GameModifiers — shared modifier keys](#gamemodifiers--shared-modifier-keys)
7. [Achievement stat types](#achievement-stat-types)

---

## upgrades.yml

In-run upgrades purchased in the shop after each map. Each upgrade applies one or more **GameModifiers** (see below).

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique identifier |
| `name` | string | ✓ | Display name |
| `tier` | string | ✓ | Visual tier — `Junior`, `Senior`, `Principal`, `Architect`, `Wizard` |
| `description` | string | ✓ | Shown in the shop card |
| `cost` | number | ✓ | Overtime hours required to purchase |
| `unlockLevel` | number | | Minimum completed level before this appears in the shop (default: 1) |
| `prerequisites` | string[] | | Other upgrade IDs that must be owned before this can appear |
| `ascensionOnly` | boolean | | Only offered while ascended (e.g. Defensive Programming fence durability) |
| `tags` | string[] | ✓ | 1-2 build archetypes: `lock`, `freeze`, `bank`, `tempo`, `risk`, `safety`. Shown as chips on the shop card; the shop weights its random offers toward tags the player already owns (draft coherence). |
| `modifiers` | map | ✓ | One or more **GameModifier keys** and their values (see below) |

### Set bonuses (`tagSets`)

The file's top-level `tagSets:` block defines one free bonus per archetype,
auto-granted while the player owns at least `tagSets.threshold` upgrades of
that tag (selections in the shop preview the activation; the grant itself is
based on owned upgrades). Active set bonuses appear as their own modifier
source in the bottom-bar details panel.

| Field | Type | Required | Description |
|---|---|---|---|
| `tagSets.threshold` | number | ✓ | Owned upgrades of a tag needed to activate its bonus (currently 3) |
| `tagSets.bonuses[].tag` | string | ✓ | The archetype this bonus belongs to |
| `tagSets.bonuses[].name` | string | ✓ | Display name (e.g. "Chain Reaction") |
| `tagSets.bonuses[].description` | string | ✓ | Shown in the modifier details panel |
| `tagSets.bonuses[].modifiers` | map | ✓ | GameModifier keys, merged like any other source |

### Tiers

| Tier | Colour |
|---|---|
| `Junior` | White/slate |
| `Senior` | Blue |
| `Principal` | Purple |
| `Architect` | Amber/gold |
| `Wizard` | Emerald |

---

## certificates.yml

Permanent meta-progression bonuses bought between runs in the Certificate Store with **Certificate Hours** (earned at one hour per 5 completed levels, banked when the run ends).

A certificate must first be **unlocked**, then its levels are bought one at a time. Each owned level applies its effect permanently to every run.

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique identifier |
| `name` | string | ✓ | Display name |
| `description` | string | ✓ | Shown in the certificate store |
| `unlockType` | string | ✓ | `upgrade-chain`, `achievement`, or `hours-spent` |
| `sourceUpgradeId` | string | for `upgrade-chain` | Buying this upgrade (a max-tier one) in `requiredRuns` separate runs unlocks the certificate |
| `requiredRuns` | number | | Number of separate runs required (default: 3) |
| `sourceAchievementId` | string | for `achievement` | Completing this achievement unlocks the certificate |
| `requiredHoursSpent` | number | for `hours-spent` | Lifetime Certificate Hours spent in the store needed to unlock |
| `levels` | array | ✓ | Purchasable levels, each `{ cost, effect }` |
| `levels[].cost` | number | ✓ | Certificate Hours for that level |
| `levels[].effect.type` | string | ✓ | A **GameModifier key** (see below), or the special `startingLevelBonus` |
| `levels[].effect.value` | number | ✓ | Value applied per owned level (multiplicative keys stack by ×, additive by +) |

> `startingLevelBonus` is special: it is not a GameModifier. The highest owned value (not the sum) sets the level new runs start from. Handled by `getCertStartingLevel()` in `src/hooks/useCertificateManager.ts`.

---

## achievements.yml

Permanent one-time rewards earned by reaching lifetime stat thresholds. Completed achievement bonuses apply as **GameModifiers** to every run.

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique identifier |
| `name` | string | ✓ | Display name |
| `description` | string | ✓ | Shown in the achievements screen |
| `requirement.stat` | string | ✓ | See **Achievement stat types** below |
| `requirement.threshold` | number | ✓ | Stat value required to complete the achievement |
| `bonus.modifier` | string | ✓ | A **GameModifier key** (see below) |
| `bonus.value` | number | ✓ | Value added to that modifier when the achievement is completed |
| `bonus.description` | string | ✓ | Human-readable description of the bonus |

---

## capstones.yml

Capstones are the once-per-run exclusive perk ("Promotion"). At the first
assignment level at/past `offeredAfterLevel` (default 10), a mandatory 1-of-3
draft is offered before the door pick; the pick applies **permanently for the
rest of the run** (surviving
ascension) and the two passed-over capstones are gone for good. Capstones are
rule-breakers, not stat bumps - the pool covers one per archetype (enforced by
tests) so any build can find its crown.

| Field | Type | Required | Description |
|---|---|---|---|
| `offeredAfterLevel` | number | | First assignment level at/past which the draft appears (default 10) |
| `capstones[].id` | string | ✓ | Unique identifier |
| `capstones[].name` | string | ✓ | Display name on the draft card |
| `capstones[].description` | string | ✓ | Shown on the card |
| `capstones[].tag` | string | | Archetype chip: `lock`, `freeze`, `bank`, `tempo`, `risk`, `safety` |
| `capstones[].modifiers` | map | ✓ | One or more **GameModifier keys** |

> A missing or broken capstones.yml simply skips the draft.

---

## doors.yml

Doors are the "Next Assignment" contracts. Every 5th completed level replaces
the shop with a **mandatory** draft: pick one of three doors rolled from this
pool (no neutral option). The picked door's modifiers run for the whole
5-level block — all maps and their shops — until the next assignment replaces
it. Shop-facing rewards (`extraShopItems`, `shopRestockCount`) therefore apply
to every shop in the block, and per-map rewards (`instantFencesPerMap`) fire
on each map. The draft screen also briefs the next map with real intel (exact
ball spawns, par, capture target, obstacle count).

A top-level **`offeredAfterLevel`** (default 5) is the assignment cadence:
assignments land after every multiple of that level (5, 10, 15, ...), so the
early maps stay clean while players learn the base game. If the pool fails to
load, assignment levels fall back to the regular shop.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique identifier |
| `name` | string | ✓ | Display name on the door card |
| `risk` | string | ✓ | Downside text (shown in red) |
| `reward` | string | ✓ | Payoff text (shown in accent colour) |
| `modifiers` | map | ✓ | One or more **GameModifier keys**; must include at least one adverse value (enforced by tests: no free lunches) |

> Overtime-facing rewards fold under the per-map cap, so doors buy consistency
> and side payoffs, not inflation. An empty or missing doors.yml makes
> assignment levels fall back to the shop.

---

## loadouts.yml

Curse + blessing bundles drafted at the **start of every run** (the base-game "Sprint Planning" loadout draft, `RunDraftScreen`) and again after beating the final level (the Ascension draft, `AscensionDraftScreen`). A run-start pick shapes the run from level 1; ascension picks stack on top and loop back to level 1. Loaded by `useLoadoutManager`, folded into the same GameModifiers pipeline as upgrades.

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique identifier |
| `name` | string | ✓ | Display name on the draft card |
| `curse` | string | ✓ | Downside text (shown in red) |
| `blessing` | string | ✓ | Upside text (shown in accent colour) |
| `modifiers` | map | ✓ | One or more **GameModifier keys** — a curse is simply an adverse value (e.g. `ballSpeedMultiplier: 1.25`) |
| `uniqueWinsRequired` | number | | How many **unique wins** (runs beaten with distinct run-start loadouts) are needed before this loadout unlocks for the run-start draft. Omit for the loadouts available from scratch. Has no effect on the Ascension draft, which always offers the full catalogue. |

The file also has a top-level `ascension` block:

| Field | Type | Description |
|---|---|---|
| `ascension.speedRampPerDepth` | number | Baseline ball-speed multiplier applied per ascension depth on top of drafted loadouts (default 1.08, compounds) |
| `ascension.fenceDurabilityBase` | number | Ball hits an ascended fence survives on level 1 (default 6) |
| `ascension.fenceDurabilityAtFinal` | number | …declining linearly to this on the final level (default 2). Fences bordering captured space never break. |

> `extraLives` in a mutator is applied once, on draft, like buying an extra-lives upgrade. Levels completed at depth *d* count *(1 + d)*× toward Certificate Hours.

---

## map.yml

Defines all levels. Each level is an entry in the `levels` array.

### Level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique identifier |
| `level` | number | ✓ | Logical level number. Multiple maps can share the same level number — one is picked at random |
| `sizeThreshold` | number | ✓ | Percentage of board that must be captured to win (e.g. `40` = clear 60%) |
| `expectedCuts` | number | ✓ | Par cut count — affects scoring and the cuts/par display |
| `points` | number | ✓ | Base overtime hours awarded on completion. Kept **flat across levels** (issue #43): it also drives the per-map reward cap (`points × overtimeCapHeadroom`, which lock/push bonuses fold in under) and the upgrade-pricing base, so a flat value keeps per-map income and upgrade costs in step and avoids hyperinflation. Must exceed `expectedCuts`. Late-run scarcity comes from the shop side instead: `pricing.blockInflation` in upgrades.yml multiplies effective prices (and the Budget Cycle spend chunk) per completed 5-level assignment block, and shop offers are weighted toward recently unlocked upgrades. |
| `variety` | number | | `0–100` — controlled randomness for organic variation (default: `0`) |
| `randomShapes` | number | | `0–100` — percentage chance for random mini-obstacles (default: `20`) |
| `threadLockRequired` | number | | Minimum number of balls that must be thread-locked to win |
| `maxBalls` | number | | Maximum balls the map spawns (default `1`). The **game** chooses which ball *types* fill these slots — see Ball types below. The map no longer specifies colours, speeds, or positions. |
| `entities` | array | | Optional obstacles/walls (see below) |
| `pickupChance` | number | | `0–1` — pickup spawn chance override for this map. Setting it also **bypasses** the global `start_level` gate in game-config.yml `pickups:`, so a teaching map can guarantee tokens (`1`) or a set-piece can suppress them (`0`). |
| `pickupSpots` | array | | Curated pickup anchor positions, `[{ x, y }, …]` in world units. A spawn roll prefers a free spot from this list and falls back to a random open cell. |

### Pickups (power-up tokens)

Global tuning lives in game-config.yml under `pickups:` (start level, spawn cadence/chance,
max 2 simultaneous, lifetime, effect weights/values). A token is **claimed by locking a
ball in the pocket that contains it**; capturing its area with no lock wastes it, and
unclaimed tokens expire. Effects: `overtime` (+h paid **after** the per-map cap),
`fork` (splits a random free ball into two), `cap_raise` (raises this map's overtime cap),
`freeze_charge` (one free tap-to-freeze, no upgrade needed).

### Ball types

Balls are no longer defined per-map. Each level spawns up to `maxBalls` balls, whose
**types** are chosen deterministically (stable per map id) from the types **eligible**
at that level — a type is eligible once the level number reaches its unlock level. A map
never uses more distinct types than are eligible. All stats (colours, speeds, unlock
levels, lock multipliers, abilities) live in [`balls.yml`](balls.yml) and are tweakable
without a rebuild — the table below summarises the abilities only. Speeds are flat (no
per-level scaling, no per-cut ramp) and still scale with the `ballSpeedMultiplier` upgrade.
Each type has a `minimumSpeed` floor that speed-altering effects never cross.

| Type | Ability |
|---|---|
| Red | none (standard) |
| Blue | none (standard) |
| Yellow | Variable speed — picks a new random speed in its `speedRange` on each surface contact |
| Purple | Slows every ball it clashes with by its `speedReduction`, down to that ball's `minimumSpeed` (also shrinks a yellow's range) |
| Green | Money ball — locking it triples all subsequent locks this round |
| Grey | Winds down by 10 every 5 seconds, down to its `minimumSpeed` |
| Black | Breaks mirrors and movers after 3 hits, losing one lock-× per kill (floor 1); destroyed mirrors re-open as capturable space |

### Entity fields

Entities are obstacles that carve into the playable area.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique within the level |
| `kind` | string | ✓ | Currently only `wall` |
| `shape` | string | ✓ | `rect`, `polygon`, or `circle` |
| `mirror` | boolean | | If `true`, growing fences reflect off this wall |
| `breakable` | boolean | | If `true`, balls smash it (any ball; black ball = half the hits). Smashing awards bonus overtime and topples anything stacked on it. You can't fence against a breakable (the cut duds). |
| `hitsToBreak` | number | | Hits required to break (default `3`). |
| `objective` | boolean | | Marks an intended breakable target (worth more bonus). |
| `fence` | boolean | | Render the breakable as a barrier/fence line instead of a solid block. |
| `reveals` | object | | `{ x, y, width, height }` — a sealed (locked, uncuttable) area this breakable gates; re-opened as capturable space when it breaks. |

**`rect` shape extra fields:** `x`, `y`, `width`, `height` (world units)

**`polygon` shape extra fields:** `points` — array of `[x, y]` pairs (world units)

**`circle` shape extra fields:** `cx`, `cy`, `radius` (world units)

> **World units:** The board is 900 × 900 world units regardless of screen size.

---

## GameModifiers — shared modifier keys

These are the keys used in `upgrades.yml → modifiers` and `achievements.yml → bonus.modifier`.
Multiplicative modifiers stack by multiplication; additive modifiers stack by addition.

### Multiplicative (stack by ×)

| Key | Default | Effect | Example value |
|---|---|---|---|
| `ballSpeedMultiplier` | `1.0` | Multiplies ball movement speed. Values below 1 slow balls down. | `0.95` = −5% speed |
| `ballSizeMultiplier` | `1.0` | Multiplies ball radius. | `0.90` = −10% size |
| `fenceGenerationSpeedMultiplier` | `1.0` | Multiplies how fast fences grow. | `1.10` = +10% speed |
| `scoreMultiplier` | `1.0` | Multiplies overtime hours earned per map. | `1.15` = +15% overtime |
| `shopDiscountMultiplier` | `1.0` | Multiplies all upgrade-shop prices (Bulk Licensing certificate). | `0.93` = 7% off |
| `pushBonusMultiplier` | `1.0` | Multiplies push-your-luck chunk payouts (Risk Appetite upgrade, Double Or Nothing set bonus, Risk Assessment certificate). | `1.5` = +50% |
| `spaceBonusMultiplier` | `1.0` | Multiplies the space-optimization bonus payout, still under the per-map cap (Tech Evangelist). | `2` = double |

### Additive (stack by +)

| Key | Default | Effect | Example value |
|---|---|---|---|
| `instantFencesPerMap` | `0` | Number of fences at the start of each map that generate instantly. | `1` |
| `additionalConcurrentFences` | `0` | Extra fences that can grow simultaneously. | `1` |
| `bonusRemovalChance` | `0` | Probability (0–1) that a fence triggers a bonus area removal. | `0.10` = 10% chance |
| `bonusRemovalAmount` | `0` | Extra area (0–1 fraction) removed when a bonus removal triggers. | `0.05` = 5% extra |
| `extraLives` | `0` | Extra lives granted when the upgrade is purchased during a run. | `1` |
| `extraShopItems` | `0` | Extra item slots shown in the shop after each map. | `1` |
| `shopRestockCount` | `0` | Purchases per shop visit that refill their slot with a new offer (Procurement upgrades). | `1` |
| `extraContinues` | `0` | Per-run revives (runs start with none). Spend a Continue on death to retry the level with overtime + upgrades intact. Grantable by a certificate or upgrade (Golden Parachute); completing level 20 also awards one for free. | `1` |
| `extraCertificateHours` | `0` | Bonus Certificate Hours banked when the run ends (Certification Wizard, Night School Diploma). | `1` |
| `startingCapturePercent` | `0` | Board starts with this % already captured — the arena shrinks and the run starts below 100% remaining (Equity Grant certificate; clamped to 40). | `5` |
| `fenceDurabilityBonus` | `0` | Extra ball hits Ascension fences survive before crumbling. No effect outside Ascension. | `1` |
| `ballFreezeDuration` | `0` | Seconds a ball stays frozen when tapped (Feature Freeze). `0` = the ability is off. Values from tiers sum (2+2+2 → 6s; Cascade Freeze adds a further +2 → 8s). After thawing, that ball can't be re-frozen for `duration × 2`. | `2` |
| `ballFreezeCount` | `0` | Extra balls a single freeze tap also freezes, beyond the tapped one (Cascade Freeze). Total frozen per tap = `1 + ballFreezeCount`; the nearest eligible balls in the tapped ball's region are chosen. | `1` |
| `autoFreezeDuration` | `0` | Seconds an automatically-frozen ball stays frozen (Cron Job). `0` = the ability is off. Every 10s (`AUTO_FREEZE_INTERVAL_MS`) one random eligible ball is frozen via the same path as Feature Freeze. Values from tiers sum (3+1+1 → 5s). After thawing, that ball can't be re-frozen for `duration × 2`. | `3` |
| `showHighscoreProgress` | `0` | `> 0` reveals the map-highscore HUD bar (Benchmarking upgrade, gated behind Memory Footprint): a second bar under the capture readout tracking the live projected score against the map's stored highscore. Purely a HUD toggle, no gameplay effect. | `1` |
| `overtimePerLock` | `0` | Flat overtime hours added to the lock bonus per locked ball (Severance Package). Deliberately outside the money-ball/simultaneous multipliers; folds under the per-map cap with the rest of the lock bonus. | `1` |
| `fenceSpeedPerLock` | `0` | Fence-generation speed bonus per ball locked **this map** (Knowledge Transfer). Applied as `× (1 + value × locksThisMap)` on top of `fenceGenerationSpeedMultiplier`; resets each map. | `0.04` = +4%/lock |
| `frozenLockBonus` | `0` | Extra lock-bonus multiplier when a ball is locked **while frozen** (Frozen Assets). The frozen ball's lock contribution is multiplied by `1 + value`. | `1` = frozen locks pay double |
| `simultaneousLockBonus` | `0` | Every lock pass counts as this many balls bigger for the simultaneous-trap multiplier (Chain Reaction set bonus). | `1` |
| `freezeNoCooldown` | `0` | `> 0` removes the re-freeze cooldown: a thawed ball is immediately tappable again (Absolute Zero set bonus). Applies to Cron Job auto-freezes too. | `1` |
| `fenceSpeedPerFence` | `0` | Fence-speed bonus per fence completed **this map** (Continuous Delivery). Stacks with `fenceSpeedPerLock` in the same `× (1 + …)` tempo term; resets each map. | `0.04` = +4%/fence |
| `underParInstantFence` | `0` | Instant fences granted on the **next** map after finishing a map under par (Clean Release). Re-evaluated every completion, so the carry lasts exactly one map. | `1` |
| `bankedSlowPer50h` | `0` | Ball-speed reduction per 50h banked at map start (War Chest), capped at 8% total. Folded by useGameSession into `ballSpeedMultiplier` per map. | `0.02` = 2%/50h |
| `overtimeCapBonus` | `0` | Raises the per-map overtime cap by this many hours (Stock Options capstone). | `20` |
| `freeCheapestOffer` | `0` | `> 0` makes the cheapest unowned offer in every shop free (Company Card capstone). | `1` |
| `wallShieldsPerMap` | `0` | Fence-hit shields granted fresh at every map start: a shielded hit breaks the fence but costs no life (Second Wind capstone). | `1` |
| `fenceGraceMs` | `0` | Growing fences ignore ball hits during their first N milliseconds (Ghost Protocol capstone). Mover collisions still hurt. | `1500` |
| `shipEarlySecondsPerBall` | `0` | Extra seconds PER BALL added to every Ship Early bonus window (Deadline Extension). With `2`, a 4-ball map's windows each gain 8s. | `2` |
| `scopeCreepImmediate` | `0` | `> 0` removes Scope Creep's grace window: the first speed surge lands at second 0 of active play and steps to the usual cap (Hard Deadline door). | `1` |
| `runwayInstantFenceAt` | `0` | Runway (hoard side): while the bank is at/above this many hours when a map starts, one fence completes instantly. `0` = perk not owned. | `100` |
| `runwayConcurrentFenceAt` | `0` | Runway: while the bank is at/above this threshold, +1 concurrent fence. | `200` |
| `runwayFreezeAt` | `0` | Runway: while the bank is at/above this threshold, tap-to-freeze is granted (2s, rides the Feature Freeze mechanic). | `300` |
| `spendInstantFencePerChunk` | `0` | Budget Cycle (spend side): instant fences on the NEXT map per 60h spent in one shop visit (max 3 chunks counted; src/lib/treasury.ts). | `1` |
| `spendFenceSpeedPerChunk` | `0` | Budget Cycle: fence-speed bonus on the NEXT map per 60h-spend chunk. | `0.05` = +5%/chunk |
| `lockThresholdBonus` | `0` | Percentage points added to the lock threshold (base `lock.win_threshold_percent`, 10): pockets slightly larger than the limit still lock their ball (Code Review). | `3` |
| `spawnFreezeSeconds` | `0` | Seconds every ball stays frozen at map start (Cold Boot). Rides the Feature Freeze `frozenUntil` path; the spawn thaw carries no re-freeze cooldown. | `2` |
| `pickupChanceBonus` | `0` | Extra pickup-token spawn chance per roll, in absolute probability (0.03 = +3 percentage points on the game-config base). Only applies on maps where pickups are enabled; never turns them on. Player-facing copy stays vague on purpose (Benefits Package). | `0.03` |
| `pickupPayoutLevel` | `0` | Enhances every pickup payout per level: +1h on overtime and cap tokens, +1s on freeze charges, and the Fork's split balls fly 5% slower per level (never below their minimum speed). At level 3 the Fork splits a ball into THREE (Total Compensation). | `1` |
| `shipEarlyBonusMultiplier` | `1` | Multiplies the Ship Early payout AFTER the ladder's `maxBonus` clamp (Hard Deadline door). Still folds under the per-map overtime cap. | `2` |

---

## Achievement stat types

Used in `achievements.yml → requirement.stat`.

These are **lifetime cumulative stats** persisted in localStorage.

| Stat | Description |
|---|---|
| `totalFencesDrawn` | Total fences drawn across all runs |
| `highestLevelReached` | Highest level number reached in a single run |
| `totalLevelsCompletedWithoutLoss` | Total levels completed without losing a life |
| `totalLivesLost` | Total lives lost across all runs |
| `deepestAscension` | Deepest Ascension depth ever reached |
| `pushBonusesBanked` | Push-your-luck bonuses successfully banked (not failed) |
