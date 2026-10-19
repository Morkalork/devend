/**
 * Filled ground (src/lib/rendering/filledGround.ts): which fenced-off cells the
 * board fills over, and the outline the 2D cover and the 3D block share.
 */
import { describe, it, expect } from "vitest";
import { createSpaceGrid, markCellRemoved, restoreCells, worldToGridIndex, CellState, type SpaceGrid } from "@/lib/spaceGrid";
import {
  CellFill, filledCellKinds, filledCellMask, filledGround, isFilledAt, nestLoops, standingOnFill,
} from "@/lib/rendering/filledGround";
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

function gameOf(grid: SpaceGrid, obstaclePolygons: Polygon[] = []): CanvasGameState {
  return { spaceGrid: grid, walls: [], boardPolygon: BOARD, obstaclePolygons, mirrorPolygons: [], movers: [] } as unknown as CanvasGameState;
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

  it("buries an obstacle inside captured ground, but not one out in live space", () => {
    const buried = rect(30, 30, 75, 75);
    const standing = rect(200, 200, 245, 245);
    const grid = createSpaceGrid(BOARD, [buried, standing], 15);
    captureLeftOf(grid, 120);
    const kind = filledCellKinds(grid, BOARD);
    expect(kind[worldToGridIndex(grid, 52, 52)]).toBe(CellFill.BURIED);
    expect(kind[worldToGridIndex(grid, 222, 222)]).toBe(CellFill.NONE);
    const ground = filledGround(gameOf(grid, [buried, standing]))!;
    expect(ground.buried.has(buried)).toBe(true);
    expect(ground.buried.has(standing)).toBe(false);
  });

  it("puts every wall in a pocket back on top of the fill, buried or not", () => {
    const buried = rect(30, 30, 75, 75);
    const standing = rect(200, 200, 245, 245);
    const grid = createSpaceGrid(BOARD, [buried, standing], 15);
    captureLeftOf(grid, 120);
    const game = gameOf(grid, [buried, standing]);
    const back = standingOnFill(game, filledGround(game));
    expect(back).toContain(buried.vertices);
    // Out in live space it never met the fill, so there is nothing to put back.
    expect(back).not.toContain(standing.vertices);
  });

  it("runs the fill under an obstacle on a pocket's edge, and keeps it standing", () => {
    // Taken ground to its left, live ground to its right.
    const edge = rect(100, 100, 160, 160);
    const grid = createSpaceGrid(BOARD, [edge], 15);
    captureLeftOf(grid, 150);
    const game = gameOf(grid, [edge]);
    const kind = filledCellKinds(grid, BOARD);
    expect(kind[worldToGridIndex(grid, 112, 130)]).toBe(CellFill.FOOTING);
    // The live side stays live: no fill reaching out past the obstacle.
    expect(kind[worldToGridIndex(grid, 157, 130)]).toBe(CellFill.NONE);
    const ground = filledGround(game)!;
    expect(ground.buried.has(edge)).toBe(false);
    expect(standingOnFill(game, ground)).toContain(edge.vertices);
  });

  it("fills ground an obstacle stood on once it broke and was taken", () => {
    const brick = rect(30, 30, 75, 75);
    const grid = createSpaceGrid(BOARD, [brick], 15);
    const footprint = [...grid.cells.keys()].filter(i => {
      const col = i % grid.width, row = (i - col) / grid.width;
      const x = grid.originX + col * 15 + 7.5, y = grid.originY + row * 15 + 7.5;
      return grid.cells[i] === CellState.REMOVED && x > 20 && x < 85 && y > 20 && y < 85;
    });
    restoreCells(grid, footprint);
    captureLeftOf(grid, 120);
    expect(filledCellKinds(grid, BOARD)[worldToGridIndex(grid, 52, 52)]).toBe(CellFill.TAKEN);
  });

  it("does not let a restore on a probe's copy of the grid touch the real one", () => {
    const grid = createSpaceGrid(BOARD, [rect(30, 30, 75, 75)], 15);
    const i = worldToGridIndex(grid, 52, 52);
    const probe: SpaceGrid = { ...grid, cells: Uint8Array.from(grid.cells) };
    restoreCells(probe, [i]);
    expect(grid.startCells![i]).toBe(CellState.REMOVED);
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
