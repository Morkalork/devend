import { describe, it, expect } from "vitest";
import { createSpaceGrid, floodRemovedEnclosure, CellState, worldToGridIndex } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";

/**
 * The long-standing "lock fill bleeds into all the space outside".
 *
 * The flood is stopped only where a wall SEGMENT physically lies between two
 * cell centres. A pocket closed off by a gap narrower than the ball has no
 * segment across that gap - the ball cannot escape, so the lock is legitimate,
 * but the cell-level flood walks straight through it and consumes every REMOVED
 * cell on the board.
 *
 * Geometry below: a 300x300 board whose cells are all REMOVED, with a wall
 * sealing off a small top-left pocket EXCEPT for a gap at the far end.
 */
function leakyBoard() {
  const grid = createSpaceGrid(createRectPolygon(0, 0, 300, 300), [], 15);
  grid.cells.fill(CellState.REMOVED);
  // A vertical wall at x=90 running from the top down to y=210, leaving 90
  // units of open gap below it: no segment lies across that gap.
  const walls = [
    { start: { x: 90, y: 0 }, end: { x: 90, y: 210 } },
    { start: { x: 0, y: 0 }, end: { x: 90, y: 0 } },
  ];
  const seeds = [worldToGridIndex(grid, 30, 30)];
  return { grid, walls, seeds };
}

describe("lock fill containment", () => {
  it("unbounded, the flood escapes the pocket and takes the whole board", () => {
    const { grid, walls, seeds } = leakyBoard();
    const reached = floodRemovedEnclosure(grid, seeds, walls);
    // Demonstrates the underlying leak: it reaches essentially everything.
    expect(reached.size).toBeGreaterThan(grid.cells.length * 0.8);
  });

  it("with a cell budget it refuses to leak and falls back to the seeds", () => {
    const { grid, walls, seeds } = leakyBoard();
    const reached = floodRemovedEnclosure(grid, seeds, walls, { maxCells: 60 });
    // Overflow => seeds only. Never a partial spill into outside space.
    expect(reached.size).toBe(seeds.length);
    expect([...reached]).toEqual(seeds);
  });

  it("a depth cap keeps the reclaim to the band around the seeds", () => {
    const { grid, walls, seeds } = leakyBoard();
    const reached = floodRemovedEnclosure(grid, seeds, walls, { maxDepth: 2 });
    // A depth-2 dilation of one cell can only ever be a small neighbourhood.
    expect(reached.size).toBeLessThanOrEqual(13);
    expect(reached.has(seeds[0])).toBe(true);
  });

  it("still fills a genuinely sealed chamber under its budget", () => {
    const grid = createSpaceGrid(createRectPolygon(0, 0, 300, 300), [], 15);
    grid.cells.fill(CellState.REMOVED);
    // Sealed top-left box. The walls must run PAST the board bounds: the grid is
    // padded a cell beyond the polygon (origin -15 here), and walls stopping at
    // 0 leave the flood a way around their ends through that padding ring - a
    // false "leak" that has nothing to do with the gap being tested.
    const walls = [
      { start: { x: 90, y: -30 }, end: { x: 90, y: 90 } },
      { start: { x: -30, y: 90 }, end: { x: 90, y: 90 } },
    ];
    const seeds = [worldToGridIndex(grid, 30, 30)];
    const reached = floodRemovedEnclosure(grid, seeds, walls, { maxCells: 400 });
    // 7x7 cells (the padding ring is inside the sealed corner): the whole
    // chamber, and nothing past it.
    expect(reached.size).toBe(49);
  });
});
