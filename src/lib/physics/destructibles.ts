/**
 * Destructible objects.
 *
 * - Mirrors & movers (issue #37): broken only by the black ball.
 * - Breakable obstacles (issue #38): broken by ANY ball (black counts double),
 *   and they're often the level's objective. When a support breaks, whatever
 *   rests on it topples — falling toward the board bottom and shattering.
 *
 * updateBall registers hits and queues finished objects in game.pendingDestroys;
 * the game loop calls processDestroysFn after the physics step (removal rebuilds
 * regions, too heavy to do per step). Removed obstacles RE-OPEN their footprint
 * as capturable space.
 */
import { CanvasGameState } from "@/types/gameState";
import {
  DestructibleState,
  ObjectDebrisState,
  ObjectDebrisParticle,
  FallingObject,
  Region,
  Vector2,
  Ball,
} from "@/types/game";
import { getBallType } from "@/lib/ballTypes";
import { BASE_BALL_RADIUS } from "@/lib/gameConstants";
import { getRunRng } from "@/lib/runRng";
import { makeChestLoot } from "@/lib/chests";
import { rollAbilityReward } from "@/lib/abilities";
import { Polygon, pointInPolygon, polygonCentroid, pointToSegmentDistance } from "@/lib/polygon";
import {
  CellState,
  restoreCells,
  findGridRegions,
  getRemainingPercent,
  getRegionCellPositions,
  gridIndexToWorld,
  captureUnreachableCells,
} from "@/lib/spaceGrid";
import { buildPolygonFromSamples } from "@/lib/regionSplit";
import { reassignBallsToRegions, paintCellRegionIds } from "@/lib/regionOwnership";
import { generateRegionId } from "@/lib/gameUtils";
import { wasteCapturedPickups } from "@/lib/pickups";

export const DESTRUCTIBLE_MAX_HITS = 3;
const HIT_DEBOUNCE_MS = 250;     // one ball pass can't count as multiple hits
const DEBRIS_DURATION_MS = 650;
const CHIP_DURATION_MS = 520;    // per-hit chip burst (shorter than the full shatter)
const MAX_OBJECT_DEBRIS = 48;    // soft cap so rapid hits can't pile debris up
const FALL_DURATION_MS = 750;
const FALL_SPEED = 180;          // initial downward speed of toppling objects
const MIRROR_DEBRIS_COLOR = "#88ddff";
const MOVER_DEBRIS_COLOR = "#ff8800";
const BREAKABLE_DEBRIS_COLOR = "#ffb454";
const OBSTACLE_FALL_COLOR = "#9aa3ad";
// Bonus overtime hours for smashing a breakable (objective targets are worth more).
const BREAK_BONUS_BASE = 5;
const BREAK_BONUS_OBJECTIVE = 10;
// Demolition multiplier: each smash compounds the map's pre-cap payout by this,
// offsetting the ship-early time sacrificed to break things (issue #38).
export const BREAK_MULTIPLIER_PER = 1.15;
const MAX_DENTS = 6;             // most recent impacts kept for rendering

// ── Physics-based impact damage (issue #38 force model) ──────────────────────
// damage = k · mass · vₙ^EXP, with mass = density · (radius/BASE)² and vₙ the
// ball's closing speed along the surface normal. Calibrated so a standard ball
// (density 1, base radius) striking head-on at NOMINAL_SPEED does ~1.0 damage,
// so a breakable authored with `maxHits: 3` still feels like "about three solid
// hits" - but a fast or heavy smash breaks it in fewer, a weak graze in more.
// This fully replaces the old flat 1-hit-per-touch model (it wasn't physical).
const NOMINAL_SPEED = 250;       // red/blue baseSpeed = the reference solid hit
const DAMAGE_EXP = 1.6;          // >1 so speed matters more than linearly
const DAMAGE_K = 1 / Math.pow(NOMINAL_SPEED, DAMAGE_EXP);
const MIN_CHIP_DAMAGE = 0.15;    // a crawling graze still chips a little
const MAX_HIT_DAMAGE = 2.0;      // cap so one rocket can't trivialise everything

