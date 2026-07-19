/**
 * Ghost-wall fix (intermittent "a legal fence fails for no reason"): a wall only
 * blocks starting a cut if it borders the ACTIVE region there. A fence stranded
 * in captured (REMOVED) space is invisible and must not block a legal cut.
 */
import { describe, it, expect } from "vitest";
import { wallBlocksCutStart } from "@/lib/physics/cutStart";
import { createSpaceGrid, CellState, SpaceGrid } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import type { Wall } from "@/lib/wallGeometry";

function grid(): SpaceGrid {
  return createSpaceGrid(createRectPolygon(0, 0, 300, 300), [], 15);
}
function removeCellAt(g: SpaceGrid, x: number, y: number): void {
  const col = Math.floor((x - g.originX) / g.cellSize);
  const row = Math.floor((y - g.originY) / g.cellSize);
  g.cells[row * g.width + col] = CellState.REMOVED;
}
// A vertical wall at x = 150.
const wall: Wall = { id: "fence-1", start: { x: 150, y: 0 }, end: { x: 150, y: 300 }, thickness: 4 } as Wall;

describe("wallBlocksCutStart (#ghost-wall fix)", () => {
  it("blocks a start that borders the wall across ACTIVE space (real boundary)", () => {
    const g = grid(); // all active
    expect(wallBlocksCutStart({ x: 145, y: 150 }, wall, g)).toBe(true);
  });

  it("IGNORES the wall when captured (removed) cells sit between it and the start (ghost)", () => {
    const g = grid();
    removeCellAt(g, 135, 150); // the cell one step off the wall toward the start is dead
    expect(wallBlocksCutStart({ x: 145, y: 150 }, wall, g)).toBe(false);
  });

  it("does not block a start that is far from the wall", () => {
    expect(wallBlocksCutStart({ x: 100, y: 150 }, wall, grid())).toBe(false);
  });

  it("blocks a start sitting essentially on the wall", () => {
    expect(wallBlocksCutStart({ x: 150, y: 150 }, wall, grid())).toBe(true);
  });
});
