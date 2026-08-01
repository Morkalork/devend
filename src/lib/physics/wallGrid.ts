/**
 * Spatial index over wall segments, for the per-ball collision broad-phase.
 *
 * The ball-vs-wall loop in updateBall runs per ball per physics substep and
 * scans every wall in `game.walls` (board edges + static obstacle edges +
 * committed fences). That set grows as the player cuts, so late-game maps pay
 * O(balls x substeps x walls) even though each ball only ever touches the few
 * walls around it. This grid buckets walls onto the same 15-unit lattice the
 * space grid uses; a query returns just the walls near a point.
 *
 * Correctness contract (why this is a drop-in for the brute-force scan):
 *   - `game.walls` never moves and is immutable across a frame's substeps
 *     (movers carry their own polygons; fences only commit/break at frame
 *     boundaries), so the grid is built ONCE per frame and stays valid.
 *   - A wall is bucketed into every cell its (axis-aligned) segment bounds
 *     cover. A query gathers every wall in the cells overlapping the query box,
 *     so it returns a SUPERSET of the walls within `radius` of the point — no
 *     false negatives. False positives are harmless: `collideBallWithWall`
 *     re-checks each candidate precisely and no-ops on a miss.
 *   - `queryWallsNear` returns candidates in ascending `walls` index order, the
 *     same relative order the brute-force loop visited them, so multi-wall
 *     resolutions (corner bounces, which mutate the ball per wall) come out
 *     bit-identical. See wallGrid.test.ts's equivalence test.
 */
import { Wall } from "@/lib/wallGeometry";
import { Polygon } from "@/lib/polygon";

/** Matches the space-grid lattice so fences and cells share cell boundaries. */
const CELL_SIZE = 15;
/** Extend the grid a couple cells past the board so edge fences always bucket. */
const PAD_CELLS = 2;

export interface WallGrid {
  cellSize: number;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  /** CSR row pointers: cell c owns cellWalls[cellStart[c] .. cellStart[c+1]). */
  cellStart: Int32Array;
  /** Wall indices grouped by cell (CSR values). */
  cellWalls: Int32Array;
  /** The walls array this grid indexes; candidates are looked up here. */
  walls: Wall[];
  /** Largest wall thickness in the set; the query radius accounts for it. */
  maxThickness: number;
  /** Per-wall dedup stamp (last query id that saw the wall). */
  stamp: Int32Array;
  /** Build-time write cursor, one per cell. */
  cursor: Int32Array;
  /** Scratch for the sorted unique candidate indices of one query. */
  scratchIdx: Int32Array;
  queryId: number;
}

/** Shared scratch for a wall's cell range, to keep (re)build allocation-free. */
const _r = { cmin: 0, cmax: 0, rmin: 0, rmax: 0 };

function cellRangeInto(grid: WallGrid, w: Wall): void {
  const { cellSize, originX, originY, cols, rows } = grid;
  const wx0 = Math.min(w.start.x, w.end.x), wx1 = Math.max(w.start.x, w.end.x);
  const wy0 = Math.min(w.start.y, w.end.y), wy1 = Math.max(w.start.y, w.end.y);
  let cmin = Math.floor((wx0 - originX) / cellSize); if (cmin < 0) cmin = 0;
  let cmax = Math.floor((wx1 - originX) / cellSize); if (cmax >= cols) cmax = cols - 1;
  let rmin = Math.floor((wy0 - originY) / cellSize); if (rmin < 0) rmin = 0;
  let rmax = Math.floor((wy1 - originY) / cellSize); if (rmax >= rows) rmax = rows - 1;
  _r.cmin = cmin; _r.cmax = cmax; _r.rmin = rmin; _r.rmax = rmax;
}

/**
 * (Re)build the grid over `walls`. Reuses `prev`'s buffers when the board
 * dimensions and capacities still fit, so the steady state allocates nothing.
 */