/** Relative mass of a ball: density × (radius / base radius)². */
export function ballMass(ball: Ball): number {
  const density = getBallType(ball.typeId)?.density ?? 1;
  const r = ball.radius / BASE_BALL_RADIUS;
  return density * r * r;
}

/**
 * Damage one impact deals to a breakable, from the ball's mass and its closing
 * speed along the surface normal (a glancing hit does less than a head-on one).
 */
export function ballImpactDamage(ball: Ball, normalSpeed: number): number {
  const raw = DAMAGE_K * ballMass(ball) * Math.pow(Math.max(0, normalSpeed), DAMAGE_EXP);
  return Math.max(MIN_CHIP_DAMAGE, Math.min(MAX_HIT_DAMAGE, raw));
}

/** Map a hit's damage to a dent depth/size multiplier (~0.5 chip .. ~1.3 smash). */
function dentStrength(damage: number): number {
  return 0.5 + Math.min(1, damage / 1.5) * 0.8;
}

export interface DestroyCallbacks {
  repaintRegionCanvas: () => void;
  setRemainingPercent: (percent: number) => void;
  onObjectDestroyed?: () => void;
  /**
   * A treasure chest was smashed (issue #38): the player earns one charge of the
   * rolled ability. This bubbles the ability id up so the session can bank the
   * charge run-wide (GameCanvas -> onGrantAbility).
   */
  onChestReward?: (rewardId: string) => void;
}

// ── Lookups ─────────────────────────────────────────────────────────────────

export function findMirrorDestructible(game: CanvasGameState, polygon: Polygon): DestructibleState | undefined {
  return game.destructibles.find(d => d.kind === 'mirror' && !d.destroyed && d.mirrorPolygon === polygon);
}

export function findMoverDestructible(game: CanvasGameState, moverId: string): DestructibleState | undefined {
  return game.destructibles.find(d => d.kind === 'mover' && !d.destroyed && d.moverId === moverId);
}

export function findBreakableDestructible(game: CanvasGameState, polygon: Polygon): DestructibleState | undefined {
  return game.destructibles.find(d => d.kind === 'breakable' && !d.destroyed && d.obstaclePolygon === polygon);
}

/**
 * Find a mirror/breakable destructible by its obstacle id (parsed from the
 * `obstacle-<id>-edge-N` wall id). Obstacles are bounced by their edge walls,
 * so hit-detection keys off the wall, not the polygon.
 */
export function findObstacleDestructibleById(game: CanvasGameState, id: string): DestructibleState | undefined {
  return game.destructibles.find(d => (d.kind === 'mirror' || d.kind === 'breakable') && !d.destroyed && d.id === id);
}

/** Extract the obstacle id from an `obstacle-<id>-edge-<n>` wall id, or null. */
export function obstacleIdFromWallId(wallId: string): string | null {
  const m = /^obstacle-(.+)-edge-\d+$/.exec(wallId);
  return m ? m[1] : null;
}

/**
 * True if a fence anchored at either endpoint would rest against a breakable
 * structure — you can't fence against those (issue #38), so such a cut "duds".
 * Shared by the input handler (cancel) and the renderer (red preview).
 */
export function cutAnchorsBreakable(
  game: CanvasGameState,
  a: { x: number; y: number },
  b: { x: number; y: number },
  tolerance: number,
): boolean {
  const near = (pt: { x: number; y: number }): boolean => {
    for (const d of game.destructibles) {
      if (d.kind !== 'breakable' || d.destroyed || !d.obstaclePolygon) continue;
      const v = d.obstaclePolygon.vertices;
      for (let i = 0; i < v.length; i++) {
        if (pointToSegmentDistance(pt, v[i], v[(i + 1) % v.length]) < tolerance) return true;
      }
    }
    return false;
  };
  return near(a) || near(b);
}

