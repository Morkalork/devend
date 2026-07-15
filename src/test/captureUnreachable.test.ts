import { describe, it, expect } from 'vitest';
import { captureUnreachableCells, CellState, SpaceGrid } from '@/lib/spaceGrid';

// Build a bare grid (cellSize 15) from an active-cell predicate.
function makeGrid(w: number, h: number, active: (r: number, c: number) => boolean): SpaceGrid {
  const cells = new Uint8Array(w * h);
  let ac = 0;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const a = active(r, c);
    cells[r * w + c] = a ? CellState.ACTIVE : CellState.REMOVED;
    if (a) ac++;
  }
  return {
    cellSize: 15, width: w, height: h, originX: 0, originY: 0, cells,
    initialActiveCount: ac, activeCount: ac, cellRegionIds: new Array(w * h).fill(null),
  };
}

const ball = (x: number, y: number) => ({ position: { x, y }, radius: 18, state: 'active', speed: 100 });
const cx = (col: number) => col * 15 + 7.5; // cell-centre world coord
const cy = (row: number) => row * 15 + 7.5;

// 12x7 grid: removed border, interior cols 1..10 / rows 1..5, a vertical wall at
// col 6 with a door of the given rows. Ball parked on the left at (col 3, row 3).
function twoRooms(doorRows: number[]) {
  const w = 12, h = 7;
  const grid = makeGrid(w, h, (r, c) => {
    if (r === 0 || r === h - 1 || c === 0 || c === w - 1) return false; // border
    if (c === 6 && !doorRows.includes(r)) return false;                // wall + door
    return true;
  });
  return { grid, w };
}

describe('captureUnreachableCells (ball-size-aware capture)', () => {
  it('captures a pocket behind a 1-cell door the ball cannot fit through', () => {
    const { grid, w } = twoRooms([3]); // 1-cell door
    captureUnreachableCells(grid, [ball(cx(3), cy(3))]);
    // Far side (cols 8..10) is unreachable → captured.
    for (let r = 1; r <= 5; r++) for (let c = 8; c <= 10; c++) {
      expect(grid.cells[r * w + c]).toBe(CellState.REMOVED);
    }
    // The ball's own room stays active.
    expect(grid.cells[3 * w + 3]).toBe(CellState.ACTIVE);
  });

  it('keeps the far side when the door is wide enough for the ball', () => {
    const { grid, w } = twoRooms([2, 3, 4]); // 3-cell door
    captureUnreachableCells(grid, [ball(cx(3), cy(3))]);
    // Ball can pass, so the far side stays in play.
    expect(grid.cells[3 * w + 9]).toBe(CellState.ACTIVE);
  });

  it('captures a fenced-off ball-free room entirely', () => {
    // Solid wall at col 6 (no door): the right room has no ball and no way in.
    const { grid, w } = twoRooms([]);
    captureUnreachableCells(grid, [ball(cx(3), cy(3))]);
    for (let r = 1; r <= 5; r++) for (let c = 7; c <= 10; c++) {
      expect(grid.cells[r * w + c]).toBe(CellState.REMOVED);
    }
    expect(grid.cells[3 * w + 3]).toBe(CellState.ACTIVE);
  });

  it('leaves an open room fully in play', () => {
    const w = 12, h = 7;
    const grid = makeGrid(w, h, (r, c) => !(r === 0 || r === h - 1 || c === 0 || c === w - 1));
    const before = grid.activeCount;
    captureUnreachableCells(grid, [ball(cx(5), cy(3))]);
    expect(grid.activeCount).toBe(before); // nothing captured
  });
});
