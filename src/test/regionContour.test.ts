import { describe, it, expect } from "vitest";
import { SpaceGrid, CellState } from "@/lib/spaceGrid";
import { traceActiveContours, traceContours, snapContoursToWalls } from "@/lib/rendering/regionContour";

/** Build a SpaceGrid from an ASCII map: '#' = ACTIVE, '.' = REMOVED. */
function makeGrid(rows: string[], cellSize = 15, originX = 0, originY = 0): SpaceGrid {
  const height = rows.length;
  const width = rows[0].length;
  const cells = new Uint8Array(width * height);
  let active = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const on = rows[r][c] === "#";
      cells[r * width + c] = on ? CellState.ACTIVE : CellState.REMOVED;
      if (on) active++;
    }
  }
  return {
    cellSize, width, height, originX, originY, cells,
    initialActiveCount: active, activeCount: active,
    cellRegionIds: new Array(width * height).fill(null),
  };
}

describe("traceActiveContours", () => {
  it("no active cells produce no loops", () => {
    expect(traceActiveContours(makeGrid(["...", "...", "..."]))).toHaveLength(0);
  });

  it("a solid rectangle is one loop that keeps its straight edges (exact bbox)", () => {
    const loops = traceActiveContours(makeGrid(["###", "###", "###"], 15));
    expect(loops).toHaveLength(1);
    const xs = loops[0].map(p => p.x);
    const ys = loops[0].map(p => p.y);
    // Straight edges must remain exactly on the grid extent (Chaikin only rounds
    // corners; collinear edge points stay on the line). 3 cells * 15 = 45.
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(45, 6);
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(45, 6);
  });

  it("a single isolated cell is one closed loop", () => {
    const loops = traceActiveContours(makeGrid([".....", ".....", "..#..", ".....", "....."]));
    expect(loops).toHaveLength(1);
    expect(loops[0].length).toBeGreaterThanOrEqual(4);
  });

  it("an active ring around a removed hole yields two loops (outer + hole)", () => {
    // Even-odd fill of both loops paints the ring but leaves the centre hole.
    const loops = traceActiveContours(makeGrid(["###", "#.#", "###"]));
    expect(loops).toHaveLength(2);
  });

  it("two disconnected active cells yield two loops", () => {
    const loops = traceActiveContours(makeGrid(["#...#", ".....", "....."]));
    expect(loops).toHaveLength(2);
  });
});

describe("traceContours (arbitrary cell mask)", () => {
  it("outlines only the cells the predicate accepts (lock-tint mask)", () => {
    // A 3x3 all-active grid, but tint-mask just the two left-column cells.
    const grid = makeGrid(["###", "###", "###"], 15);
    const mask = new Uint8Array(grid.cells.length);
    mask[0] = 1; // (col0,row0)
    mask[grid.width] = 1; // (col0,row1)
    const loops = traceContours(grid, (c, r) => mask[r * grid.width + c] === 1);
    expect(loops).toHaveLength(1);
    // The masked strip spans x in [0,15], y in [0,30]; straight edges stay put.
    const xs = loops[0].map(p => p.x);
    const ys = loops[0].map(p => p.y);
    expect(Math.max(...xs)).toBeCloseTo(15, 6);
    expect(Math.max(...ys)).toBeCloseTo(30, 6);
  });

  it("an empty mask yields no loops", () => {
    const grid = makeGrid(["###", "###", "###"]);
    expect(traceContours(grid, () => false)).toHaveLength(0);
  });
});

describe("snapContoursToWalls", () => {
  const walls = [{ start: { x: 0, y: 10 }, end: { x: 100, y: 10 } }]; // horizontal line y=10

  it("projects nearby points onto the wall line and leaves distant ones alone", () => {
    const loops = [[
      { x: 50, y: 3 },   // 7 away -> snaps to (50,10)
      { x: 20, y: 18 },  // 8 away (other side) -> snaps to (20,10)
      { x: 50, y: 40 },  // 30 away -> untouched
    ]];
    const [snapped] = snapContoursToWalls(loops, walls, 15);
    expect(snapped[0]).toEqual({ x: 50, y: 10 });
    expect(snapped[1]).toEqual({ x: 20, y: 10 });
    expect(snapped[2]).toEqual({ x: 50, y: 40 });
  });

  it("clamps to segment endpoints (no snapping onto the infinite line)", () => {
    const [snapped] = snapContoursToWalls([[{ x: 108, y: 12 }]], walls, 15);
    // Nearest point on the SEGMENT is its end (100,10), 8.2 away.
    expect(snapped[0].x).toBeCloseTo(100, 6);
    expect(snapped[0].y).toBeCloseTo(10, 6);
  });

  it("picks the nearest of several walls", () => {
    const two = [
      { start: { x: 0, y: 10 }, end: { x: 100, y: 10 } },
      { start: { x: 30, y: 0 }, end: { x: 30, y: 100 } },
    ];
    const [snapped] = snapContoursToWalls([[{ x: 27, y: 20 }]], two, 15);
    // 3 from the vertical wall, 10 from the horizontal one -> (30,20).
    expect(snapped[0]).toEqual({ x: 30, y: 20 });
  });

  it("no walls or non-positive radius is a passthrough", () => {
    const loops = [[{ x: 1, y: 2 }]];
    expect(snapContoursToWalls(loops, [], 15)).toBe(loops);
    expect(snapContoursToWalls(loops, walls, 0)).toBe(loops);
  });

  it("a diagonal wall pulls the lattice staircase flush onto the line", () => {
    // Wall along y = x; lattice-ish points near it must land exactly on it.
    const diag = [{ start: { x: 0, y: 0 }, end: { x: 100, y: 100 } }];
    const pts = [{ x: 15, y: 25 }, { x: 30, y: 22 }, { x: 45, y: 52 }];
    const [snapped] = snapContoursToWalls([pts], diag, 15);
    for (const p of snapped) {
      expect(Math.abs(p.x - p.y)).toBeLessThan(1e-9); // on y = x
    }
  });
});
