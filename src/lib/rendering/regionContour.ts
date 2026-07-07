/**
 * regionContour — trace smooth outlines around the ACTIVE area of the space grid.
 *
 * The captured-territory fill used to be stamped cell-by-cell (15px world cells)
 * as axis-aligned rectangles, so every cut/obstacle boundary was a hard 90deg
 * staircase — the "pixelated" look. Instead we trace the boundary between ACTIVE
 * and non-ACTIVE cells as closed loops, then round the corners with Chaikin
 * corner-cutting. Straight runs (including the board perimeter) stay straight,
 * because corner-cutting leaves points that are still collinear on the line;
 * only genuine direction changes — the stair steps of a diagonal cut — get
 * rounded, collapsing the staircase into a smooth diagonal.
 *
 * This runs at repaint time (on a cut/break/resize), never per frame, so the
 * O(cells) trace + smoothing is free at runtime.
 */

import { SpaceGrid, CellState } from "@/lib/spaceGrid";

export interface ContourPoint {
  x: number;
  y: number;
}

/** Chaikin passes. 2 rounds staircases cleanly while keeping the board edges
 * straight (they stay collinear) and the four board corners rounded by only
 * ~one cell — imperceptible on a full-size board. Bump for a softer look. */
const SMOOTH_ITERATIONS = 2;

/**
 * Trace every closed contour separating ACTIVE cells from non-ACTIVE cells
 * (removed/obstacle/outside), in world coordinates. Outer boundaries and the
 * holes inside them are all returned as separate loops; fill the whole set with
 * the even-odd rule to paint (or, via destination-out, to punch) the ACTIVE area
 * with interior holes correctly preserved.
 */
export function traceActiveContours(grid: SpaceGrid): ContourPoint[][] {
  const { width: w, height: h, cells, cellSize, originX, originY } = grid;

  const active = (col: number, row: number): boolean =>
    col >= 0 && row >= 0 && col < w && row < h && cells[row * w + col] === CellState.ACTIVE;

  // Corner lattice is (w+1) x (h+1); key a corner (cx,cy) as cy*stride+cx.
  const stride = w + 1;
  // tailKey -> list of head corner keys. A well-formed cell-set boundary is a
  // set of closed loops; a diagonal pinch point yields two out-edges at one
  // corner (handled by walking whichever is still unused).
  const outEdges = new Map<number, number[]>();
  let edgeCount = 0;
  const addEdge = (ax: number, ay: number, bx: number, by: number) => {
    const tk = ay * stride + ax;
    const hk = by * stride + bx;
    const arr = outEdges.get(tk);
    if (arr) arr.push(hk);
    else outEdges.set(tk, [hk]);
    edgeCount++;
  };

  // For each ACTIVE cell, emit the sides that border a non-ACTIVE neighbour,
  // directed clockwise around the cell so shared interior sides cancel and the
  // remaining boundary sides chain into closed loops.
  for (let row = 0; row < h; row++) {
    const base = row * w;
    for (let col = 0; col < w; col++) {
      if (cells[base + col] !== CellState.ACTIVE) continue;
      if (!active(col, row - 1)) addEdge(col, row, col + 1, row); // top:    L->R
      if (!active(col + 1, row)) addEdge(col + 1, row, col + 1, row + 1); // right:  T->B
      if (!active(col, row + 1)) addEdge(col + 1, row + 1, col, row + 1); // bottom: R->L
      if (!active(col - 1, row)) addEdge(col, row + 1, col, row); // left:   B->T
    }
  }

  const toWorld = (k: number): ContourPoint => {
    const cx = k % stride;
    const cy = (k - cx) / stride;
    return { x: originX + cx * cellSize, y: originY + cy * cellSize };
  };

  const loops: ContourPoint[][] = [];
  const guardMax = edgeCount + 8;
  for (const [startTail, heads] of outEdges) {
    while (heads.length > 0) {
      const keys: number[] = [startTail];
      let head = heads.pop()!;
      let guard = guardMax;
      while (head !== startTail && guard-- > 0) {
        keys.push(head);
        const nexts = outEdges.get(head);
        if (!nexts || nexts.length === 0) break; // malformed loop; bail
        head = nexts.pop()!;
      }
      if (keys.length >= 3) loops.push(smooth(keys.map(toWorld)));
    }
  }
  return loops;
}

function smooth(loop: ContourPoint[]): ContourPoint[] {
  let pts = loop;
  for (let i = 0; i < SMOOTH_ITERATIONS; i++) pts = chaikin(pts);
  return pts;
}

/** One Chaikin corner-cutting pass on a closed loop (1/4, 3/4 split). */
function chaikin(pts: ContourPoint[]): ContourPoint[] {
  const n = pts.length;
  const out: ContourPoint[] = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    out[i * 2] = { x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 };
    out[i * 2 + 1] = { x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 };
  }
  return out;
}
