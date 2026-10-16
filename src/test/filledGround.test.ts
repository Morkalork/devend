/**
 * Filled ground (src/lib/rendering/filledGround.ts): which fenced-off cells the
 * board fills over, and the outline the 2D cover and the 3D block share.
 */
import { describe, it, expect } from "vitest";
import { createSpaceGrid, markCellRemoved, worldToGridIndex, CellState, type SpaceGrid } from "@/lib/spaceGrid";
import { filledCellMask, filledGround, isFilledAt, nestLoops } from "@/lib/rendering/filledGround";
import { extrudeFill } from "@/lib/rendering/three/fill3d";
import type { Polygon } from "@/lib/polygon";
import type { CanvasGameState } from "@/types/gameState";

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
});

const BOARD = rect(0, 0, 300, 300);

/** Capture everything left of x (a cut down the board at x). */
function captureLeftOf(grid: SpaceGrid, x: number): void {
  for (let i = 0; i < grid.cells.length; i++) {
    const col = i % grid.width;
    const cx = grid.originX + col * grid.cellSize + grid.cellSize / 2;
    if (cx < x) {
      markCellRemoved(grid, i);
    }
  }
}

function gameOf(grid: SpaceGrid): CanvasGameState {
  return { spaceGrid: grid, walls: [], boardPolygon: BOARD } as unknown as CanvasGameState;
}

describe("which ground is filled", () => {
  it("fills ground the player took and leaves live ground alone", () => {
    const grid = createSpaceGrid(BOARD, [], 15);
    captureLeftOf(grid, 120);
    const mask = filledCellMask(grid, BOARD);
    expect(mask[worldToGridIndex(grid, 50, 150)]).toBe(1);
    expect(mask[worldToGridIndex(grid, 200, 150)]).toBe(0);
  });

  it("never fills outside the board", () => {
    const grid = createSpaceGrid(BOARD, [], 15);
    captureLeftOf(grid, 120);
    const mask = filledCellMask(grid, BOARD);
    // The grid carries a padding ring of cells outside the board.
    expect(grid.cells[0]).toBe(CellState.REMOVED);
    expect(mask[0]).toBe(0);
  });

  it("buries an obstacle inside captured ground, but not one live space still touches", () => {
    const buried = rect(30, 30, 75, 75);
    const standing = rect(200, 200, 245, 245);
    const grid = createSpaceGrid(BOARD, [buried, standing], 15);
    captureLeftOf(grid, 120);
    const mask = filledCellMask(grid, BOARD);
    expect(mask[worldToGridIndex(grid, 52, 52)]).toBe(1);
    expect(mask[worldToGridIndex(grid, 222, 222)]).toBe(0);
  });

  it("keeps an obstacle on the fence line standing", () => {
    // Straddles the cut, so its right half still faces live ground.
    const grid = createSpaceGrid(BOARD, [rect(100, 100, 150, 150)], 15);
    captureLeftOf(grid, 120);
    const mask = filledCellMask(grid, BOARD);
    expect(mask[worldToGridIndex(grid, 125, 125)]).toBe(0);
  });

  it("fills nothing for a grid without a start snapshot", () => {
    const grid = createSpaceGrid(BOARD, [], 15);
    delete grid.startCells;
    captureLeftOf(grid, 120);
    expect(filledGround(gameOf(grid))).toBeNull();
    expect([...filledCellMask(grid, BOARD)].some(v => v === 1)).toBe(false);
  });
});

describe("the filled outline", () => {
  it("is recomputed after a cut and cached between them", () => {
    const grid = createSpaceGrid(BOARD, [], 15);
    const game = gameOf(grid);
    const before = filledGround(game)!;
    expect(before.loops).toEqual([]);
    expect(filledGround(game)).toBe(before);
    captureLeftOf(grid, 120);
    const after = filledGround(game)!;
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.shapes.length).toBe(1);
    expect(isFilledAt(game, after, 50, 150)).toBe(true);
    expect(isFilledAt(game, after, 200, 150)).toBe(false);
  });

  it("nests a live hole inside a filled piece", () => {
    const outer = rect(0, 0, 100, 100).vertices;
    const hole = rect(30, 30, 60, 60).vertices;
    const island = rect(40, 40, 50, 50).vertices;
    const shapes = nestLoops([hole, outer, island]);
    expect(shapes.length).toBe(2);
    const big = shapes.find(s => s.outer === outer)!;
    expect(big.holes).toEqual([hole]);
    expect(shapes.find(s => s.outer === island)!.holes).toEqual([]);
  });

  it("extrudes into a block whose top sits at the given height", () => {
    const g = extrudeFill([{ outer: rect(0, 0, 100, 100).vertices, holes: [rect(30, 30, 60, 60).vertices] }], 12);
    const pos = g.getAttribute("position");
    let top = 0;
    for (let i = 0; i < pos.count; i++) {
      top = Math.max(top, pos.getY(i));
    }
    expect(top).toBe(12);
    // A top with a hole needs more than the two triangles of a plain square,
    // plus two per side edge (4 outer + 4 hole).
    expect(g.getIndex()!.count / 3).toBeGreaterThan(2 + 16);
  });
});