/**
 * Register a hit on a destructible. Debounced per object. `amount` lets the
 * black ball count double against breakable obstacles (issue #38). Queues the
 * object for destruction once its hit budget is spent.
 */
export function registerObjectHit(
  game: CanvasGameState,
  d: DestructibleState,
  ballId: string,
  now: number,
  amount = 1,
  impact?: { x: number; y: number },
): void {
  if (d.destroyed) return;
  if (d.lastHitAt && now - d.lastHitAt < HIT_DEBOUNCE_MS) return;
  d.lastHitAt = now;
  // `amount` is now physics damage (a float), not a whole hit; the object
  // breaks once accumulated damage reaches its integrity budget (maxHits).
  d.hits = Math.min(d.maxHits, d.hits + amount);
  // Remember where it was struck (and how hard) so the border dents inward
  // there scaled by force, and shed a burst of chips for tactile feedback.
  if (impact) {
    (d.dents ??= []).push({ x: impact.x, y: impact.y, s: dentStrength(amount) });
    if (d.dents.length > MAX_DENTS) d.dents.shift();
    // Non-fatal hits shed chips here; the fatal hit's full shatter (spawnDebris
    // in processDestroysFn) already covers the last one.
    if (d.hits < d.maxHits) {
      const poly = d.obstaclePolygon ?? d.mirrorPolygon;
      // Fling chips outward from the object centre through the impact, so they
      // read as flakes knocked off that face rather than a generic puff.
      let ax = 0, ay = -1;
      if (poly) {
        const c = polygonCentroid(poly);
        ax = impact.x - c.x; ay = impact.y - c.y;
        const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
      }
      const color = d.kind === 'mirror' ? MIRROR_DEBRIS_COLOR : BREAKABLE_DEBRIS_COLOR;
      game.objectDebris.push(spawnImpactChips(impact, ax, ay, color, now, amount));
      if (game.objectDebris.length > MAX_OBJECT_DEBRIS) game.objectDebris.shift();
    }
  }
  if (d.hits >= d.maxHits) {
    d.destroyed = true;       // stays in the world until processed this frame
    d.destroyedBy = ballId;
    game.pendingDestroys.push(d);
  }
}

// ── Collapse animation ──────────────────────────────────────────────────────

function spawnDebris(
  poly: Polygon,
  color: string,
  now: number,
  count = 16,
  scale = 1,
): ObjectDebrisState {
  const c = polygonCentroid(poly);
  const N = count;
  const verts = poly.vertices;
  const particles: ObjectDebrisParticle[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * verts.length;
    const vi = Math.floor(t) % verts.length;
    const vn = (vi + 1) % verts.length;
    const f = t - Math.floor(t);
    const px = verts[vi].x + (verts[vn].x - verts[vi].x) * f;
    const py = verts[vi].y + (verts[vn].y - verts[vi].y) * f;
    let dx = px - c.x, dy = py - c.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const speed = (70 + Math.random() * 160) * scale;
    particles.push({
      x: px,
      y: py,
      vx: dx * speed + (Math.random() - 0.5) * 40,
      vy: dy * speed + (Math.random() - 0.5) * 40,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 10,
      size: (5 + Math.random() * 11) * scale,
    });
  }
  return { startTime: now, durationMs: DEBRIS_DURATION_MS, color, particles };
}

/**
 * A small burst of chips knocked off the struck face on a (non-fatal) hit.
 * `ax,ay` is the outward unit direction (object centre → impact); chips spray
 * in a cone around it with a slight upward pop, then fall under gravity.
 */
