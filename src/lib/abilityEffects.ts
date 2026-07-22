/**
 * Ability effects (destruct-up rewards, issue #38).
 *
 * The coded effect behind each ability KIND. `fireAbility` looks the pressed
 * ability up in the catalogue (src/lib/abilities.ts) and dispatches on its kind
 * with that entry's params, so YAML variants (a long freeze vs a short one) all
 * route through the same code.
 *
 *  - freeze:       freeze every active ball for a few seconds (frozenUntil).
 *  - slow:         globally slow every ball for a few seconds via game.creepFactor.
 *  - clearFences:  remove all player fences and reopen ALL non-locked captured
 *                  space while locked pockets stay captured.
 */
import { CanvasGameState } from "@/types/gameState";
import { getAbility } from "@/lib/abilities";
import { pointInPolygon, polygonCentroid } from "@/lib/polygon";
import {
  CellState,
  restoreCells,
  getRemainingPercent,
  gridIndexToWorld,
  captureUnreachableCells,
} from "@/lib/spaceGrid";
import { rebuildRegionsKeepAll } from "@/lib/physics/destructibles";

// Fallback params if a YAML entry omits them.
const DEFAULT_FREEZE_SECONDS = 3;
const DEFAULT_SLOW_SECONDS = 5;
const DEFAULT_SLOW_FACTOR = 0.45;
const DEFAULT_FENCE_RUSH_SECONDS = 4;
const DEFAULT_FENCE_RUSH_FACTOR = 6;
const DEFAULT_FENCE_SHIELD_SECONDS = 5;

/** The centre of the play area (board centroid; falls back to the board rect). */
function boardCenter(game: CanvasGameState): { x: number; y: number } {
  if (game.boardPolygon) return polygonCentroid(game.boardPolygon);
  const r = game.boardRect;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ── Freeze ───────────────────────────────────────────────────────────────────

/** Freeze every active ball for `durationMs` (won balls are already still). */
export function freezeAllBalls(game: CanvasGameState, now: number, durationMs: number): void {
  for (const b of game.balls) {
    if (b.state !== "active") continue;
    b.frozenUntil = now + durationMs;
    b.freezeReadyAt = now + durationMs; // no re-freeze churn during the hold
  }
}

// ── Slow ─────────────────────────────────────────────────────────────────────

/** Start a global slow: every ball moves at `factor` for `seconds`. */
export function applySlowAll(game: CanvasGameState, factor: number, seconds: number): void {
  game.abilitySlowUntil = game.activePlaySeconds + seconds;
  game.abilitySlowMult = factor;
}

/**
 * The Slow All displacement multiplier for the current frame (1 when inactive).
 * Folded into game.creepFactor in useGameLoop so ball movement AND the aim-line
 * predictor both see it. Self-reverting: it expires by clock comparison.
 */
export function abilitySpeedFactor(game: CanvasGameState): number {
  if (game.abilitySlowUntil !== undefined && game.activePlaySeconds < game.abilitySlowUntil) {
    return game.abilitySlowMult ?? 1;
  }
  return 1;
}

// ── Clear All Fences (full reset) ─────────────────────────────────────────────

export interface ClearFencesCallbacks {
  repaintRegionCanvas: () => void;
  setRemainingPercent: (percent: number) => void;
}

/**
 * Remove every player-drawn fence and reopen ALL non-locked captured space, so
 * an overwhelmed player gets the open board back to re-cut. Locked-ball pockets
 * (and their points) are preserved; remaining % rises. Reuses the space-grid +
 * region-rebuild machinery (see destructibles.ts).
 */
export function clearAllFences(game: CanvasGameState, callbacks: ClearFencesCallbacks): void {
  const grid = game.spaceGrid;
  if (!grid) return;

  // 1. Drop player fences, keep board + obstacle walls. A fence is any wall that
  //    is neither a board edge nor an obstacle edge. Reassign the array so
  //    reference-keyed render caches (glow / fence-clip) invalidate.
  const before = game.walls.length;
  game.walls = game.walls.filter(w => {
    const isBoard = w.isBoardEdge ?? w.id.startsWith("board-");
    return isBoard || w.id.startsWith("obstacle-");
  });
  if (game.walls.length === before) return; // nothing to clear

  // 2. Cells to PRESERVE = locked pockets. grid.lockCaptured marks them (>=1);
  //    union with won balls' authoritative assimilation cells for precision.
  const preserve = new Set<number>();
  const lockCap = grid.lockCaptured;
  if (lockCap) {
    for (let i = 0; i < lockCap.length; i++) if (lockCap[i] >= 1) preserve.add(i);
  }
  for (const a of game.assimilations.values()) {
    for (const idx of a.cellIndices) preserve.add(idx);
  }

  // 3. Reopen every REMOVED cell that is inside the board, not inside a solid
  //    obstacle/mirror, and not a preserved locked-pocket cell.
  const boardPoly = game.boardPolygon;
  const reopened: number[] = [];
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const idx = row * grid.width + col;
      if (grid.cells[idx] !== CellState.REMOVED || preserve.has(idx)) continue;
      const wx = grid.originX + col * grid.cellSize + grid.cellSize / 2;
      const wy = grid.originY + row * grid.cellSize + grid.cellSize / 2;
      const p = { x: wx, y: wy };
      if (boardPoly && !pointInPolygon(p, boardPoly)) continue; // board-outside margin
      let inSolid = false;
      for (const op of game.obstaclePolygons) if (pointInPolygon(p, op)) { inSolid = true; break; }
      if (!inSolid) for (const mp of game.mirrorPolygons) if (pointInPolygon(p, mp)) { inSolid = true; break; }
      if (inSolid) continue; // obstacle / mirror footprint
      reopened.push(idx);
    }
  }
  if (reopened.length > 0) {
    restoreCells(grid, reopened);
    // Register reopened cells as board-grid sample points so they render again,
    // but do NOT bump initialActiveCount: we WANT remaining % to rise (the reset).
    for (const idx of reopened) game.initialSamplePoints.push(gridIndexToWorld(grid, idx));
  }

  // 4. Re-seal anything still unreachable by an active ball (avoids uncapturable
  //    islands; won balls don't count), then rebuild regions + reassign balls.
  captureUnreachableCells(grid, game.balls, game.walls);
  rebuildRegionsKeepAll(game);

  callbacks.repaintRegionCanvas();
  callbacks.setRemainingPercent(Math.round(getRemainingPercent(grid)));
}

