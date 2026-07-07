import { describe, it, expect } from "vitest";
import { SpaceGrid, CellState } from "@/lib/spaceGrid";
import { traceActiveContours } from "@/lib/rendering/regionContour";

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
