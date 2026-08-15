/**
 * No shadows fall inside locked territory.
 *
 * A locked pocket is settled ground: the ball is sealed away and the tint is a
 * record of it. The fences bounding a pocket stand right at its edge, so their
 * shadows fall almost entirely INSIDE it, and on a small pocket that is most of
 * the tint covered in grey.
 *
 * The renderer masks the SHARED shadow plane with the board minus these
 * contours, which catches every caster at once (fences, obstacles, props,
 * balls) rather than asking each layer to remember. That makes the loops this
 * returns the whole contract, so they are what is tested here: the Pixi side is
 * a `poly()` per loop and a single even-odd fill.
 *
 * The rule that actually matters is the tier one. The lock TINT draws its loops
 * once per tier, so a double lock is covered twice and comes out brighter. The
 * MASK must not: under the even-odd rule a tier-2 loop drawn inside its own
 * tier-1 loop cancels back to visible, which would put the shadows straight
 * back into the pockets that were locked hardest, and only those.
 */
import { describe, it, expect } from "vitest";
import { traceLockContours } from "@/lib/rendering/regionContour";
import { createSpaceGrid, CellState } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import type { SpaceGrid } from "@/lib/spaceGrid";

const CELL = 15;

function grid(): SpaceGrid {
  const g = createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], CELL);
  g.lockCaptured = new Uint8Array(g.cells.length);
  return g;
}

/** Lock a rectangle of cells, `tier` balls deep, and capture them. */
function lock(g: SpaceGrid, col0: number, row0: number, cols: number, rows: number, tier = 1) {
  for (let row = row0; row < row0 + rows; row++) {
    for (let col = col0; col < col0 + cols; col++) {
      const i = row * g.width + col;
      g.lockCaptured![i] = tier;
      g.cells[i] = CellState.REMOVED;
    }
  }
}

/** Axis-aligned bounds of a loop, in world units. */
const boundsOf = (loop: { x: number; y: number }[]) => ({
  minX: Math.min(...loop.map(p => p.x)),
  maxX: Math.max(...loop.map(p => p.x)),
  minY: Math.min(...loop.map(p => p.y)),
  maxY: Math.max(...loop.map(p => p.y)),
});

describe("the region shadows are kept out of", () => {
  it("is empty on a board where nothing has been locked", () => {
    expect(traceLockContours(grid(), [])).toEqual([]);
    // Shadows then fall everywhere, which is the unmasked board.
  });

  it("is empty when the grid never tracked locks at all", () => {
    const g = createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], CELL);
    expect(traceLockContours(g, [])).toEqual([]);
  });

  it("wraps a locked pocket, and only it", () => {
    const g = grid();
    lock(g, 10, 10, 8, 8);

    const loops = traceLockContours(g, []);
    expect(loops).toHaveLength(1);

    const b = boundsOf(loops[0]);
    // Within a cell of the locked block on every side: the trace runs the cell
    // lattice, and Chaikin smoothing rounds the corners in slightly.
    expect(b.minX).toBeGreaterThanOrEqual(10 * CELL - CELL);
    expect(b.minY).toBeGreaterThanOrEqual(10 * CELL - CELL);
    expect(b.maxX).toBeLessThanOrEqual(18 * CELL + CELL);
    expect(b.maxY).toBeLessThanOrEqual(18 * CELL + CELL);
  });

  it("wraps each pocket separately when there are several", () => {
    const g = grid();
    lock(g, 5, 5, 6, 6);
    lock(g, 40, 40, 6, 6);
    expect(traceLockContours(g, [])).toHaveLength(2);
  });

  /**
   * THE rule. Tier 1 means "locked at all", so a pocket sealed with three balls
   * is ONE hole in the mask, not three nested loops that even-odd would cancel
   * back to a shadowed pocket.
   */
  it("returns one loop for a pocket however many balls were sealed in it", () => {
    for (const tier of [1, 2, 3]) {
      const g = grid();
      lock(g, 10, 10, 8, 8, tier);
      expect(traceLockContours(g, []), `tier ${tier}`).toHaveLength(1);
    }
  });

  it("covers a mixed-tier pocket with a single outline", () => {
    // A triple-locked core inside a single-locked pocket: the tint draws three
    // passes over this, the mask must draw one.
    const g = grid();
    lock(g, 10, 10, 10, 10, 1);
    lock(g, 13, 13, 4, 4, 3);

    expect(traceLockContours(g, [])).toHaveLength(1);
    // ...and the tint still sees the inner core as its own tier-3 shape.
    expect(traceLockContours(g, [], 3)).toHaveLength(1);
    expect(traceLockContours(g, [], 2)).toHaveLength(1);
  });

  it("tells the tint apart from the mask when a tier is absent", () => {
    const g = grid();
    lock(g, 10, 10, 8, 8, 1);
    expect(traceLockContours(g, [], 1)).toHaveLength(1);
    expect(traceLockContours(g, [], 2)).toEqual([]);
  });
});
