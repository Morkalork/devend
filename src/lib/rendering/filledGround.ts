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
 * What counts as filled, per grid cell (CellFill):
 *   - TAKEN: not playable now (REMOVED), and playable at some point in the map
 *     (startCells, which restoreCells keeps up to date as obstacles break and
 *     reserved ground is released). A brick column knocked out and then fenced
 *     off is the player's ground like any other.
 *   - BURIED: the footprint of something never playable (an obstacle) that no
 *     live cell touches any more. It goes under the fill, and the renderers
 *     stop drawing what stood there.
 *   - FOOTING: the footprint of an obstacle that still touches live ground but
 *     is bordered more by taken ground than by live. The fill runs under it, so
 *     there is no pit round an obstacle on the edge of a pocket, and the
 *     obstacle keeps standing on top: it still matters to play.
 * Cells outside the board are never filled, and an obstacle out in live space
 * (bordered mostly by live ground) is left exactly as it was.
 *
 * Something that MOVES is never buried: a rotor sweeping across a pocket is
 * still a hazard at the pocket's edge, so it is drawn over the fill.
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

/** What a cell is under the fill (indexed like grid.cells). */
export const CellFill = {
  NONE: 0,
  TAKEN: 1,
  BURIED: 2,
  FOOTING: 3,
} as const;

export interface FilledGround {
  /** 1 per filled cell, indexed like grid.cells. */
  mask: Uint8Array;
  /** CellFill per cell, for the renderers that need to know why. */
  kind: Uint8Array;
  /** Obstacles under the fill: not drawn by either renderer. */
  buried: Set<Polygon>;
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
 * What each cell is under the fill (CellFill). Exported for the tests;
 * renderers read `filledGround`.
 */
export function filledCellKinds(grid: SpaceGrid, board: Polygon | null): Uint8Array {
  const { cells, width: w, height: h, startCells } = grid;
  const n = cells.length;
  const kind = new Uint8Array(n);
  if (!startCells) {
    return kind;
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

  const taken = (i: number) => cells[i] === CellState.REMOVED && inBoard[i] === 1 && startCells[i] === CellState.ACTIVE;
  for (let i = 0; i < n; i++) {
    if (taken(i)) {
      kind[i] = CellFill.TAKEN;
    }
  }

  // Never-playable cells inside the board (obstacle footprints).
  const solid = (i: number) => startCells[i] === CellState.REMOVED && inBoard[i] === 1;
  const neighbours = (i: number, out: number[]) => {
    const col = i % w, row = (i - col) / w;
    out.length = 0;
    if (col > 0) { out.push(i - 1); }
    if (col < w - 1) { out.push(i + 1); }
    if (row > 0) { out.push(i - w); }
    if (row < h - 1) { out.push(i + w); }
    return out;
  };
  const near: number[] = [];

  // Distance, through footprint cells, to the nearest taken cell and to the
  // nearest live one. A footprint cell nearer taken ground is the fill's
  // FOOTING; ties go to live ground, so an obstacle out in live space is never
  // undercut by a fence that merely ends against it.
  const INF = 0x7fffffff;
  const toTaken = new Int32Array(n).fill(INF);
  const toLive = new Int32Array(n).fill(INF);
  const queue = new Int32Array(n);
  const spread = (dist: Int32Array, seed: (j: number) => boolean) => {
    let head = 0, tail = 0;
    for (let i = 0; i < n; i++) {
      if (!solid(i)) {
        continue;
      }
      for (const j of neighbours(i, near)) {
        if (seed(j)) {
          dist[i] = 1;
          queue[tail++] = i;
          break;
        }
      }
    }
    while (head < tail) {
      const i = queue[head++];
      for (const j of neighbours(i, near)) {
        if (solid(j) && dist[j] === INF) {
          dist[j] = dist[i] + 1;
          queue[tail++] = j;
        }
      }
    }
  };
  spread(toTaken, j => kind[j] === CellFill.TAKEN);
  spread(toLive, j => cells[j] === CellState.ACTIVE);

  // A cluster no live cell reaches is buried whole; otherwise each cell goes
  // to whichever ground is nearer.
  for (let i = 0; i < n; i++) {
    if (!solid(i) || toTaken[i] === INF) {
      continue;
    }
    if (toLive[i] === INF) {
      kind[i] = CellFill.BURIED;
    } else if (toTaken[i] < toLive[i]) {
      kind[i] = CellFill.FOOTING;
    }
  }
  return kind;
}

/** Which cells are filled, as 1s. */
export function filledCellMask(grid: SpaceGrid, board: Polygon | null): Uint8Array {
  const kind = filledCellKinds(grid, board);
  const mask = new Uint8Array(kind.length);
  for (let i = 0; i < kind.length; i++) {
    mask[i] = kind[i] === CellFill.NONE ? 0 : 1;
  }
  return mask;
}

/**
 * The obstacles under the fill: every cell of the footprint is BURIED. A
 * footprint too thin to own a cell centre is judged by the cell under its
 * centroid.
 */
function buriedObstacles(game: CanvasGameState, grid: SpaceGrid, kind: Uint8Array): Set<Polygon> {
  const out = new Set<Polygon>();
  const polys = new Set<Polygon>([...game.obstaclePolygons, ...(game.mirrorPolygons ?? [])]);
  const at = (x: number, y: number) => {
    const col = Math.floor((x - grid.originX) / grid.cellSize);
    const row = Math.floor((y - grid.originY) / grid.cellSize);
    if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) {
      return -1;
    }
    return row * grid.width + col;
  };
  for (const poly of polys) {
    const vs = poly.vertices;
    if (vs.length < 3) {
      continue;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cx = 0, cy = 0;
    for (const v of vs) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      cx += v.x; cy += v.y;
    }
    cx /= vs.length; cy /= vs.length;
    let seen = 0, under = 0;
    const cs = grid.cellSize;
    const c0 = Math.floor((minX - grid.originX) / cs), c1 = Math.floor((maxX - grid.originX) / cs);
    const r0 = Math.floor((minY - grid.originY) / cs), r1 = Math.floor((maxY - grid.originY) / cs);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const x = grid.originX + col * cs + cs / 2, y = grid.originY + row * cs + cs / 2;
        const i = at(x, y);
        if (i < 0 || !pointInPolygon({ x, y }, poly)) {
          continue;
        }
        seen++;
        if (kind[i] === CellFill.BURIED) {
          under++;
        }
      }
    }
    if (seen === 0) {
      const i = at(cx, cy);
      seen = 1;
      under = i >= 0 && kind[i] === CellFill.BURIED ? 1 : 0;
    }
    if (under === seen) {
      out.add(poly);
    }
  }
  return out;
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
  const key = `${grid.activeCount}|${game.walls.length}|${game.obstaclePolygons.length}`
    + `|${game.boardPolygon ? game.boardPolygon.vertices.length : 0}`;
  const hit = cache.get(grid);
  if (hit && hit.key === key) {
    return hit.ground;
  }

  const kind = filledCellKinds(grid, game.boardPolygon);
  const mask = new Uint8Array(kind.length);
  for (let i = 0; i < kind.length; i++) {
    mask[i] = kind[i] === CellFill.NONE ? 0 : 1;
  }
  const w = grid.width;
  const raw = traceContours(grid, (col, row) => mask[row * w + col] === 1);
  // The same snap live space uses, so the two outlines meet on the fence line.
  const loops = raw.length ? snapOutlineToWalls(raw, game.walls, grid.cellSize) : [];
  let strip: FilledShape | null = null;
  if (hasHeadStartStrip(game)) {
    strip = { outer: game.arenaPolygon!.vertices, holes: [game.boardPolygon!.vertices] };
  }
  const ground: FilledGround = {
    mask, kind, buried: buriedObstacles(game, grid, kind),
    loops, shapes: nestLoops(loops), strip, version: ++versionCounter,
  };
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

