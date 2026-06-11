# Modifier & Configuration Reference

This document covers every modifier key, effect type, stat, and field that can be used when editing the YAML configuration files.

---

## Table of Contents

1. [upgrades.yml](#upgradesyml)
2. [certificates.yml](#certificatesyml)
3. [achievements.yml](#achievementsyml)
4. [map.yml](#mapyml)
5. [GameModifiers — shared modifier keys](#gamemodifiers--shared-modifier-keys)
6. [Achievement stat types](#achievement-stat-types)

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

## certificates.yml

Permanent meta-progression bonuses bought between runs in the Certificate Store with **Certificate Hours** (earned at one hour per 5 completed levels, banked when the run ends).

A certificate must first be **unlocked**, then its levels are bought one at a time. Each owned level applies its effect permanently to every run.

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique identifier |
| `name` | string | ✓ | Display name |
| `description` | string | ✓ | Shown in the certificate store |
| `unlockType` | string | ✓ | `upgrade-chain` or `achievement` |
| `sourceUpgradeId` | string | for `upgrade-chain` | Buying this upgrade (a max-tier one) in `requiredRuns` separate runs unlocks the certificate |
| `requiredRuns` | number | | Number of separate runs required (default: 3) |
| `sourceAchievementId` | string | for `achievement` | Completing this achievement unlocks the certificate |
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
| `extraShopItems` | `0` | Extra item slots shown in the shop after each map. | `1` |
| `extraCertificateHours` | `0` | Bonus Certificate Hours. ⚠ Defined but **not yet consumed** by the run-end payout (`finalizeRun` in `useCertificateManager`) — the Certification Wizard upgrade currently has no effect. | `1` |

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