function spawnImpactChips(
  impact: Vector2,
  ax: number,
  ay: number,
  color: string,
  now: number,
  damage = 1,
): ObjectDebrisState {
  // Harder hits fling more chips (4 for a graze, up to ~10 for a heavy smash).
  const N = 4 + Math.round(Math.min(1, damage / 1.5) * 6);
  const base = Math.atan2(ay, ax);
  const particles: ObjectDebrisParticle[] = [];
  for (let i = 0; i < N; i++) {
    const ang = base + (Math.random() - 0.5) * 1.6; // ~±46° cone around outward
    const speed = 80 + Math.random() * 170;
    particles.push({
      x: impact.x + (Math.random() - 0.5) * 6,
      y: impact.y + (Math.random() - 0.5) * 6,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 30, // small upward pop; gravity reclaims them
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 12,
      size: 3 + Math.random() * 6,     // smaller than the full-shatter debris
    });
  }
  return { startTime: now, durationMs: CHIP_DURATION_MS, color, particles };
}

function makeFalling(poly: Polygon, color: string, now: number): FallingObject {
  return {
    vertices: poly.vertices.map(v => ({ x: v.x, y: v.y })),
    color,
    startTime: now,
    durationMs: FALL_DURATION_MS,
    fallSpeed: FALL_SPEED,
  };
}

// ── Space / region rebuild ──────────────────────────────────────────────────

/** Indices of grid cells whose centre lies inside `poly` and are REMOVED. */
function removedCellsUnder(game: CanvasGameState, poly: Polygon): number[] {
  const grid = game.spaceGrid;
  if (!grid) return [];
  // createSpaceGrid seals each obstacle EDGE as a band of REMOVED cells reaching
  // ~cellSize beyond the polygon (rasterizeCutToGrid margin: thickness/2 +
  // cellSize/2). Reopen that band too, not just the interior footprint: leaving
  // the ring REMOVED grid-isolates the reopened interior even though physics
  // lets balls roll right over it, and the follow-up unreachable-capture in
  // processDestroysFn would then wrongly swallow reachable reopened space.
  const margin = grid.cellSize;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of poly.vertices) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
  }
  const c0 = Math.max(0, Math.floor((minX - margin - grid.originX) / grid.cellSize));
  const c1 = Math.min(grid.width - 1, Math.ceil((maxX + margin - grid.originX) / grid.cellSize));
  const r0 = Math.max(0, Math.floor((minY - margin - grid.originY) / grid.cellSize));
  const r1 = Math.min(grid.height - 1, Math.ceil((maxY + margin - grid.originY) / grid.cellSize));
  // Ring cells must NOT reopen space that is REMOVED for reasons other than
  // this obstacle's seal: a wall/fence corridor (reopening one punches a hole in
  // the fence's grid band and reconnects a sealed pocket to the live board),
  // the outside of the board, or another obstacle's footprint. The corridor
  // test is geometric against every wall segment - a fence's rasterCells list
  // can't be used here, because cells already removed by this obstacle's seal
  // were skipped during the fence's rasterization and never recorded on it.
  const nearWallCorridor = (p: Vector2): boolean => {
    for (const w of game.walls) {
      const corridor = (w.thickness ?? 6) / 2 + grid.cellSize / 2;
      if (pointToSegmentDistance(p, w.start, w.end) <= corridor) return true;
    }
    return false;
  };
  const inOtherSolid = (p: Vector2): boolean => {
    for (const op of game.obstaclePolygons) if (pointInPolygon(p, op)) return true;
    for (const mp of game.mirrorPolygons) if (pointInPolygon(p, mp)) return true;
    return false;
  };
  const vs = poly.vertices;
  const out: number[] = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const index = row * grid.width + col;
      if (grid.cells[index] !== CellState.REMOVED) continue;
      const wx = grid.originX + col * grid.cellSize + grid.cellSize / 2;
      const wy = grid.originY + row * grid.cellSize + grid.cellSize / 2;
      const p = { x: wx, y: wy };
      let inside = pointInPolygon(p, poly);
      if (!inside) {
        // Edge-seal ring: within the seal margin of some polygon edge.
        let nearEdge = false;
        for (let i = 0; i < vs.length && !nearEdge; i++) {
          if (pointToSegmentDistance(p, vs[i], vs[(i + 1) % vs.length]) <= margin) nearEdge = true;
        }
        inside = nearEdge
          && !nearWallCorridor(p)
          && (!game.boardPolygon || pointInPolygon(p, game.boardPolygon))
          && !inOtherSolid(p);
      }
      if (inside) out.push(index);
    }
  }
  return out;
}

