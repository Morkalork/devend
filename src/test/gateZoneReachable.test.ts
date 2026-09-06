/**
 * A gate zone you can no longer get to ends the map.
 *
 * Reported with a screenshot of level 8: two balls still bouncing, the `var`
 * zone fenced away in ground they could not enter any more, 41% still to clear,
 * and the map running on. Nothing was going to happen. Eventually the clock ran
 * out and the game said so - true, and useless, because the map had been over
 * for several cuts by then.
 *
 * The guard existed and asked the wrong question. `anyGateTargetInPlay` asks
 * whether a target is ALIVE, and a live ball is not a ball that can get there.
 *
 * ── Why "shares a region with the zone" is the whole test ──────────────────
 *
 * A ball cannot cross into another region; that is the game. A cut only SPLITS
 * the region it is in, so every region a ball can ever be in is a subset of the
 * one it is in now. And every way a lock can count for a zone (areaForLock: the
 * ball inside it, the pocket within it, the pocket covering enough of it) needs
 * the locked region to hold at least one cell of that zone.
 *
 * ── The direction the doubts have to fall ──────────────────────────────────
 *
 * This costs a life, so a false positive takes a map that was still winnable.
 * Claimed ground is a fact; unpainted cells and a ball whose cell has no owner
 * are the paint declining to answer, and not knowing is never a reason to end
 * someone's map.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CellState, type SpaceGrid } from "@/lib/spaceGrid";
import {
  anyGateTargetCanReach, gateTargets, areaCellIndices,
} from "@/lib/coloredAreas";
import type { ColoredArea } from "@/types/level";

const CELL = 15;
const W = 20, H = 10;

/**
 * Two rooms with a claimed strip between them, which is the reported board in
 * miniature: cols 0-8 are "left", cols 12-19 are "right", and 9-11 are gone.
 */
function board(): SpaceGrid {
  const cells = new Uint8Array(W * H).fill(CellState.ACTIVE);
  const ids = new Array<string | null>(W * H).fill(null);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = row * W + col;
      if (col >= 9 && col <= 11) { cells[i] = CellState.REMOVED; continue; }
      ids[i] = col < 9 ? "left" : "right";
    }
  }
  return {
    cellSize: CELL, width: W, height: H, originX: 0, originY: 0,
    cells, initialActiveCount: W * H, activeCount: W * H, cellRegionIds: ids,
  } as SpaceGrid;
}

/** The zone, sitting entirely in the right-hand room (cols 14-18, rows 2-6). */
const ZONE: ColoredArea = { x: 210, y: 30, width: 75, height: 75, kind: "var" };

/** A ball at the centre of a cell. */
type Probe = { state: string; isBoss?: boolean; position: { x: number; y: number } };
const at = (col: number, row: number, state = "active"): Probe =>
  ({ state, position: { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 } });

const IN_LEFT = at(4, 5);
const IN_RIGHT = at(16, 4);

describe("the zone's cells", () => {
  it("are the cells whose centre is inside it", () => {
    const cells = areaCellIndices(board(), [ZONE]);
    expect(cells.length).toBe(5 * 5);              // cols 14-18 x rows 2-6
    for (const idx of cells) {
      const col = idx % W, row = Math.floor(idx / W);
      expect(col).toBeGreaterThanOrEqual(14);
      expect(col).toBeLessThanOrEqual(18);
      expect(row).toBeGreaterThanOrEqual(2);
      expect(row).toBeLessThanOrEqual(6);
    }
  });
});

