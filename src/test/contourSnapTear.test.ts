/**
 * The wall snap must tidy an outline without tearing it.
 *
 * Reported from play as "artifacts on the board" after one diagonal cut on
 * level 6: the live-space outline came back with notches in it. The contour
 * itself was fine - Chaikin leaves no gap wider than a quarter cell - and the
 * damage was done by snapContoursToWalls, whose all-or-nothing projection
 * displaced one point of a neighbouring pair by nearly the whole reach and
 * left the other where it was.
 *
 * The fence here is the one from the report: anchored on level 6's gate at
 * (463,197) and running to the right board edge at (855,393).
 */
import { describe, it, expect } from "vitest";
import { createSpaceGrid, rasterizeCutToGrid } from "@/lib/spaceGrid";
import {
  traceActiveContours, snapContoursToWalls, snapPull, type ContourPoint,
} from "@/lib/rendering/regionContour";

const CELL = 15;
const REACH = CELL * 1.8;   // what boardLayer asks for
const FULL = CELL;          // where the pull stops being full strength

const BOARD = {
  vertices: [
    { x: 45, y: 45 }, { x: 855, y: 45 }, { x: 855, y: 855 }, { x: 45, y: 855 },
  ],
};
const FENCE = { start: { x: 463, y: 197 }, end: { x: 855, y: 393 } };

function cutBoard() {
  const grid = createSpaceGrid(BOARD, [], CELL);
  rasterizeCutToGrid(grid, FENCE.start, FENCE.end, 6);
  return grid;
}

function worstGap(loops: ContourPoint[][]): number {
  let worst = 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return worst;
}

describe("snapPull", () => {
  it("is full strength inside fullDist and nothing past maxDist", () => {
    expect(snapPull(0, FULL, REACH)).toBe(1);
    expect(snapPull(FULL, FULL, REACH)).toBe(1);
    expect(snapPull(REACH, FULL, REACH)).toBe(0);
    expect(snapPull(REACH + 5, FULL, REACH)).toBe(0);
  });

  it("falls monotonically across the fade, with no step at either end", () => {
    let prev = 1;
    for (let d = FULL; d <= REACH; d += 0.5) {
      const w = snapPull(d, FULL, REACH);
      expect(w).toBeLessThanOrEqual(prev + 1e-9);
      prev = w;
    }
    // Smoothstep flattens into both ends, so a quarter-cell step in distance
    // never costs more than a fraction of the pull.
    expect(snapPull(FULL + 0.5, FULL, REACH)).toBeGreaterThan(0.98);
    expect(snapPull(REACH - 0.5, FULL, REACH)).toBeLessThan(0.02);
  });

  it("collapses to the old hard cutoff when fullDist is maxDist", () => {
    expect(snapPull(REACH - 0.001, REACH, REACH)).toBe(1);
    expect(snapPull(REACH, REACH, REACH)).toBe(0);
  });
});

describe("a diagonal cut's outline", () => {
  const grid = cutBoard();
  const raw = traceActiveContours(grid);

  it("is smooth before anything snaps it", () => {
    expect(raw.length).toBeGreaterThan(0);
    expect(worstGap(raw)).toBeLessThanOrEqual(CELL * 0.26);
  });

  it("was torn by the hard cutoff", () => {
    const hard = snapContoursToWalls(raw, [FENCE], REACH, "segment");
    // The notch is as long as the reach, which is the whole complaint.
    expect(worstGap(hard)).toBeGreaterThan(REACH * 0.8);
  });

  it("stays smooth once the pull fades", () => {
    const faded = snapContoursToWalls(raw, [FENCE], REACH, "segment", FULL);
    // Under a cell, so the boundary reads as a curve rather than a notch.
    expect(worstGap(faded)).toBeLessThan(CELL);
    // And it is a real improvement, not a reach quietly turned off. The floor
    // here is the fade's own slope: pulling a point at `FULL` all the way onto
    // the wall while its neighbour a quarter cell further out is pulled less
    // has to cost something, and this is that cost.
    const hard = snapContoursToWalls(raw, [FENCE], REACH, "segment");
    expect(worstGap(faded)).toBeLessThan(worstGap(hard) / 2);
  });

  it("still lands flush on the fence, which is what the snap is for", () => {
    const faded = snapContoursToWalls(raw, [FENCE], REACH, "segment", FULL);
    const dx = FENCE.end.x - FENCE.start.x, dy = FENCE.end.y - FENCE.start.y;
    const lenSq = dx * dx + dy * dy;
    const distToFence = (p: ContourPoint) => {
      const t = Math.max(0, Math.min(1,
        ((p.x - FENCE.start.x) * dx + (p.y - FENCE.start.y) * dy) / lenSq));
      return Math.hypot(p.x - (FENCE.start.x + t * dx), p.y - (FENCE.start.y + t * dy));
    };
    // Every raw point that genuinely sat against the fence - inside the
    // full-strength band AND alongside it rather than past an end - is
    // projected exactly onto it, teeth and all. Points past an end are the
    // overshoot fade's business and are checked by the smoothness test above.
    const alongside = (p: ContourPoint) => {
      const t = ((p.x - FENCE.start.x) * dx + (p.y - FENCE.start.y) * dy) / lenSq;
      return t >= 0 && t <= 1;
    };
    const flush = raw.flat().filter(p => alongside(p) && distToFence(p) <= FULL);
    expect(flush.length).toBeGreaterThan(20);
    const after = snapContoursToWalls([flush], [FENCE], REACH, "segment", FULL)[0];
    for (const p of after) expect(distToFence(p)).toBeLessThan(1e-6);
  });

  it("leaves points beyond the reach exactly where they were", () => {
    const far = [{ x: 200, y: 700 }, { x: 500, y: 800 }];
    expect(snapContoursToWalls([far], [FENCE], REACH, "segment", FULL)[0]).toEqual(far);
  });
});
