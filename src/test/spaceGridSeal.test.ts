import { describe, it, expect } from 'vitest';
import { createSpaceGrid, findGridRegions } from '@/lib/spaceGrid';
import { Polygon, Vector2 } from '@/lib/polygon';

function rectPoly(x0: number, y0: number, x1: number, y1: number): Polygon {
  return { vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] };
}

// A thin quad of the given half-thickness centered on the segment a->b.
function thinBar(a: Vector2, b: Vector2, half: number): Polygon {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const px = (-dy / len) * half, py = (dx / len) * half;
  return {
    vertices: [
      { x: a.x + px, y: a.y + py }, { x: b.x + px, y: b.y + py },
      { x: b.x - px, y: b.y - py }, { x: a.x - px, y: a.y - py },
    ],
  };
}

describe('space grid: obstacles seal connectivity', () => {
  const board = rectPoly(0, 0, 300, 300);

  it('an open board is a single connected region', () => {
    const grid = createSpaceGrid(board, [], 15);
    expect(findGridRegions(grid).length).toBe(1);
  });

  it('a thin diagonal mirror splits the board into two regions', () => {
    // A 4px-thin diagonal crossing the whole board (extended past the corners so
    // it fully divides it). Marking only cells whose center is inside the obstacle
    // leaves this porous, so the two sides used to stay one region and space
    // behind it was never captured (the "shadow behind the obstacle"). Sealing the
    // obstacle boundary into the grid must separate them into two regions.
    const mirror = thinBar({ x: -20, y: 320 }, { x: 320, y: -20 }, 2);
    const grid = createSpaceGrid(board, [mirror], 15);
    expect(findGridRegions(grid).length).toBe(2);
  });

  it('a partial obstacle keeps both sides connected (paths go around it)', () => {
    // A thin bar that reaches only halfway across leaves an open channel past its
    // tip, so the board stays a single region — sealing must not over-remove.
    const stub = thinBar({ x: 150, y: -20 }, { x: 150, y: 150 }, 2);
    const grid = createSpaceGrid(board, [stub], 15);
    expect(findGridRegions(grid).length).toBe(1);
  });
});
