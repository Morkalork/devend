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

const FENCE_DX = FENCE.end.x - FENCE.start.x;
const FENCE_DY = FENCE.end.y - FENCE.start.y;
const FENCE_LEN_SQ = FENCE_DX * FENCE_DX + FENCE_DY * FENCE_DY;

/** Where a point sits relative to the fence: `t` along it, `d` away from it. */
function footOnFence(p: ContourPoint): { t: number; d: number } {
  const t = ((p.x - FENCE.start.x) * FENCE_DX + (p.y - FENCE.start.y) * FENCE_DY)
    / FENCE_LEN_SQ;
  return {
    t,
    d: Math.hypot(p.x - (FENCE.start.x + t * FENCE_DX),
                  p.y - (FENCE.start.y + t * FENCE_DY)),
  };
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
    // The teeth: how far a point that sits ALONGSIDE the fence ends up from it.
    // The lattice leaves them up to a cell out, and flattening that is the
    // whole reason the snap exists, so it has to survive the fade.
    let rawTooth = 0, snappedTooth = 0;
    for (let li = 0; li < raw.length; li++) {
      for (let i = 0; i < raw[li].length; i++) {
        const f = footOnFence(raw[li][i]);
        // Ends are the overshoot fade's business, not the teeth's.
        if (f.t < 0.05 || f.t > 0.95 || f.d > FULL) continue;
        rawTooth = Math.max(rawTooth, f.d);
        snappedTooth = Math.max(snappedTooth, footOnFence(faded[li][i]).d);
      }
    }
    expect(rawTooth).toBeGreaterThan(CELL * 0.9);   // the lattice really is that ragged
    expect(snappedTooth).toBeLessThan(1);           // and it comes out flat
  });

  it("keeps a correction local instead of dragging the whole loop", () => {
    const faded = snapContoursToWalls(raw, [FENCE], REACH, "segment", FULL);
    // Relaxing the displacement along the loop lets a snapped point tug its
    // immediate neighbours, which is the point of it. What must not happen is
    // that tug carrying to points with no business being moved.
    let worstFar = 0;
    for (let li = 0; li < raw.length; li++) {
      for (let i = 0; i < raw[li].length; i++) {
        if (footOnFence(raw[li][i]).d < REACH * 2) continue;
        const p = raw[li][i], q = faded[li][i];
        worstFar = Math.max(worstFar, Math.hypot(p.x - q.x, p.y - q.y));
      }
    }
    expect(worstFar).toBe(0);
  });
});

/**
 * The reported symptom, at the level it was reported: "lines regularly
 * shooting out from lock areas as they animate".
 *
 * Both flashes fill their traced contour directly, so a gap in that contour is
 * not a subtle seam - it is a filled spike that slams on and fades, which is
 * exactly what a line shooting out of a pocket looks like. This plays real maps
 * and watches every flash contour the game actually produces.
 */
import { LADDER } from "@/test/fixtures/maps";
import {
  createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock,
} from "@/lib/bot/headlessGame";

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

describe("flash contours produced in play", () => {
  it("never spike, on either the claim flash or the lock flash", () => {
    installClock();
    let worstClaim = 0, worstLock = 0, claimAt = "", lockAt = "", seen = 0;
    for (const level of LADDER.slice(0, 12)) {
      for (let seed = 1; seed <= 3; seed++) {
        const r = seeded(seed * 104729 + (level.level ?? 1) * 31);
        const ctx = createBotGame(level, level.level ?? 1, plainModifiers());
        for (let i = 0; i < 60; i++) stepBot(ctx);
        for (let c = 0; c < 6; c++) {
          const g = ctx.game as unknown as {
            levelComplete: boolean; gameOver: boolean; spaceGrid: unknown;
            claimFlashes?: { contours: ContourPoint[][] }[];
            assimilations?: Map<string, { contours?: ContourPoint[][] }>;
          };
          if (g.levelComplete || g.gameOver || !g.spaceGrid) break;
          tryCut(ctx, { x: 60 + r() * 780, y: 60 + r() * 780 },
                 r() < 0.5 ? { x: 0, y: 1 } : { x: 1, y: 0 });
          for (let i = 0; i < 300; i++) {
            stepBot(ctx);
            for (const f of g.claimFlashes ?? []) {
              const w = worstGap(f.contours);
              seen += f.contours.length;
              if (w > worstClaim) { worstClaim = w; claimAt = `L${level.level} seed ${seed}`; }
            }
            for (const a of g.assimilations?.values() ?? []) {
              if (!a.contours) continue;
              const w = worstGap(a.contours);
              seen += a.contours.length;
              if (w > worstLock) { worstLock = w; lockAt = `L${level.level} seed ${seed}`; }
            }
          }
        }
      }
    }
    releaseClock();
    // The sweep has to have actually seen flashes, or this passes by doing nothing.
    expect(seen).toBeGreaterThan(100);
    // A gap this size is a filled spike, not a seam. Before the fade and the
    // relax pass these ran to 33 (claim) and 31 (lock) on contours whose raw
    // gaps were 3.8.
    expect({ worstClaim: worstClaim < CELL, where: claimAt || "none" })
      .toEqual({ worstClaim: true, where: claimAt || "none" });
    expect({ worstLock: worstLock < CELL, where: lockAt || "none" })
      .toEqual({ worstLock: true, where: lockAt || "none" });
  });
});
