/**
 * Colored Areas: typed, required win-gate zones (LEVELDESIGN.md).
 *
 * A map with colored areas is won by locking a TARGET ball inside one (boss map:
 * the boss ball; otherwise any ball). Locking the target OUTSIDE fails the map
 * (lose a life, restart). Locking inside also pays the kind's multiplier. Three
 * kinds, easiest (biggest, by convention) to hardest (smallest):
 *   var 1.5x < let 2x < const 3x.
 *
 * Pure geometry + kind lookups; the win/fail decision lives in checkBallWonState
 * + evaluateWinConditions, and rendering in the two renderers.
 */
import type { AreaKind, ColoredArea } from "@/types/level";
import { gridIndexToWorld, type SpaceGrid } from "@/lib/spaceGrid";

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
 * region is fully sealed within the area(s). Used by the boss win gate: fencing
 * the boss into the area ships it, no shrink-to-lock needed (LEVELDESIGN.md /
 * issue #56). Early-exits on the first out-of-area cell, so it is cheap while
 * the region still spans the board. An empty region/area set is not contained.
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