/**
 * Remove an obstacle polygon from the world (polygon ref, edge walls) and
 * reopen its carved footprint as capturable space. Returns cells opened.
 * Arrays are reassigned (not spliced) so renderFrame's reference-keyed glow /
 * fence-clip caches invalidate.
 */
function detachObstacle(game: CanvasGameState, id: string, poly: Polygon): number {
  game.obstaclePolygons = game.obstaclePolygons.filter(p => p !== poly);
  const prefix = `obstacle-${id}-edge-`;
  game.walls = game.walls.filter(w => !w.id.startsWith(prefix));
  if (!game.spaceGrid) return 0;
  const cells = removedCellsUnder(game, poly);
  if (cells.length > 0) {
    reopenCells(game, cells);
  }
  return cells.length;
}

/**
 * Restore cells to ACTIVE, keep the percentage baseline sane, and register them
 * as sample points so the board grid texture is painted over the newly-opened
 * area (otherwise it renders as a bare patch).
 */
function reopenCells(game: CanvasGameState, cells: number[]): void {
  const grid = game.spaceGrid;
  if (!grid) return;
  restoreCells(grid, cells);
  grid.initialActiveCount += cells.length; // keep remaining% ≤ 100
  for (const idx of cells) game.initialSamplePoints.push(gridIndexToWorld(grid, idx));
}

/** Topple every obstacle resting on `supporterId` (recursively): detach + fall. */
function toppleSupportedBy(game: CanvasGameState, supporterId: string, now: number): number {
  let opened = 0;
  for (const so of game.stackObjects) {
    if (so.toppled || so.supporterId !== supporterId) continue;
    so.toppled = true;
    opened += detachObstacle(game, so.id, so.polygon);
    game.fallingObjects.push(makeFalling(so.polygon, OBSTACLE_FALL_COLOR, now));
    // If this object was itself a breakable destructible, retire its descriptor.
    const dd = game.destructibles.find(d => d.kind === 'breakable' && d.id === so.id && !d.destroyed);
    if (dd) dd.destroyed = true;
    opened += toppleSupportedBy(game, so.id, now); // things resting on it fall too
  }
  return opened;
}

/**
 * Rebuild regions from the grid, KEEPING every active region (including newly
 * opened, ball-less space — it's now capturable, not a stray sliver). Exported
 * so the Clear All Fences ability (src/lib/abilities.ts) can reuse it.
 */