export function rebuildWallGrid(prev: WallGrid | null, walls: Wall[], board: Polygon | null): WallGrid {
  let minX = 0, minY = 0, maxX = 900, maxY = 900;
  if (board && board.vertices.length) {
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    for (const v of board.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  }
  const originX = minX - PAD_CELLS * CELL_SIZE;
  const originY = minY - PAD_CELLS * CELL_SIZE;
  const cols = Math.max(1, Math.ceil((maxX - originX) / CELL_SIZE) + PAD_CELLS);
  const rows = Math.max(1, Math.ceil((maxY - originY) / CELL_SIZE) + PAD_CELLS);
  const nCells = cols * rows;

  const reuse =
    prev !== null &&
    prev.cols === cols &&
    prev.rows === rows &&
    prev.stamp.length >= walls.length &&
    prev.scratchIdx.length >= walls.length;

  const grid: WallGrid = reuse
    ? prev!
    : {
        cellSize: CELL_SIZE,
        originX,
        originY,
        cols,
        rows,
        cellStart: new Int32Array(nCells + 1),
        cellWalls: new Int32Array(Math.max(16, walls.length * 4)),
        walls,
        maxThickness: 0,
        stamp: new Int32Array(Math.max(16, walls.length)),
        cursor: new Int32Array(nCells),
        scratchIdx: new Int32Array(Math.max(16, walls.length)),
        queryId: 0,
      };
  grid.cellSize = CELL_SIZE;
  grid.originX = originX;
  grid.originY = originY;
  grid.cols = cols;
  grid.rows = rows;
  grid.walls = walls;

  // 1. Count walls per cell into cellStart[c+1] (the CSR count-then-scan trick).
  grid.cellStart.fill(0, 0, nCells + 1);
  let maxThickness = 0;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (w.thickness > maxThickness) maxThickness = w.thickness;
    cellRangeInto(grid, w);
    for (let ry = _r.rmin; ry <= _r.rmax; ry++) {
      const base = ry * cols;
      for (let cx = _r.cmin; cx <= _r.cmax; cx++) grid.cellStart[base + cx + 1]++;
    }
  }
  grid.maxThickness = maxThickness;

  // 2. Prefix sum -> cellStart is now the CSR row pointers.
  for (let c = 0; c < nCells; c++) grid.cellStart[c + 1] += grid.cellStart[c];
  const total = grid.cellStart[nCells];
  if (grid.cellWalls.length < total) {
    grid.cellWalls = new Int32Array(Math.max(total, grid.cellWalls.length * 2));
  }

  // 3. Scatter wall indices into their cells using a write cursor per cell.
  grid.cursor.set(grid.cellStart.subarray(0, nCells));
  for (let i = 0; i < walls.length; i++) {
    cellRangeInto(grid, walls[i]);
    for (let ry = _r.rmin; ry <= _r.rmax; ry++) {
      const base = ry * cols;
      for (let cx = _r.cmin; cx <= _r.cmax; cx++) {
        const c = base + cx;
        grid.cellWalls[grid.cursor[c]++] = i;
      }
    }
  }

  grid.stamp.fill(-1);
  grid.queryId = 0;
  return grid;
}

/**
 * Fill `out` with every wall whose cell overlaps the box [x±radius, y±radius],
 * deduped and sorted by ascending `walls` index (== brute-force visit order).
 * Returns `out` for convenience.
 */
export function queryWallsNear(grid: WallGrid, x: number, y: number, radius: number, out: Wall[]): Wall[] {
  out.length = 0;
  const { cellSize, originX, originY, cols, rows } = grid;
  let cmin = Math.floor((x - radius - originX) / cellSize); if (cmin < 0) cmin = 0;
  let cmax = Math.floor((x + radius - originX) / cellSize); if (cmax >= cols) cmax = cols - 1;
  let rmin = Math.floor((y - radius - originY) / cellSize); if (rmin < 0) rmin = 0;
  let rmax = Math.floor((y + radius - originY) / cellSize); if (rmax >= rows) rmax = rows - 1;
  if (cmin > cmax || rmin > rmax) return out;

  const qid = ++grid.queryId;
  const { cellStart, cellWalls, stamp, scratchIdx } = grid;
  let count = 0;
  for (let ry = rmin; ry <= rmax; ry++) {
    const base = ry * cols;
    for (let cx = cmin; cx <= cmax; cx++) {
      const c = base + cx;
      for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
        const wi = cellWalls[k];
        if (stamp[wi] === qid) continue;
        stamp[wi] = qid;
        scratchIdx[count++] = wi;
      }
    }
  }
  if (count === 0) return out;

  const slice = scratchIdx.subarray(0, count);
  slice.sort(); // Int32Array sorts numerically -> ascending index order.
  const walls = grid.walls;
  for (let i = 0; i < count; i++) out.push(walls[slice[i]]);
  return out;
}