describe("the reported board", () => {
  it("is over, and now says so", () => {
    expect(anyGateTargetCanReach(board(), [IN_LEFT], [ZONE])).toBe(false);
  });

  it("used to read as playable, which is the bug", () => {
    // The guard that shipped asked only whether a target was ALIVE, which on
    // this board is yes, forever, while nothing can happen. Asserted against
    // the roster the old predicate was a bare length check on, so the fixture
    // is proved to reproduce the report rather than merely to fail somewhere.
    expect(gateTargets([IN_LEFT]).length > 0, "the fixture does not reproduce the report")
      .toBe(true);
  });

  it("is still playable from the room the zone is in", () => {
    expect(anyGateTargetCanReach(board(), [IN_RIGHT], [ZONE])).toBe(true);
  });

  it("needs only ONE target that can still get there", () => {
    expect(anyGateTargetCanReach(board(), [IN_LEFT, IN_RIGHT], [ZONE])).toBe(true);
  });

  it("counts a locked-away ball as gone, wherever it was standing", () => {
    expect(anyGateTargetCanReach(board(), [{ ...IN_RIGHT, state: "won" }], [ZONE])).toBe(false);
  });

  it("counts a dormant or frozen target as able, since it has not played yet", () => {
    // A circuit sleeper waiting to be woken, or a ball held by a Breakpoint.
    // Reading these as gone made a gate map lose on its first frame once.
    expect(anyGateTargetCanReach(board(), [at(16, 4, "dormant")], [ZONE])).toBe(true);
  });
});

describe("claimed ground", () => {
  it("ends it even with a ball in what is left of the room", () => {
    // The zone itself has been captured. Nobody can lock in there again, so the
    // room the zone used to be in no longer helps.
    const grid = board();
    for (const idx of areaCellIndices(grid, [ZONE])) grid.cells[idx] = CellState.REMOVED;
    expect(anyGateTargetCanReach(grid, [IN_RIGHT], [ZONE])).toBe(false);
  });

  it("is judged per zone, so a map with a live one keeps going", () => {
    const grid = board();
    for (const idx of areaCellIndices(grid, [ZONE])) grid.cells[idx] = CellState.REMOVED;
    const alsoLeft: ColoredArea = { x: 30, y: 30, width: 75, height: 75, kind: "let" };
    expect(anyGateTargetCanReach(grid, [IN_LEFT], [ZONE, alsoLeft])).toBe(true);
  });
});

describe("every uncertainty keeps the map alive", () => {
  it("says nothing when the zone's cells have no painted owner", () => {
    // Open ground the paint has no opinion about. Believing it would end a map
    // on a bookkeeping gap.
    const grid = board();
    for (const idx of areaCellIndices(grid, [ZONE])) grid.cellRegionIds[idx] = null;
    expect(anyGateTargetCanReach(grid, [IN_LEFT], [ZONE])).toBe(true);
  });

  it("says nothing when a ball stands on a cell with no owner", () => {
    // Balls sit on removed cells routinely: a hair over a wall, a mirror edge.
    expect(anyGateTargetCanReach(board(), [at(10, 5)], [ZONE])).toBe(true);
  });

  it("says nothing when a ball is off the grid entirely", () => {
    expect(anyGateTargetCanReach(board(), [{ state: "active", position: { x: -50, y: -50 } }], [ZONE]))
      .toBe(true);
  });

  it("says nothing about a map with no gate zone at all", () => {
    expect(anyGateTargetCanReach(board(), [IN_LEFT], [])).toBe(true);
  });
});

describe("a boss map", () => {
  const boss = { ...at(16, 4), isBoss: true };
  const minion = { ...IN_LEFT };

  it("asks only about the boss, since only the boss satisfies the gate", () => {
    // A minion in the right room would otherwise keep a stranded boss map open.
    expect(gateTargets([boss, minion]).map(b => b.isBoss)).toEqual([true]);
    expect(anyGateTargetCanReach(board(), [{ ...boss, position: IN_LEFT.position }, at(16, 4)], [ZONE]))
      .toBe(false);
  });

  it("is playable while the boss can still get there", () => {
    expect(anyGateTargetCanReach(board(), [boss, minion], [ZONE])).toBe(true);
  });
});

describe("the wiring", () => {
  it("is the guard the win check actually runs", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/physics/applyCut.ts"), "utf8");
    // Zones read off the LEVEL, the same place the clause being tested came
    // from. The runtime copy is assigned by the canvas and not by initGame, so
    // sourcing from it made "no zones" mean "keep playing" - the guard turning
    // itself off, which is how this landed as a green test suite and a broken
    // guard the first time.
    expect(src).toMatch(
      /if \(!anyGateTargetCanReach\(game\.spaceGrid, game\.balls, gateAreas\(level\.coloredAreas \?\? \[\]\)\)\)/);
    expect(src, "the alive-only guard is back in the win check")
      .not.toMatch(/anyGateTargetInPlay\(game\.balls\)/);
  });
});
