/**
 * Filled ground: the board the player has fenced off, as one solid shape.
 *
 * Captured territory used to be drawn as a slightly lighter floor, with
 * everything that stood in it still standing there: obstacles, props, a chest
 * nobody can reach any more. Read from play, a pocket you could do nothing in
 * looked like a pocket with things to do in it. So the fenced-off ground is
 * FILLED instead, the way the classic game fills it: an opaque cover in the 2D
 * surface, and a raised block on the 3D board, over everything inside it.
 *
 * What counts as filled, per grid cell:
 *   - the cell is not playable now (REMOVED), AND
 *   - either it WAS playable when the map started (the player took it), or it
 *     belongs to something that was never playable (an obstacle's footprint)
 *     that no live cell touches any more. An obstacle with live space beside
 *     it still matters to play, so it stays standing; one buried in captured
 *     ground does not, so it goes under the fill with the rest.
 * Cells outside the board are never filled.
 *
 * The head-start strip (headStartStrip.ts) is captured ground too, outside the
 * shrunk grid, so it is returned as its own shape.
 *
 * Computed once per change of the grid, cached on the grid object, and shared
 * by both renderers, so the 2D cover and the 3D block are the same outline.
 */
import { CellState, type SpaceGrid } from "@/lib/spaceGrid";
import { pointInPolygon, type Polygon, type Vector2 } from "@/lib/polygon";
import type { CanvasGameState } from "@/types/gameState";
import { snapOutlineToWalls, traceContours } from "@/lib/rendering/regionContour";
import { hasHeadStartStrip } from "@/lib/headStartStrip";

/** One filled piece: an outer loop and the live holes inside it. */
export interface FilledShape {
  outer: Vector2[];
  holes: Vector2[][];
}

export interface FilledGround {
  /** 1 per filled cell, indexed like grid.cells. */
  mask: Uint8Array;
  /** Every outline of the filled cells (fill even-odd), world units. */
  loops: Vector2[][];
  /** The same outlines nested into outers and holes, for triangulation. */
  shapes: FilledShape[];
  /** The head-start strip as its own shape, when the board has one. */
  strip: FilledShape | null;
  /** Bumped every time the outline is recomputed. */
  version: number;
}

interface Cached {
  key: string;
  ground: FilledGround;
}

const cache = new WeakMap<SpaceGrid, Cached>();
let versionCounter = 0;

/**
 * Which cells are filled. Exported for the tests; renderers read
 * `filledGround`.
 */
export function filledCellMask(grid: SpaceGrid, board: Polygon | null): Uint8Array {
  const { cells, width: w, height: h, startCells } = grid;
  const n = cells.length;
  const mask = new Uint8Array(n);
  if (!startCells) {
    return mask;
  }

  // Cells whose centre is inside the board. Outside it nothing is filled.
  const inBoard = new Uint8Array(n);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = row * w + col;
      if (!board) {
        inBoard[i] = 1;
        continue;
      }
      const x = grid.originX + col * grid.cellSize + grid.cellSize / 2;
      const y = grid.originY + row * grid.cellSize + grid.cellSize / 2;
      inBoard[i] = pointInPolygon({ x, y }, board) ? 1 : 0;
    }
  }

  // Never-playable cells inside the board, grouped 4-connected (one group per
  // obstacle, or per cluster of touching ones). A group is exposed when any of
  // its cells has a live neighbour.
  const group = new Int32Array(n).fill(-1);
  const exposed: boolean[] = [];
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (startCells[s] !== CellState.REMOVED || !inBoard[s] || group[s] !== -1) {
      continue;
    }
    const id = exposed.length;
    let open = false;
    let head = 0, tail = 0;
    queue[tail++] = s;
    group[s] = id;
    while (head < tail) {
      const i = queue[head++];
      const col = i % w, row = (i - col) / w;
      const near = [
        col > 0 ? i - 1 : -1,
        col < w - 1 ? i + 1 : -1,
        row > 0 ? i - w : -1,
        row < h - 1 ? i + w : -1,
      ];
      for (const j of near) {
        if (j < 0) {
          continue;
        }
        if (cells[j] === CellState.ACTIVE) {
          open = true;
        }
        if (startCells[j] === CellState.REMOVED && inBoard[j] && group[j] === -1) {
          group[j] = id;
          queue[tail++] = j;
        }
      }
    }
    exposed.push(open);
  }

  for (let i = 0; i < n; i++) {
    if (cells[i] !== CellState.REMOVED || !inBoard[i]) {
      continue;
    }
    if (startCells[i] === CellState.ACTIVE) {
      mask[i] = 1;
    } else if (group[i] >= 0 && !exposed[group[i]]) {
      mask[i] = 1;
    }
  }
  return mask;
}

