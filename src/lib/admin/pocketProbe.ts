/**
 * What a map offers the fence before anything has moved: the smallest pocket a
 * single straight cut closes, and how much of the board has room to draw.
 *
 * Two items from the authoring checklist that used to be eyeballed and are
 * arithmetic over the authored geometry:
 *
 *   - "At least one pocket is superior-lock-sized, measured against the worst
 *     denominator." A superior lock is the lock economy's precision reward, and
 *     a map offers it by design when some nook closes with ONE fence into a
 *     pocket small enough to grade. Two fences can box any corner of any map,
 *     so the one-cut pocket is the one the map authored.
 *   - "There are open drawing lanes everywhere a cut is expected." A maze of
 *     walls leaves ground where every fence you could start is too short to
 *     shape anything.
 *
 * Measured the way the game does it rather than reasoned about: every straight
 * fence a player could start from an open spot, on both axes, traced with the
 * same castRayWithReflections the input layer uses (so a mirror bends it), then
 * rasterised onto a copy of the grid and the regions read back fresh.
 */
import { castRayWithReflections, WALL_THICKNESS, type Wall } from "@/lib/wallGeometry";
import {
  CellState, rasterizeCutToGrid, findGridRegions, worldToGridIndex,
  exportGridRegionIdCounter, importGridRegionIdCounter, type SpaceGrid,
} from "@/lib/spaceGrid";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";

/** The shipped superior fraction (scoring-config lockQuality), for when no config is loaded. */
export const DEFAULT_SUPERIOR_FRACTION = 0.4;
/** A fence shorter than this through a spot shapes nothing worth having there. */
export const LANE_MIN_LENGTH = 90;
/** How far apart the probe starts fences, in world units: one grid cell. */
const STEP = 15;

export interface PocketProbe {
  /** Smallest region one fence closes that a ball can sit in, as % of the board; null if none. */
  smallestPocketPercent: number | null;
  /** Its middle, for pointing at it in the builder. */
  smallestPocketAt: { x: number; y: number } | null;
  /** The superior bar at the START of the map (denominator: the whole board). */
  superiorAtStartPercent: number;
  /** ...and at the worst denominator the lock rule reaches (the board over maxBalls). */
  superiorAtWorstPercent: number;
  /** Share of open ground (0-100) with a fence of LANE_MIN_LENGTH or more through it. */
  lanePercent: number;
}

/** Is there a 5x5 block of the region around this cell, so a ball's centre fits? */
function ballFits(grid: SpaceGrid, cells: Set<number>, idx: number): boolean {
  const row = Math.floor(idx / grid.width), col = idx % grid.width;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = row + dr, c = col + dc;
      if (r < 0 || c < 0 || r >= grid.height || c >= grid.width) return false;
      if (!cells.has(r * grid.width + c)) return false;
    }
  }
  return true;
}

export function probePockets(
  board: { walls: Wall[]; spaceGrid: SpaceGrid },
  maxBalls: number,
  superiorFraction: number = DEFAULT_SUPERIOR_FRACTION,
): PocketProbe {
  const grid = board.spaceGrid;
  const bar = BALL_WON_REGION_THRESHOLD * (superiorFraction > 0 ? superiorFraction : DEFAULT_SUPERIOR_FRACTION);

  type Seg = { start: { x: number; y: number }; end: { x: number; y: number } };
  const fences = new Map<string, Seg[]>();
  const longest = new Map<number, number>();

  const x0 = grid.originX + STEP / 2, y0 = grid.originY + STEP / 2;
  const x1 = grid.originX + grid.width * grid.cellSize, y1 = grid.originY + grid.height * grid.cellSize;
  for (let y = y0; y < y1; y += STEP) {
    for (let x = x0; x < x1; x += STEP) {
      const idx = worldToGridIndex(grid, x, y);
      if (idx < 0 || grid.cells[idx] !== CellState.ACTIVE) continue;
      for (const d of [{ x: 1, y: 0 }, { x: 0, y: 1 }]) {
        const fwd = castRayWithReflections({ x, y }, d, board.walls);
        const back = castRayWithReflections({ x, y }, { x: -d.x, y: -d.y }, board.walls);
        if (!fwd || !back) continue;
        // Without the origin: it sits on the straight run between the two
        // halves, and keeping it made every starting spot a "different" fence
        // (five thousand a map, where a few hundred are really distinct).
        const pts = [...back.waypoints.slice(1).reverse(), ...fwd.waypoints.slice(1)];
        const segs: Seg[] = [];
        let len = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          segs.push({ start: pts[i], end: pts[i + 1] });
          len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        }
        longest.set(idx, Math.max(longest.get(idx) ?? 0, len));
        const key = pts.map(p => `${Math.round(p.x / 5)},${Math.round(p.y / 5)}`).join("|");
        if (!fences.has(key)) fences.set(key, segs);
      }
    }
  }

  // Reading regions bumps the id counter; a probe must not renumber the board.
  const counter = exportGridRegionIdCounter();
  let best: { cells: number; at: { x: number; y: number } } | null = null;
  try {
    for (const segs of fences.values()) {
      const after: SpaceGrid = { ...grid, cells: Uint8Array.from(grid.cells), cellRegionIds: [...grid.cellRegionIds] };
      for (const s of segs) rasterizeCutToGrid(after, s.start, s.end, WALL_THICKNESS);
      const regions = findGridRegions(after).sort((a, b) => b.cellIndices.length - a.cellIndices.length);
      // The largest is the board the cut left behind; everything else it closed.
      for (const r of regions.slice(1)) {
        if (best && r.cellIndices.length >= best.cells) continue;
        const set = new Set(r.cellIndices);
        if (!r.cellIndices.some(i => ballFits(after, set, i))) continue;
        best = { cells: r.cellIndices.length, at: r.centroid };
      }
    }
  } finally {
    importGridRegionIdCounter(counter);
  }

  const lanes = [...longest.values()];
  const init = Math.max(1, grid.initialActiveCount);
  return {
    smallestPocketPercent: best ? (100 * best.cells) / init : null,
    smallestPocketAt: best?.at ?? null,
    superiorAtStartPercent: bar,
    superiorAtWorstPercent: bar / Math.max(1, maxBalls),
    lanePercent: lanes.length === 0 ? 0 : (100 * lanes.filter(v => v >= LANE_MIN_LENGTH).length) / lanes.length,
  };
}