/** True when any corner or the centre of an outline lies on filled ground. */
export function touchesFill(game: CanvasGameState, ground: FilledGround | null, vertices: Vector2[]): boolean {
  if (!ground || vertices.length === 0) {
    return false;
  }
  let cx = 0, cy = 0;
  for (const v of vertices) {
    if (isFilledAt(game, ground, v.x, v.y)) {
      return true;
    }
    cx += v.x;
    cy += v.y;
  }
  return isFilledAt(game, ground, cx / vertices.length, cy / vertices.length);
}

const DISC_SEGMENTS = 24;

/**
 * Everything that still STANDS where it meets the fill: obstacles that are
 * not buried, and every mover (a moving thing is never buried). The 2D cover
 * is cut away at these outlines so they show over it; the 3D board raises
 * them to at least the fill's height.
 */
export function standingOnFill(game: CanvasGameState, ground: FilledGround | null): Vector2[][] {
  if (!ground) {
    return [];
  }
  const out: Vector2[][] = [];
  const polys = new Set<Polygon>([...game.obstaclePolygons, ...(game.mirrorPolygons ?? [])]);
  for (const poly of polys) {
    if (!ground.buried.has(poly) && touchesFill(game, ground, poly.vertices)) {
      out.push(poly.vertices);
    }
  }
  for (const m of game.movers ?? []) {
    let outline: Vector2[];
    if (m.shape === "rect") {
      outline = m.polygon.vertices;
    } else {
      const cx = m.homeX + (m.axis === "horizontal" ? m.offset : 0);
      const cy = m.homeY + (m.axis === "vertical" ? m.offset : 0);
      const r = m.radius ?? 18;
      outline = [];
      for (let i = 0; i < DISC_SEGMENTS; i++) {
        const a = (i / DISC_SEGMENTS) * Math.PI * 2;
        outline.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    }
    if (touchesFill(game, ground, outline)) {
      out.push(outline);
    }
  }
  return out;
}