function signedArea(loop: Vector2[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Nest even-odd loops into outers and their holes. The loops are disjoint and
 * never cross (they are cell-set boundaries), so a loop's depth is how many
 * other loops contain any one of its points: even depth is an outer, odd depth
 * is a hole of the smallest outer containing it.
 */
export function nestLoops(loops: Vector2[][]): FilledShape[] {
  const usable = loops.filter(l => l.length >= 3);
  const polys: Polygon[] = usable.map(vertices => ({ vertices }));
  const areas = usable.map(l => Math.abs(signedArea(l)));
  const parents: number[][] = usable.map((loop, i) => {
    const probe = loop[0];
    const inside: number[] = [];
    for (let j = 0; j < usable.length; j++) {
      if (j !== i && areas[j] > areas[i] && pointInPolygon(probe, polys[j])) {
        inside.push(j);
      }
    }
    return inside;
  });
  const shapes = new Map<number, FilledShape>();
  usable.forEach((loop, i) => {
    if (parents[i].length % 2 === 0) {
      shapes.set(i, { outer: loop, holes: [] });
    }
  });
  usable.forEach((loop, i) => {
    if (parents[i].length % 2 === 1) {
      // The smallest container is the outer it is a hole of.
      let best = -1;
      for (const j of parents[i]) {
        if (shapes.has(j) && (best < 0 || areas[j] < areas[best])) {
          best = j;
        }
      }
      if (best >= 0) {
        shapes.get(best)!.holes.push(loop);
      }
    }
  });
  return [...shapes.values()];
}

/** The filled ground for this frame's board, recomputed only when it changed. */
export function filledGround(game: CanvasGameState): FilledGround | null {
  const grid = game.spaceGrid;
  if (!grid || !grid.startCells) {
    return null;
  }
  // A cut, a lock, a break or a reopening all change the live cell count; a
  // wall appearing or going changes what the outline snaps to.
  const key = `${grid.activeCount}|${game.walls.length}|${game.boardPolygon ? game.boardPolygon.vertices.length : 0}`;
  const hit = cache.get(grid);
  if (hit && hit.key === key) {
    return hit.ground;
  }

  const mask = filledCellMask(grid, game.boardPolygon);
  const w = grid.width;
  const raw = traceContours(grid, (col, row) => mask[row * w + col] === 1);
  // The same snap live space uses, so the two outlines meet on the fence line.
  const loops = raw.length ? snapOutlineToWalls(raw, game.walls, grid.cellSize) : [];
  let strip: FilledShape | null = null;
  if (hasHeadStartStrip(game)) {
    strip = { outer: game.arenaPolygon!.vertices, holes: [game.boardPolygon!.vertices] };
  }
  const ground: FilledGround = { mask, loops, shapes: nestLoops(loops), strip, version: ++versionCounter };
  cache.set(grid, { key, ground });
  return ground;
}

/** True when world (x, y) lies on filled ground. */
export function isFilledAt(game: CanvasGameState, ground: FilledGround | null, x: number, y: number): boolean {
  const grid = game.spaceGrid;
  if (!ground || !grid) {
    return false;
  }
  const col = Math.floor((x - grid.originX) / grid.cellSize);
  const row = Math.floor((y - grid.originY) / grid.cellSize);
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) {
    return false;
  }
  return ground.mask[row * grid.width + col] === 1;
}