// ── Magnet / Shockwave (one-shot velocity redirects) ─────────────────────────

/**
 * Magnet: redirect every active ball straight toward the board centre (keeping
 * its speed), so they converge and cluster - a setup tool for a big multi-lock
 * or walling off a large empty region. One-shot.
 */
export function magnetPull(game: CanvasGameState): void {
  const c = boardCenter(game);
  for (const b of game.balls) {
    if (b.state !== "active") continue;
    const sp = Math.hypot(b.velocity.x, b.velocity.y);
    if (sp <= 0) continue;
    let dx = c.x - b.position.x, dy = c.y - b.position.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) continue; // already at the centre
    dx /= d; dy /= d;
    b.velocity.x = dx * sp; b.velocity.y = dy * sp;
  }
}

const DEFAULT_SHOCKWAVE_BOOST = 1.25;

/**
 * Shockwave: redirect every active ball straight AWAY from the board centre,
 * scattering a cluster and driving balls toward the edges, with a small outward
 * speed kick (`boost`) so the burst reads clearly. One-shot. Balls sitting on
 * the centre get a varied outward direction. `speed` never drops below the
 * ball's floor (the boost only ever speeds up).
 */
export function shockwavePush(game: CanvasGameState, boost = DEFAULT_SHOCKWAVE_BOOST): void {
  const c = boardCenter(game);
  game.balls.forEach((b, i) => {
    if (b.state !== "active") return;
    const sp = (Math.hypot(b.velocity.x, b.velocity.y) || b.baseSpeed || 100) * Math.max(1, boost);
    let dx = b.position.x - c.x, dy = b.position.y - c.y;
    let d = Math.hypot(dx, dy);
    if (d < 1) {
      // On the centre: fan out by index so a stacked cluster still spreads.
      const a = (i / Math.max(1, game.balls.length)) * Math.PI * 2;
      dx = Math.cos(a); dy = Math.sin(a); d = 1;
    }
    dx /= d; dy /= d;
    b.velocity.x = dx * sp; b.velocity.y = dy * sp; b.speed = sp;
  });
}

