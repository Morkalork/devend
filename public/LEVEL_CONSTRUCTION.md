# Level Construction Guide

This document describes how to construct levels for Ball Breaker using the `map.yml` configuration file.

## Overview

Levels are defined in `/public/map.yml` using YAML syntax. The game board has fixed dimensions:
- **BOARD_WIDTH**: 900 world units
- **BOARD_HEIGHT**: 1600 world units

All coordinates and sizes in the level configuration use these world units.

---

## Level Structure

```yaml
levels:
  - id: "level-1"
    backgroundColor: "1a1a2e"
    rectangleColor: "ffffff"
    sizeThreshold: 40
    expectedCuts: 3
    points: 100
    balls:
      - id: "ball-1"
        initialSpeed: 300
        topSpeed: 600
        color: "00d4ff"
    entities:
      - id: "obs-1"
        kind: "obstacle"
        shape: "rect"
        x: 350
        y: 600
        width: 200
        height: 200
```

---

## Level Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | ✅ | Unique identifier for the level (e.g., "level-1") |
| `backgroundColor` | string | ✅ | 6-character hex color without `#` for the darkness/background |
| `rectangleColor` | string | ✅ | 6-character hex color without `#` for the playable region fill |
| `sizeThreshold` | number | ✅ | Win condition: remaining area must be below this percentage (e.g., 40 means win when < 40% remains) |
| `expectedCuts` | number | ✅ | Expected number of cuts to complete the level (used for scoring) |
| `points` | number | ✅ | Base points awarded for completing the level |
| `balls` | array | ✅ | Array of ball configurations (see Ball Properties) |
| `entities` | array | ❌ | Optional array of entities like obstacles (see Entity Properties) |

### Validation Rules
- `expectedCuts` must be less than `points`
- `sizeThreshold` is typically between 20-50

---

## Ball Properties

Each ball in the `balls` array has the following properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | ✅ | Unique identifier for the ball within the level |
| `initialSpeed` | number | ✅ | Starting speed in world units per second (typical range: 300-450) |
| `topSpeed` | number | ✅ | Maximum speed the ball can reach after cuts (typical range: 600-900) |
| `color` | string | ✅ | 6-character hex color without `#` for the ball |

### Ball Behavior
- Balls spawn near the center of the playable region
- After each successful cut that removes area, all balls speed up by 3%
- Ball speed is capped at `topSpeed`
- Higher level numbers apply a speed multiplier (6% increase per level)

---

## Entity Properties

Entities allow you to add obstacles and other elements to levels. Currently supported:

### Base Entity Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | ✅ | Unique identifier for the entity |
| `kind` | string | ✅ | Entity type: `"obstacle"` (more kinds planned) |
| `shape` | string | ✅ | Shape type: `"rect"` or `"polygon"` |

### Obstacle Entity (`kind: "obstacle"`)

Obstacles carve away playable space from the board. Players cannot cut through obstacles, and balls bounce off obstacle boundaries.

#### Rectangle Shape (`shape: "rect"`)

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `x` | number | ✅ | Left edge X coordinate in world units (0-900) |
| `y` | number | ✅ | Top edge Y coordinate in world units (0-1600) |
| `width` | number | ✅ | Width in world units |
| `height` | number | ✅ | Height in world units |

Example:
```yaml
entities:
  - id: "wall-1"
    kind: "obstacle"
    shape: "rect"
    x: 100
    y: 400
    width: 150
    height: 300
```

#### Polygon Shape (`shape: "polygon"`)

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `points` | array | ✅ | Array of [x, y] coordinate pairs defining vertices (minimum 3 points) |

Example:
```yaml
entities:
  - id: "triangle-1"
    kind: "obstacle"
    shape: "polygon"
    points:
      - [450, 700]
      - [550, 750]
      - [500, 900]
```

### Obstacle Behavior
- Obstacles are rendered in red with a darker red stroke
- The initial playable area is calculated AFTER subtracting obstacle areas
- Win percentage is based on the playable area (not including obstacle space)
- Obstacles should be placed within the playable arena (roughly 45-855 X, 80-1520 Y considering margins)

---

## Coordinate System

```
(0,0) ────────────────────────── (900,0)
  │                                  │
  │         BOARD AREA               │
  │                                  │
  │    ┌─────────────────────┐       │
  │    │                     │       │
  │    │   PLAYABLE ARENA    │       │
  │    │   (with 5% margin)  │       │
  │    │                     │       │
  │    │                     │       │
  │    └─────────────────────┘       │
  │                                  │
(0,1600) ────────────────────── (900,1600)
```

- Origin (0,0) is top-left
- X increases to the right
- Y increases downward
- The playable arena has a 5% margin from board edges

---

## Difficulty Progression Tips

1. **Early levels (1-2)**: 1-2 balls, higher thresholds (35-40%), fewer expected cuts
2. **Mid levels (3-4)**: 2-3 balls, add simple obstacles, lower thresholds (30-35%)
3. **Late levels (5+)**: 3+ balls, complex obstacle patterns, low thresholds (20-30%)

### Speed Guidelines
- Level 1: initialSpeed ~300, topSpeed ~600
- Level 3: initialSpeed ~360-380, topSpeed ~720-750
- Level 5: initialSpeed ~400-420, topSpeed ~810-850

---

## Future Entity Kinds (Planned)

The entity system is extensible. Potential future kinds:
- `spawner` - Creates new balls during gameplay
- `hazard` - Zones that cause instant game over if touched
- `powerup` - Collectible items that grant bonuses
- `portal` - Teleports balls between locations

---

## Example: Complete Level

```yaml
- id: "level-4"
  backgroundColor: "1a1a40"
  rectangleColor: "ffffff"
  sizeThreshold: 30
  expectedCuts: 8
  points: 250
  balls:
    - id: "ball-1"
      initialSpeed: 400
      topSpeed: 800
      color: "ff8c42"
    - id: "ball-2"
      initialSpeed: 380
      topSpeed: 780
      color: "98d8c8"
    - id: "ball-3"
      initialSpeed: 360
      topSpeed: 760
      color: "c792ea"
  entities:
    - id: "obs-1"
      kind: "obstacle"
      shape: "rect"
      x: 100
      y: 400
      width: 150
      height: 300
    - id: "obs-2"
      kind: "obstacle"
      shape: "rect"
      x: 650
      y: 900
      width: 150
      height: 300
```
