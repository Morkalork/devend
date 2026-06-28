/**
 * Destructible mirrors & movers (issue #37, Phase 2 — the black ball).
 *
 * The black ball ("breakObjects") wears down mirrors and movers; after three
 * hits an object collapses. updateBall registers hits and queues finished
 * objects in game.pendingDestroys; the game loop calls processDestroysFn after
 * the physics step (removal rebuilds regions, too heavy to do per step).
 *
 * Destroyed mirrors RE-OPEN their footprint as capturable space (the carved
 * grid cells are restored and the regions rebuilt). Movers carve no space, so
 * their removal is purely cosmetic + collision. Each kill drops the destroying
 * ball's lock multiplier by one (floored at 1).
 */
import { CanvasGameState } from "@/types/gameState";
import {
  DestructibleState,
  ObjectDebrisState,
  ObjectDebrisParticle,
  Region,
} from "@/types/game";
import { Polygon, pointInPolygon, polygonCentroid } from "@/lib/polygon";
import {
  CellState,
  restoreCells,
  findGridRegions,
  getRemainingPercent,
  getRegionCellPositions,
  worldToGridIndex,
} from "@/lib/spaceGrid";
import { buildPolygonFromSamples } from "@/lib/regionSplit";
import { reassignBallsToRegions, paintCellRegionIds } from "@/lib/regionOwnership";
import { generateRegionId } from "@/lib/gameUtils";

export const DESTRUCTIBLE_MAX_HITS = 3;
const HIT_DEBOUNCE_MS = 250;     // one ball pass can't count as multiple hits
const DEBRIS_DURATION_MS = 650;
const MIRROR_DEBRIS_COLOR = "#88ddff";
const MOVER_DEBRIS_COLOR = "#ff8800";

export interface DestroyCallbacks {
  repaintRegionCanvas: () => void;
  setRemainingPercent: (percent: number) => void;
  onObjectDestroyed?: () => void;
}

/** Find the destructible descriptor for a (mirror) obstacle polygon, if any. */
export function findMirrorDestructible(game: CanvasGameState, polygon: Polygon): DestructibleState | undefined {
  return game.destructibles.find(d => d.kind === 'mirror' && !d.destroyed && d.mirrorPolygon === polygon);
}

/** Find the destructible descriptor for a mover, if any. */
export function findMoverDestructible(game: CanvasGameState, moverId: string): DestructibleState | undefined {
  return game.destructibles.find(d => d.kind === 'mover' && !d.destroyed && d.moverId === moverId);
}

/**
 * Register a black-ball hit on a destructible. Debounced per object so a single
 * contact doesn't count multiple times. Queues the object for destruction once
 * its hit budget is spent.
 */
export function registerObjectHit(game: CanvasGameState, d: DestructibleState, ballId: string, now: number): void {
  if (d.destroyed) return;
  if (d.lastHitAt && now - d.lastHitAt < HIT_DEBOUNCE_MS) return;
  d.lastHitAt = now;
  d.hits = Math.min(d.maxHits, d.hits + 1);
  if (d.hits >= d.maxHits) {
    d.destroyed = true;       // stays in the world until processed this frame
    d.destroyedBy = ballId;
    game.pendingDestroys.push(d);
  }
}

// ── Collapse animation ──────────────────────────────────────────────────────

function spawnDebris(poly: Polygon, color: string, now: number): ObjectDebrisState {
  const c = polygonCentroid(poly);
  const N = 16;
  const verts = poly.vertices;
  const particles: ObjectDebrisParticle[] = [];
  for (let i = 0; i < N; i++) {
    // A point along the perimeter, then fling it outward from the centroid.
    const t = (i / N) * verts.length;
    const vi = Math.floor(t) % verts.length;
    const vn = (vi + 1) % verts.length;
    const f = t - Math.floor(t);
    const px = verts[vi].x + (verts[vn].x - verts[vi].x) * f;
    const py = verts[vi].y + (verts[vn].y - verts[vi].y) * f;
    let dx = px - c.x, dy = py - c.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const speed = 70 + Math.random() * 160;
    particles.push({
      x: px,
      y: py,
      vx: dx * speed + (Math.random() - 0.5) * 40,
      vy: dy * speed + (Math.random() - 0.5) * 40,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 10,
      size: 5 + Math.random() * 11,
    });
  }
  return { startTime: now, durationMs: DEBRIS_DURATION_MS, color, particles };
}