// ── Fence Overclock / Fence Shield (timed fence buffs) ────────────────────────

/** Start Fence Overclock: cuts build `factor`x faster (capped) for `seconds`. */
export function applyFenceRush(game: CanvasGameState, factor: number, seconds: number): void {
  game.abilityFenceRushUntil = game.activePlaySeconds + seconds;
  game.abilityFenceRushMult = factor;
}

/** Fence-growth-speed multiplier for the current frame (1 when inactive). Folded
 *  into updateFenceWall's growth speed; expires by the active-play clock. */
export function abilityFenceRushFactor(game: CanvasGameState): number {
  if (game.abilityFenceRushUntil !== undefined && game.activePlaySeconds < game.abilityFenceRushUntil) {
    return game.abilityFenceRushMult ?? 1;
  }
  return 1;
}

/** Start Fence Shield: the growing fence ignores ball hits for `seconds`. */
export function applyFenceShield(game: CanvasGameState, seconds: number): void {
  game.abilityFenceShieldUntil = game.activePlaySeconds + seconds;
}

/** True while a growing fence should phase through balls (Fence Shield active). */
export function abilityFenceShieldActive(game: CanvasGameState): boolean {
  return game.abilityFenceShieldUntil !== undefined && game.activePlaySeconds < game.abilityFenceShieldUntil;
}

// ── Visual feedback ───────────────────────────────────────────────────────────

/** How long the ability-fired flash/ring burst plays. */
const ABILITY_FX_MS = 650;

/**
 * Queue a full-board flash + ring burst so the player always sees the ability
 * fire, even when their situation shows no ball change. `expand` = rings grow
 * outward; false = converge inward (Magnet's gather).
 */
function pushAbilityFx(game: CanvasGameState, color: string, expand: boolean, now: number): void {
  (game.abilityFx ??= []).push({ color, expand, startTime: now, durationMs: ABILITY_FX_MS, center: boardCenter(game) });
}

/**
 * Dispatch a pressed ability by id: look up its catalogue entry and run the
 * coded effect for its kind with that entry's params. Returns false for an
 * unknown id or kind.
 */
export function fireAbility(
  id: string,
  game: CanvasGameState,
  now: number,
  clearCallbacks: ClearFencesCallbacks,
): boolean {
  const def = getAbility(id);
  if (!def) return false;
  let fired = true;
  switch (def.kind) {
    case "freeze":
      freezeAllBalls(game, now, (def.durationSeconds ?? DEFAULT_FREEZE_SECONDS) * 1000);
      break;
    case "slow":
      applySlowAll(game, def.factor ?? DEFAULT_SLOW_FACTOR, def.durationSeconds ?? DEFAULT_SLOW_SECONDS);
      break;
    case "clearFences":
      clearAllFences(game, clearCallbacks);
      break;
    case "magnet":
      magnetPull(game);
      break;
    case "shockwave":
      shockwavePush(game, def.factor ?? DEFAULT_SHOCKWAVE_BOOST);
      break;
    case "fenceRush":
      applyFenceRush(game, def.factor ?? DEFAULT_FENCE_RUSH_FACTOR, def.durationSeconds ?? DEFAULT_FENCE_RUSH_SECONDS);
      break;
    case "fenceShield":
      applyFenceShield(game, def.durationSeconds ?? DEFAULT_FENCE_SHIELD_SECONDS);
      break;
    default:
      fired = false;
  }
  // Always-visible feedback: a board flash + rings tinted by the ability. Magnet
  // converges (rings inward); everything else emanates outward.
  if (fired) pushAbilityFx(game, def.color, def.kind !== "magnet", now);
  return fired;
}