export function rebuildRegionsKeepAll(game: CanvasGameState): void {
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

// ── Treasure chests (#38) ────────────────────────────────────────────────────

/**
 * Roll and grant a smashed chest's reward (#38): ONE charge of an activatable
 * ability. The charge banks run-wide, so it bubbles via callbacks.onChestReward
 * to the session (GameCanvas -> onGrantAbility). Seeded per chest id, so daily /
 * record runs resolve identically. The loot gem is coloured by the ability.
 */
function grantChestReward(game: CanvasGameState, d: DestructibleState, callbacks: DestroyCallbacks, levelNumber: number): void {
  const rng = getRunRng(`chest:${d.id}`);
  // Random among abilities unlocked at this level, optionally narrowed to the
  // chest's authored pool (see abilities.ts / public/abilities.yml).
  const rewardId = rollAbilityReward(d.chestRewards, levelNumber, rng);
  if (!rewardId) return; // empty catalogue (should never happen)
  if (d.obstaclePolygon) {
    const c = polygonCentroid(d.obstaclePolygon);
    (game.chestLoot ??= []).push(makeChestLoot(`loot-${d.id}`, rewardId, c.x, c.y, game.activePlaySeconds));
  }
  (game.chestRewardsLog ??= []).push(rewardId);
  callbacks.onChestReward?.(rewardId);
}

// ── Processing queued destructions ──────────────────────────────────────────

export function processDestroysFn(game: CanvasGameState, callbacks: DestroyCallbacks, levelNumber = 1): void {
  const pending = game.pendingDestroys;
  game.pendingDestroys = [];
  if (pending.length === 0) return;

  const now = performance.now();
  let opened = 0;

  for (const d of pending) {
    // Mirror/mover kills drop the destroying (black) ball's lock multiplier.
    if ((d.kind === 'mirror' || d.kind === 'mover') && d.destroyedBy) {
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

    // Mirror or breakable obstacle: shatter in place, reopen its footprint.
    const poly = d.kind === 'mirror' ? d.mirrorPolygon : d.obstaclePolygon;
    if (!poly) continue;
    const color = d.kind === 'mirror' ? MIRROR_DEBRIS_COLOR : BREAKABLE_DEBRIS_COLOR;
    // Breakables throw a bigger, chunkier burst than mirrors on the final hit.
    const isBreak = d.kind === 'breakable';
    game.objectDebris.push(spawnDebris(poly, color, now, isBreak ? 30 : 16, isBreak ? 1.15 : 1));
    opened += detachObstacle(game, d.id, poly);

    if (d.kind === 'mirror') {
      game.mirrorPolygons = game.mirrorPolygons.filter(p => p !== poly);
      continue;
    }

    // Breakable obstacle (issue #38): smashing it awards bonus points (it is
    // NOT a win requirement — you still win by shrinking the board) and topples
    // whatever rests on it.
    if (d.objective) game.objectivesBroken++;
    game.breakBonus += d.objective ? BREAK_BONUS_OBJECTIVE : BREAK_BONUS_BASE;
    // Every smash also compounds the demolition multiplier, so stopping to
    // break things offsets the ship-early time it cost (issue #38).
    game.breakMultiplier = (game.breakMultiplier ?? 1) * BREAK_MULTIPLIER_PER;

    // Treasure chest (#38): a smash rolls a reward and grants it instantly.
    if (d.chest) grantChestReward(game, d, callbacks, levelNumber);

    // A gate breakable re-opens its sealed (locked) area as capturable space.
    if (d.sealedCells && d.sealedCells.length > 0 && game.spaceGrid) {
      reopenCells(game, d.sealedCells);
      opened += d.sealedCells.length;
    }

    const so = game.stackObjects.find(s => s.id === d.id);
    if (so) so.toppled = true;
    opened += toppleSupportedBy(game, d.id, now);
  }

  if (opened > 0 && game.spaceGrid) {
    // Reopened space a ball can actually reach becomes capturable again (the
    // point of breaking things). But a footprint reopened INSIDE captured
    // territory - e.g. a box toppled by the stack-chain when its supporter was
    // smashed on the other side of a sealed fence - is unreachable by every
    // ball, so it would linger forever as an uncapturable dark island in the
    // captured fill AND permanently inflate the remaining-%. Recapture every
    // reopened cell no ball can physically reach, right now.
    captureUnreachableCells(game.spaceGrid, game.balls, game.walls);
    rebuildRegionsKeepAll(game);
    // A destroy-recapture can swallow a token's cell with no lock involved.
    wasteCapturedPickups(game);
    callbacks.repaintRegionCanvas();
    callbacks.setRemainingPercent(Math.round(getRemainingPercent(game.spaceGrid)));
  }

  callbacks.onObjectDestroyed?.();
}