// ── Space / region rebuild after a mirror opens up ──────────────────────────

/** Indices of grid cells whose centre lies inside `poly` and are REMOVED. */
function removedCellsUnder(game: CanvasGameState, poly: Polygon): number[] {
  const grid = game.spaceGrid;
  if (!grid) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of poly.vertices) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
  }
  const c0 = Math.max(0, Math.floor((minX - grid.originX) / grid.cellSize));
  const c1 = Math.min(grid.width - 1, Math.ceil((maxX - grid.originX) / grid.cellSize));
  const r0 = Math.max(0, Math.floor((minY - grid.originY) / grid.cellSize));
  const r1 = Math.min(grid.height - 1, Math.ceil((maxY - grid.originY) / grid.cellSize));
  const out: number[] = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const index = row * grid.width + col;
      if (grid.cells[index] !== CellState.REMOVED) continue;
      const wx = grid.originX + col * grid.cellSize + grid.cellSize / 2;
      const wy = grid.originY + row * grid.cellSize + grid.cellSize / 2;
      if (pointInPolygon({ x: wx, y: wy }, poly)) out.push(index);
    }
  }
  return out;
}

/**
 * Rebuild regions from the grid, KEEPING every active region (including newly
 * opened, ball-less space — it's now capturable, not a stray sliver).
 */
function rebuildRegionsKeepAll(game: CanvasGameState): void {
  const grid = game.spaceGrid!;
  const gridRegions = findGridRegions(grid);
  game.gridRegions = gridRegions;

  const regions: Region[] = [];
  for (const gridRegion of gridRegions) {
    const samples = getRegionCellPositions(grid, gridRegion);
    const built = buildPolygonFromSamples(samples, samples.length);
    if (built) {
      regions.push({
        id: generateRegionId(),
        polygon: built.polygon,
        estimatedArea: built.estimatedArea,
        samplePoints: built.samplePoints,
      });
    }
  }
  game.regions = regions;
  reassignBallsToRegions(game.balls, game.regions, game.walls);
  paintCellRegionIds(grid, game.regions);
}

// ── Processing queued destructions ──────────────────────────────────────────

export function processDestroysFn(game: CanvasGameState, callbacks: DestroyCallbacks): void {
  const pending = game.pendingDestroys;
  game.pendingDestroys = [];
  if (pending.length === 0) return;

  const now = performance.now();
  let mirrorOpened = false;

  for (const d of pending) {
    // Drop the destroying ball's lock multiplier (black starts at 4, floor 1).
    if (d.destroyedBy) {
      const ball = game.balls.find(b => b.id === d.destroyedBy);
      if (ball) ball.lockMultiplier = Math.max(1, ball.lockMultiplier - 1);
    }

    if (d.kind === 'mover') {
      const mover = game.movers.find(m => m.id === d.moverId);
      if (mover) {
        game.objectDebris.push(spawnDebris(mover.polygon, MOVER_DEBRIS_COLOR, now));
        game.movers.splice(game.movers.indexOf(mover), 1);
      }
      continue;
    }

    // Mirror: remove polygon + its walls, then reopen its footprint as space.
    const poly = d.mirrorPolygon;
    if (!poly) continue;
    game.objectDebris.push(spawnDebris(poly, MIRROR_DEBRIS_COLOR, now));

    // Reassign NEW arrays (not in-place splice): renderFrame's obstacle/mirror
    // glow + fence-clip caches invalidate on array-reference change.
    game.obstaclePolygons = game.obstaclePolygons.filter(p => p !== poly);
    game.mirrorPolygons = game.mirrorPolygons.filter(p => p !== poly);

    const wallPrefix = `obstacle-${d.id}-edge-`;
    game.walls = game.walls.filter(w => !w.id.startsWith(wallPrefix));

    if (game.spaceGrid) {
      const cells = removedCellsUnder(game, poly);
      if (cells.length > 0) {
        restoreCells(game.spaceGrid, cells);     // activeCount += cells
        game.spaceGrid.initialActiveCount += cells.length; // keep remaining% ≤ 100
        mirrorOpened = true;
      }
    }
  }

  if (mirrorOpened && game.spaceGrid) {
    rebuildRegionsKeepAll(game);
    callbacks.repaintRegionCanvas();
    callbacks.setRemainingPercent(Math.round(getRemainingPercent(game.spaceGrid)));
  }

  callbacks.onObjectDestroyed?.();
}
