# Modifier & Configuration Reference

This document covers every modifier key, effect type, stat, and field that can be used when editing the YAML configuration files.

---

## Table of Contents

1. [upgrades.yml](#upgradesyml)
2. [augments.yml](#augmentsyml)
3. [achievements.yml](#achievementsyml)
4. [map.yml](#mapyml)
5. [GameModifiers — shared modifier keys](#gamemodifiers--shared-modifier-keys)
6. [Augment effect types](#augment-effect-types)
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
| `modifiers` | map | ✓ | One or more **GameModifier keys** and their values (see below) |

### Tiers

| Tier | Colour |
|---|---|
| `Junior` | White/slate |
| `Senior` | Blue |
| `Principal` | Purple |
| `Architect` | Amber/gold |
| `Wizard` | Emerald |

---

## augments.yml

Persistent meta-upgrades purchased between runs with Augment Points. Effects stack per stack purchased.

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique identifier |
| `name` | string | ✓ | Display name |
| `description` | string | ✓ | Shown in the augment store |
| `maxStacks` | number | ✓ | Maximum number of stacks purchasable |
| `costPerStack` | number | ✓ | Augment Points per stack |
| `icon` | string | | Path to icon SVG, relative to `/public` |
| `special` | boolean | | If `true`, renders as a golden special augment |
| `effect.type` | string | ✓ | See **Augment effect types** below |
| `effect.value` | number | ✓ | Value applied per stack |
| `locked` | boolean | | If `true`, hidden until the unlock condition is met |
| `unlockCondition.type` | string | | See **Achievement stat types** below |
| `unlockCondition.threshold` | number | | Stat value required to unlock |
| `unlockCondition.description` | string | | Short description shown in the UI |

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

## map.yml

Defines all levels. Each level is an entry in the `levels` array.

### Level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique identifier |
| `level` | number | ✓ | Logical level number. Multiple maps can share the same level number — one is picked at random |
| `sizeThreshold` | number | ✓ | Percentage of board that must be captured to win (e.g. `40` = clear 60%) |
| `expectedCuts` | number | ✓ | Par cut count — affects scoring and the cuts/par display |
| `points` | number | ✓ | Base overtime hours awarded on completion |
| `variety` | number | | `0–100` — controlled randomness for organic variation (default: `0`) |
| `randomShapes` | number | | `0–100` — percentage chance for random mini-obstacles (default: `20`) |
| `threadLockRequired` | number | | Minimum number of balls that must be thread-locked to win |
| `balls` | array | ✓ | List of balls (see below) |
| `entities` | array | | Optional obstacles/walls (see below) |

### Ball fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique within the level |
| `initialSpeed` | number | ✓ | Starting speed in world units/s |
| `topSpeed` | number | ✓ | Maximum speed after ramping |
| `color` | string | ✓ | 6-char hex colour **without** `#` (e.g. `ff6b6b`) |
| `radius` | number | | Override default ball radius in world units |
| `startX` | number | | Override starting X position (world units, 0–900) |
| `startY` | number | | Override starting Y position (world units, 0–900) |

### Entity fields

Entities are obstacles that carve into the playable area.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique within the level |
| `kind` | string | ✓ | Currently only `wall` |
| `shape` | string | ✓ | `rect`, `polygon`, or `circle` |
| `mirror` | boolean | | If `true`, growing fences reflect off this wall |

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

### Additive (stack by +)

| Key | Default | Effect | Example value |
|---|---|---|---|
| `instantFencesPerMap` | `0` | Number of fences at the start of each map that generate instantly. | `1` |
| `additionalConcurrentFences` | `0` | Extra fences that can grow simultaneously. | `1` |
| `bonusRemovalChance` | `0` | Probability (0–1) that a fence triggers a bonus area removal. | `0.10` = 10% chance |
| `bonusRemovalAmount` | `0` | Extra area (0–1 fraction) removed when a bonus removal triggers. | `0.05` = 5% extra |
| `extraLives` | `0` | Extra lives granted when the upgrade is purchased during a run. | `1` |
| `scoreInterestRate` | `0` | Fraction of current overtime balance added as interest between maps (capped at 8h). | `0.05` = 5% interest |
| `mapReductionPerFenceBonus` | `0` | Additional area fraction removed by each fence completion. | `0.05` = +5% per fence |
| `extraShopItems` | `0` | Extra item slots shown in the shop after each map. | `1` |
| `extraAugmentationPoints` | `0` | Bonus Augment Points granted on purchase. | `1` |

---

## Augment effect types

Used in `augments.yml → effect.type`. These are **separate** from the GameModifier keys above — augments have their own effect pipeline applied at the start of a run, not per-map.

| Type | Stacking | Effect |
|---|---|---|
| `ballSpeedMultiplier` | × per stack | Reduces base ball speed |
| `fenceSpeedMultiplier` | × per stack | Increases base fence construction speed |
| `parFenceBonus` | + per stack | Adds to the par cut count |
| `requiredAreaMultiplier` | × per stack | Multiplies the minimum required capture area |
| `scoreInterest` | + per stack | Adds interest rate on unused overtime between maps |
| `bounceDamping` | × per stack | Reduces ball rebound energy |
| `wallThicknessMultiplier` | × per stack | Multiplies fence thickness at the run-start level |
| `previewSpeedMultiplier` | × per stack | Slows down the wall preview growth |
| `startingLivesBonus` | + per stack | Extra lives at run start |
| `varietyMultiplier` | × per stack | Scales map variety (lower = more predictable maps) |
| `startingLevelBonus` | max across stacks | Always start runs from this level or higher |

---

## Achievement stat types

Used in:
- `achievements.yml → requirement.stat`
- `augments.yml → unlockCondition.type`

These are **lifetime cumulative stats** persisted in localStorage.

| Stat | Description |
|---|---|
| `totalFencesDrawn` | Total fences drawn across all runs |
| `highestLevelReached` | Highest level number reached in a single run |
| `totalLevelsCompletedWithoutLoss` | Total levels completed without losing a life |
| `totalLivesLost` | Total lives lost across all runs |
