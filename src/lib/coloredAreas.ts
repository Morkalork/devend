/**
 * Colored Areas: typed var/let/const lock zones (LEVELDESIGN.md).
 *
 * Every area pays its kind's multiplier to a ball locked inside, easiest
 * (biggest, by convention) to hardest (smallest): var 1.5x < let 2x < const 3x.
 * What differs is the stakes, per `ColoredArea.required`:
 * - GATE (default): the map's SOLE win path. Lock a TARGET ball inside one (boss
 *   map: the boss ball; otherwise any ball) to win; locking the target OUTSIDE
 *   fails the map (lose a life, restart).
 * - BONUS (`required: false`): the greed hook. Pays the multiplier, gates
 *   nothing; the map is won the normal way whether or not it is used.
 *
 * Pure geometry + kind lookups; the win/fail decision lives in checkBallWonState
 * + evaluateWinConditions, and rendering in the two renderers.
 */
import type { AreaKind, ColoredArea } from "@/types/level";
import { gridIndexToWorld, type SpaceGrid } from "@/lib/spaceGrid";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";

export interface AreaStyle {
  /** Centred label = the kind keyword. */
  label: string;
  /** Light fill/border colour (#rrggbb). */
  color: string;
  /** Lock-points multiplier for a ball locked inside. */
  multiplier: number;
}

export const AREA_KINDS: Record<AreaKind, AreaStyle> = {
  var:   { label: "var",   color: "#ff9ebf", multiplier: 1.5 }, // light pink
  let:   { label: "let",   color: "#ffbf80", multiplier: 2 },   // light orange
  const: { label: "const", color: "#7fe3d4", multiplier: 3 },   // light teal
};

export function areaStyle(kind: AreaKind): AreaStyle {
  return AREA_KINDS[kind] ?? AREA_KINDS.var;
}

/**
 * Starting size (square, world units) for a new area of each kind. Encodes the
 * authoring convention: var is the easiest kind so it's drawn biggest, const the
 * hardest so it's smallest.
 */
export const AREA_DEFAULT_SIZE: Record<AreaKind, number> = {
  var: 340,
  let: 260,
  const: 180,
};

/** Smallest area the editors allow: below this a ball can't be fenced in. */
export const AREA_MIN_SIZE = 100;

/**
 * A fresh area for the map editors: kind-sized, placed top-right (where the
 * level-10 boss area sits) and nudged per already-placed area so a second one
 * doesn't land exactly on the first.
 */
export function makeColoredArea(kind: AreaKind, existingCount = 0): ColoredArea {
  const size = AREA_DEFAULT_SIZE[kind];
  const offset = existingCount * 40;
  return {
    kind,
    x: Math.min(500 + offset, BOARD_WIDTH - size - 45),
    y: Math.min(45 + offset, BOARD_HEIGHT - size - 45),
    width: size,
    height: size,
  };
}

/**
 * True when an area gates the win (the default). A `required: false` area is a
 * bonus pocket: it pays, but it never decides the map.
 */
export function isGateArea(a: ColoredArea): boolean {
  return a.required !== false;
}

/** Only the areas that gate the win. Empty = the map is won the normal way. */
export function gateAreas(areas: ColoredArea[]): ColoredArea[] {
  return areas.filter(isGateArea);
}

/** True when a world point is inside the area rect (boundary counts). */
export function pointInArea(x: number, y: number, a: ColoredArea): boolean {
  return x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height;
}

/** The colored area containing a world point, or null. */
export function coloredAreaAt(x: number, y: number, areas: ColoredArea[]): ColoredArea | null {
  for (const a of areas) if (pointInArea(x, y, a)) return a;
  return null;
}

/**
 * True when EVERY cell of a region sits inside some colored area, i.e. the
 * region is fully sealed within the area(s). Early-exits on the first
 * out-of-area cell. An empty region/area set is not contained.
 * (Retained as a geometry utility; the win gate now uses regionCoversAreas.)
 */
export function regionWithinAreas(
  grid: SpaceGrid,
  cellIndices: number[],
  areas: ColoredArea[],
): boolean {
  if (areas.length === 0 || cellIndices.length === 0) return false;
  for (const idx of cellIndices) {
    const w = gridIndexToWorld(grid, idx);
    if (coloredAreaAt(w.x, w.y, areas) === null) return false;
  }
  return true;
}

/**
 * True when a locked region COVERS at least `minFraction` of the colored area's
 * cells (issue: colored-area win gate should be forgiving). The denominator is
 * the AREA, not the region: your pocket may spill outside the zone, it just has
 * to capture most of the zone. This is what settles the win gate + a fenced-in
 * boss, without the pocket having to fit entirely inside the area.
 *
 * Counts grid cells whose CENTRE lies inside an area rect as that area's cells;
 * of those, the fraction present in the region's cell set must be >= minFraction.
 */
export function regionCoversAreas(
  grid: SpaceGrid,
  cellIndices: number[],
  areas: ColoredArea[],
  minFraction: number,
): boolean {
  if (areas.length === 0 || cellIndices.length === 0) return false;
  const region = new Set(cellIndices);
  const { originX, originY, cellSize, width, height } = grid;
  let total = 0, covered = 0;
  for (const a of areas) {
    const c0 = Math.max(0, Math.floor((a.x - originX) / cellSize));
    const c1 = Math.min(width - 1, Math.floor((a.x + a.width - originX) / cellSize));
    const r0 = Math.max(0, Math.floor((a.y - originY) / cellSize));
    const r1 = Math.min(height - 1, Math.floor((a.y + a.height - originY) / cellSize));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const wx = originX + col * cellSize + cellSize / 2;
        const wy = originY + row * cellSize + cellSize / 2;
        if (!pointInArea(wx, wy, a)) continue;
        total++;
        if (region.has(row * width + col)) covered++;
      }
    }
  }
  return total > 0 && covered / total >= minFraction;
}

/** Lock-points multiplier at a world point: the max among containing areas, or 1. */
export function coloredAreaMultiplierAt(x: number, y: number, areas: ColoredArea[]): number {
  let m = 1;
  for (const a of areas) {
    if (pointInArea(x, y, a)) {
      const km = areaStyle(a.kind).multiplier;
      if (km > m) m = km;
    }
  }
  return m;
}
