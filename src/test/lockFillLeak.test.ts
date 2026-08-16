import { describe, it, expect } from "vitest";
import { createSpaceGrid, floodRemovedEnclosure, CellState, worldToGridIndex } from "@/lib/spaceGrid";
import { createRectPolygon, pointInPolygon, type Polygon } from "@/lib/polygon";

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

/**
 * Level 11, reported from the field: "I locked a ball in the bottom right
 * corner, but it bled through and locked the upper right corner too."
 *
 * That map's `wall-1` is a rect at x 82..830 on a playable board of x 45..855,
 * so it leaves a 25-unit gap at the RIGHT board edge. A ball is 36 units
 * across and cannot fit through 25 - which is why sealing the bottom right
 * legitimately locks - but the gap is 1.7 CELLS wide and carries no wall
 * segment, so the flood strolls through it into the space above.
 *
 * This is the leak above with real numbers rather than invented ones, and it
 * shows the bound is doing the load-bearing work on a shipped map.
 */
function levelElevenRightGap() {
  const grid = createSpaceGrid(createRectPolygon(45, 45, 855, 855), [], 15);
  grid.cells.fill(CellState.REMOVED);
  // The board edges plus wall-1's outline. The wall's right edge stops at
  // x=830, so nothing spans 830..855.
  const walls = [
    { start: { x: 45, y: 45 }, end: { x: 855, y: 45 } },
    { start: { x: 855, y: 45 }, end: { x: 855, y: 855 } },
    { start: { x: 855, y: 855 }, end: { x: 45, y: 855 } },
    { start: { x: 45, y: 855 }, end: { x: 45, y: 45 } },
    { start: { x: 82, y: 350 }, end: { x: 830, y: 350 } },
    { start: { x: 830, y: 350 }, end: { x: 830, y: 550 } },
    { start: { x: 830, y: 550 }, end: { x: 82, y: 550 } },
    { start: { x: 82, y: 550 }, end: { x: 82, y: 350 } },
  ];
  // The player's fence, sealing the bottom-right corner: vertical at x=700
  // from the wall's underside down to the board edge. The pocket is then
  // closed on all sides EXCEPT the 25-unit slit at x 830..855 leading up past
  // the wall's end - the same shape as the reported map.
  //
  // Note the wall's LEFT gap (x 45..82) is 37 units and a ball DOES fit
  // through it, so without this fence the flood reaches the top legitimately
  // by going the long way round, and the slit proves nothing.
  walls.push({ start: { x: 700, y: 550 }, end: { x: 700, y: 855 } });
  const seeds = [worldToGridIndex(grid, 800, 700)];
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

  it("a bounding box contains the leak WITHOUT starving the fill", () => {
    const { grid, walls, seeds } = leakyBoard();
    const seedRow = (seeds[0] / grid.width) | 0;
    const seedCol = seeds[0] % grid.width;
    // A box around the pocket. The flood may roam anywhere inside it - which is
    // what fills triangular corners and crevices - but cannot leave it, so the
    // gap at the far end leads nowhere.
    const reached = floodRemovedEnclosure(grid, seeds, walls, {
      bounds: {
        minCol: seedCol - 3, maxCol: seedCol + 3,
        minRow: seedRow - 3, maxRow: seedRow + 3,
      },
    });
    // Fills the whole 7x7 box (far more than a depth cap would reach)...
    expect(reached.size).toBe(49);
    // ...and nothing outside it: every cell is within the box.
    for (const idx of reached) {
      const r = (idx / grid.width) | 0;
      const c = idx % grid.width;
      expect(Math.abs(r - seedRow)).toBeLessThanOrEqual(3);
      expect(Math.abs(c - seedCol)).toBeLessThanOrEqual(3);
    }
  });


  it("leaks past level 11's 25-unit right gap when unbounded", () => {
    const { grid, walls, seeds } = levelElevenRightGap();
    const reached = floodRemovedEnclosure(grid, seeds, walls);
    // Above the wall is the "upper right corner" the report describes.
    const aboveWall = worldToGridIndex(grid, 800, 200);
    expect(reached.has(aboveWall)).toBe(true);
  });

  // The structural fix: the slit is 25 units and a ball is 36, so the flood is
  // refused at the throat itself rather than merely fenced in by a box drawn
  // around the pocket. This holds with NO bounds at all.
  it("the throat gate blocks the leak with no bounding box at all", () => {
    const { grid, walls, seeds } = levelElevenRightGap();
    const reached = floodRemovedEnclosure(grid, seeds, walls, { minThroatWidth: 36 });
    expect(reached.has(worldToGridIndex(grid, 800, 200))).toBe(false);
    // ...while still filling the pocket it was actually sealed in, right up to
    // the fence and the board corner.
    expect(reached.has(worldToGridIndex(grid, 750, 800))).toBe(true);
    expect(reached.has(worldToGridIndex(grid, 840, 840))).toBe(true);
  });

  it("a ball small enough to use the slit is not walled off by it", () => {
    const { grid, walls, seeds } = levelElevenRightGap();
    // 20-unit ball fits through the 25-unit gap, so that route is legitimately
    // open and the fill must follow it rather than inventing a barrier.
    const reached = floodRemovedEnclosure(grid, seeds, walls, { minThroatWidth: 20 });
    expect(reached.has(worldToGridIndex(grid, 800, 200))).toBe(true);
  });

  it("the pocket's bounding box keeps the fill out of the upper right", () => {
    const { grid, walls, seeds } = levelElevenRightGap();
    const seedRow = (seeds[0] / grid.width) | 0;
    const seedCol = seeds[0] % grid.width;
    const reached = floodRemovedEnclosure(grid, seeds, walls, {
      bounds: {
        minCol: seedCol - 2, maxCol: seedCol + 2,
        minRow: seedRow - 2, maxRow: seedRow + 2,
      },
    });
    expect(reached.has(worldToGridIndex(grid, 800, 200))).toBe(false);
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

/**
 * The unfilled triangular tip.
 *
 * `minThroatWidth` refuses any step through a gap narrower than a ball, which
 * is what stops the fill walking through a slit into a chamber the ball could
 * never have reached. It also, unavoidably, refuses to walk INTO the tapering
 * end of the pocket it is already in: past the point where the pocket narrows
 * below a ball's width, the fill simply stopped, and the tip stayed dark. A
 * fixed two-cell dilation covered the shallowest cases and nothing more, so a
 * long taper stayed visibly hollow, most obviously while the lock flash played.
 *
 * A tip and a slit are not told apart by distance, but by whether the space
 * opens back out. A tip only ever gets narrower.
 */
function wedgeBoard(apexHalfAngleTan: number) {
  const grid = createSpaceGrid(createRectPolygon(0, 0, 600, 600), [], 15);
  grid.cells.fill(CellState.REMOVED);
  // A wedge with its apex at (60,300), opening rightwards: two walls that
  // converge, sealed across the wide end so the only way on is the taper.
  const apex = { x: 60, y: 300 };
  const far = 540;
  const spread = (far - apex.x) * apexHalfAngleTan;
  const walls = [
    { start: apex, end: { x: far, y: 300 - spread } },
    { start: apex, end: { x: far, y: 300 + spread } },
    { start: { x: far, y: 300 - spread }, end: { x: far, y: 300 + spread } },
  ];
  const wedge: Polygon = {
    vertices: [apex, { x: far, y: 300 - spread }, { x: far, y: 300 + spread }],
  };
  // Seeded in the wide end, where a ball comfortably fits.
  const seeds = [worldToGridIndex(grid, 480, 300)];
  return { grid, walls, seeds, wedge };
}

describe("filling a tapering pocket", () => {
  const BALL_DIAMETER = 36;

  /**
   * Every cell of the wedge, by its own geometry: the cells whose centres lie
   * inside it. Asserting against this rather than a list of coordinates states
   * the actual contract (the pocket is filled, all of it) and stays honest
   * about the lattice: where the wedge is thinner than a cell, no cell centre
   * is inside it, and there is nothing there to fill.
   */
  const cellsInside = (grid: ReturnType<typeof createSpaceGrid>, poly: Polygon) => {
    const out: number[] = [];
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const p = {
          x: grid.originX + (col + 0.5) * grid.cellSize,
          y: grid.originY + (row + 0.5) * grid.cellSize,
        };
        if (pointInPolygon(p, poly)) out.push(row * grid.width + col);
      }
    }
    return out;
  };

  it("fills right into the apex, past where a ball stops fitting", () => {
    const { grid, walls, seeds, wedge } = wedgeBoard(0.35);
    const reached = floodRemovedEnclosure(grid, seeds, walls, {
      minThroatWidth: BALL_DIAMETER,
    });

    const inside = cellsInside(grid, wedge);
    expect(inside.length).toBeGreaterThan(20);
    const missed = inside.filter(i => !reached.has(i));
    expect(missed, `${missed.length} of ${inside.length} pocket cells unfilled`).toEqual([]);
  });

  it("fills a very shallow taper, where a fixed dilation runs out", () => {
    // Half-angle ~7 degrees: the pocket stays under a ball wide for 15+ cells,
    // far past the two-cell dilation that used to be the only thing reaching in.
    const { grid, walls, seeds, wedge } = wedgeBoard(0.12);
    const reached = floodRemovedEnclosure(grid, seeds, walls, {
      minThroatWidth: BALL_DIAMETER,
    });

    const inside = cellsInside(grid, wedge);
    const missed = inside.filter(i => !reached.has(i));
    expect(missed, `${missed.length} of ${inside.length} pocket cells unfilled`).toEqual([]);
    // And it really does reach well beyond a two-cell dilation of the wide part.
    expect(reached.has(worldToGridIndex(grid, 150, 300))).toBe(true);
  });

  /**
   * The other half of the contract, on the shape this gate was built for: a
   * 25-unit slit past a wall's end. Filling tapers must not reopen that.
   * (leakyBoard is no use here: its gap is 90 units, wide enough for the ball,
   * so that pocket genuinely does connect.)
   */
  it("still refuses the room on the far side of a slit", () => {
    const { grid, walls, seeds } = levelElevenRightGap();
    const reached = floodRemovedEnclosure(grid, seeds, walls, {
      minThroatWidth: BALL_DIAMETER,
    });
    expect(reached.has(worldToGridIndex(grid, 800, 200))).toBe(false);
    expect(reached.size).toBeLessThan(grid.cells.length * 0.5);
  });
});
