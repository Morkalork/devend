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
 *  - clearFences:  remove every player fence EXCEPT the ones sealing a locked
 *                  pocket, and reopen all non-locked captured space.
 */
import { CanvasGameState } from "@/types/gameState";
import { getAbility } from "@/lib/abilities";
import { pointInPolygon, polygonCentroid } from "@/lib/polygon";
import {
  CellState,
  restoreCells,
  getRemainingPercent,
  captureUnreachableCells,
} from "@/lib/spaceGrid";
import { rebuildRegionsKeepAll, spawnFenceShatter, pushReopenedSamplePoints } from "@/lib/physics/destructibles";

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
  /** Colour the cleared fences shatter into (usually the level accent). */
  fenceColor?: string;
}

/** Cap on fence-shatter bursts spawned at once, so a very cut-up board can't
 *  flood the debris renderer. */
const MAX_FENCE_SHATTERS = 40;

/** How far either side of a fence to look for locked ground, in cells. */
const LOCK_ADJACENCY_CELLS = 2;

/**
 * How far past the last locked sample a kept fence keeps running, in cells.
 *
 * This is the whole safety margin of the trim, and it exists for corners. Two
 * fences meeting at a pocket corner are each cut back to where they stop
 * bordering locked ground; without an overlap they would be cut back to
 * slightly different points and leave a notch at the corner, which is both ugly
 * and a hole a ball could pass through. Overshooting by more than a cell on
 * each end guarantees the pair still crosses.
 */
const TRIM_MARGIN_CELLS = 1.5;

/**
 * Below this, a trimmed fence is dropped rather than kept, in cells.
 *
 * A fence that only grazes a pocket corner is not sealing it, and a stub that
 * short is a speck of wall in open space. In practice the margin above means a
 * real contact always survives this.
 */
const MIN_KEPT_LENGTH_CELLS = 1;

/** A wall as this module needs it: a segment with an id. */
type Wall = CanvasGameState["walls"][number];

type Grid = NonNullable<CanvasGameState["spaceGrid"]>;

/** True when any cell within `bandCells` of a world point is locked ground. */
function touchesLocked(
  grid: Grid, x: number, y: number, bandCells: number, locked: Set<number>,
): boolean {
  const reach = grid.cellSize * bandCells;
  const span = Math.ceil(bandCells);
  const col0 = Math.floor((x - grid.originX) / grid.cellSize);
  const row0 = Math.floor((y - grid.originY) / grid.cellSize);
  for (let row = row0 - span; row <= row0 + span; row++) {
    for (let col = col0 - span; col <= col0 + span; col++) {
      if (row < 0 || col < 0 || row >= grid.height || col >= grid.width) continue;
      const cx = grid.originX + (col + 0.5) * grid.cellSize;
      const cy = grid.originY + (row + 0.5) * grid.cellSize;
      if (Math.hypot(cx - x, cy - y) > reach) continue;
      if (locked.has(row * grid.width + col)) return true;
    }
  }
  return false;
}

/**
 * The stretch of a wall that runs alongside locked ground, as [t0,t1] in 0..1,
 * already widened by the corner margin. Null when it never touches one.
 */
function lockedSpan(
  grid: Grid, wall: Wall, locked: Set<number>,
): { t0: number; t1: number } | null {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001 || locked.size === 0) return null;

  const steps = Math.max(1, Math.ceil(length / (grid.cellSize * 0.5)));
  let first = -1;
  let last = -1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    if (!touchesLocked(grid, wall.start.x + dx * t, wall.start.y + dy * t, LOCK_ADJACENCY_CELLS, locked)) {
      continue;
    }
    if (first < 0) first = s;
    last = s;
  }
  if (first < 0) return null;

  // One span from the first contact to the last, not one per run of contacts: a
  // fence that borders a pocket, crosses a gap and borders it again is a single
  // piece of wall, and cutting the middle out of it would open the pocket.
  const margin = (grid.cellSize * TRIM_MARGIN_CELLS) / length;
  return {
    t0: Math.max(0, first / steps - margin),
    t1: Math.min(1, last / steps + margin),
  };
}

/** Cell indices a fence's body covers, within `bandCells` of its segment. */
function cellsUnderWall(grid: Grid, wall: Wall, bandCells: number): number[] {
  const out: number[] = [];
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return out;

  const reach = grid.cellSize * bandCells;
  const steps = Math.ceil(length / (grid.cellSize * 0.5));
  const span = Math.ceil(bandCells);

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = wall.start.x + dx * t;
    const y = wall.start.y + dy * t;
    const col0 = Math.floor((x - grid.originX) / grid.cellSize);
    const row0 = Math.floor((y - grid.originY) / grid.cellSize);
    for (let row = row0 - span; row <= row0 + span; row++) {
      for (let col = col0 - span; col <= col0 + span; col++) {
        if (row < 0 || col < 0 || row >= grid.height || col >= grid.width) continue;
        const cx = grid.originX + (col + 0.5) * grid.cellSize;
        const cy = grid.originY + (row + 0.5) * grid.cellSize;
        if (Math.hypot(cx - x, cy - y) > reach) continue;
        out.push(row * grid.width + col);
      }
    }
  }
  return out;
}

/** Point at `t` along a wall. */
const along = (wall: Wall, t: number) => ({
  x: wall.start.x + (wall.end.x - wall.start.x) * t,
  y: wall.start.y + (wall.end.y - wall.start.y) * t,
});

/**
 * A wall cut down to [t0,t1] of its length.
 *
 * The cached collision AABB and the raster-cell list both describe the OLD
 * geometry, so they are dropped: the physics hot loop refills the AABB lazily,
 * and the cell list is recomputed from the new body with locked cells excluded,
 * so a later fracture cannot reopen the pocket this wall is holding.
 */
function trimWall(grid: Grid, wall: Wall, t0: number, t1: number, locked: Set<number>): Wall {
  const trimmed: Wall = {
    ...wall,
    start: along(wall, t0),
    end: along(wall, t1),
    aabbMinX: undefined,
    aabbMinY: undefined,
    aabbMaxX: undefined,
    aabbMaxY: undefined,
    rasterCells: undefined,
  };
  if (wall.rasterCells) {
    trimmed.rasterCells = cellsUnderWall(grid, trimmed, 1).filter(i => !locked.has(i));
  }
  return trimmed;
}

/**
 * Clear the player's fences, EXCEPT the ones holding a lock together.
 *
 * The original version dropped every fence and simply kept the locked cells
 * captured. On screen that is a locked pocket with no walls around it: tinted,
 * still counted, and floating in reopened space with nothing explaining why it
 * is still there. Reported from level 7, and it is worse the better the player
 * was doing, because a pocket sealed mid-board has no board edge to fall back
 * on and loses its outline entirely.
 *
 * So a fence that borders locked ground stays, along with the strip of grid it
 * occupies. That keeps every pocket sealed by exactly the walls that sealed it,
 * which is also the honest picture: those fences are load-bearing, and the rest
 * were the mess the player asked to be rid of.
 *
 * A kept fence is also CUT BACK to the stretch that does the sealing. Keeping
 * whole walls was the first attempt and it looked worse than the bug: a pocket
 * in one corner left a fence running the full height of the board and another
 * out to the far edge, so the board read as a lock plus two arbitrary lines
 * going nowhere. What the player wants left is the pocket, so the wall stops
 * where the pocket does, plus a margin so corners still overlap.
 *
 * The awkward cases resolve in favour of the picture staying coherent:
 *  - A pocket sealed mid-board keeps its whole loop, because every wall on that
 *    loop borders it.
 *  - Two pockets sharing a wall keep the stretch spanning both, since the span
 *    runs from first contact to last rather than per run of contacts. Cutting
 *    the middle out would open them.
 *  - A fence only grazing a corner is dropped, not left as a speck of wall.
 *  - Space that the kept fences now enclose with no ball in it is re-sealed by
 *    captureUnreachableCells below, so no unreachable hole is left behind.
 *
 * Returns false when there was nothing to clear, so the caller can decline to
 * spend the charge (see fireAbility).
 */
export function clearAllFences(game: CanvasGameState, callbacks: ClearFencesCallbacks): boolean {
  const grid = game.spaceGrid;
  if (!grid) return false;

  // 1. Locked ground: grid.lockCaptured marks it (>=1), unioned with won balls'
  //    authoritative assimilation cells for precision.
  const locked = new Set<number>();
  const lockCap = grid.lockCaptured;
  if (lockCap) {
    for (let i = 0; i < lockCap.length; i++) if (lockCap[i] >= 1) locked.add(i);
  }
  for (const a of game.assimilations.values()) {
    for (const idx of a.cellIndices) locked.add(idx);
  }

  // 2. Work out what survives. A fence is any wall that is neither a board edge
  //    nor an obstacle edge; what survives of it is the stretch bordering a
  //    lock, and every other piece of wall on the board shatters.
  const isFence = (w: Wall) =>
    !(w.isBoardEdge ?? w.id.startsWith("board-")) && !w.id.startsWith("obstacle-");
  const minKept = grid.cellSize * MIN_KEPT_LENGTH_CELLS;

  const kept: Wall[] = [];
  /** The pieces that go: whole fences, and the offcuts of trimmed ones. */
  const shards: { start: { x: number; y: number }; end: { x: number; y: number } }[] = [];
  let changed = false;

  for (const w of game.walls) {
    if (!isFence(w)) continue;

    const span = lockedSpan(grid, w, locked);
    if (!span) {
      shards.push({ start: w.start, end: w.end });
      changed = true;
      continue;
    }

    const length = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    if ((span.t1 - span.t0) * length < minKept) {
      shards.push({ start: w.start, end: w.end }); // a graze, not a seal
      changed = true;
      continue;
    }

    if (span.t0 <= 0 && span.t1 >= 1) {
      kept.push(w); // the whole wall does the sealing
      continue;
    }

    // Trimmed: keep the sealing stretch, shatter the offcuts at either end.
    if (span.t0 > 0) shards.push({ start: w.start, end: along(w, span.t0) });
    if (span.t1 < 1) shards.push({ start: along(w, span.t1), end: w.end });
    kept.push(trimWall(grid, w, span.t0, span.t1, locked));
    changed = true;
  }

  if (!changed) return false; // every fence is already exactly a lock's wall

  // Reassign the array so reference-keyed render caches (glow / fence-clip)
  // invalidate. Kept walls may be trimmed copies, so rebuild from scratch.
  game.walls = [...game.walls.filter(w => !isFence(w)), ...kept];

  // Shatter what went into flying shards (like the map-clear shatter), so it
  // breaks apart instead of just vanishing.
  const now = performance.now();
  const color = callbacks.fenceColor ?? "#00ff88";
  game.objectDebris ??= [];
  for (const piece of shards.slice(0, MAX_FENCE_SHATTERS)) {
    game.objectDebris.push(spawnFenceShatter(piece.start, piece.end, color, now));
  }

  // 3. Cells to PRESERVE = the locked pockets, plus the ground the kept fences
  //    stand on. Without the second part a kept wall would be drawn over live
  //    space, which reads as a fence floating above the board.
  const preserve = new Set(locked);
  for (const w of kept) {
    for (const idx of cellsUnderWall(grid, w, 1)) preserve.add(idx);
  }

  // 4. Reopen every REMOVED cell that is inside the board, not inside a solid
  //    obstacle/mirror, and not preserved.
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
    // Dedupe (issue #65): seal-band cells are already sampled, re-adding doubles
    // the grid squares there into a visible denser patch.
    pushReopenedSamplePoints(game, reopened);
  }

  // 5. Re-seal anything still unreachable by an active ball (avoids uncapturable
  //    islands; won balls don't count), then rebuild regions + reassign balls.
  //    This is also what tidies up after the kept fences: any space they still
  //    enclose with no ball in it goes back to captured rather than sitting
  //    there as an open hole nothing can reach.
  captureUnreachableCells(grid, game.balls, game.walls);
  rebuildRegionsKeepAll(game);

  callbacks.repaintRegionCanvas();
  callbacks.setRemainingPercent(Math.round(getRemainingPercent(grid)));
  return true;
}

// ── Magnet / Shockwave (one-shot velocity redirects) ─────────────────────────

/**
 * Magnet: redirect every active ball straight toward `target` (keeping its
 * speed), so they converge and cluster - a setup tool for a big multi-lock or
 * walling off a large empty region. One-shot. Target defaults to the board
 * centre; the player picks a point (the ability is `targeted`).
 */
export function magnetPull(game: CanvasGameState, target?: { x: number; y: number }): void {
  const c = target ?? boardCenter(game);
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
 * the centre get a varied outward direction.
 *
 * Crucially it also RE-ENERGISES a stalled ball: the outward speed is floored at
 * the ball's baseSpeed (times the boost), so a ball that has slowed to a crawl
 * is relaunched at full speed rather than nudged along at its dying pace. This
 * is what makes Shockwave the game's "get the balls moving again" safety valve.
 */
export function shockwavePush(game: CanvasGameState, boost = DEFAULT_SHOCKWAVE_BOOST): void {
  const c = boardCenter(game);
  game.balls.forEach((b, i) => {
    if (b.state !== "active") return;
    const cur = Math.hypot(b.velocity.x, b.velocity.y);
    const sp = Math.max(cur, b.baseSpeed || 100) * Math.max(1, boost);
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
function pushAbilityFx(game: CanvasGameState, color: string, expand: boolean, now: number, center?: { x: number; y: number }): void {
  (game.abilityFx ??= []).push({ color, expand, startTime: now, durationMs: ABILITY_FX_MS, center: center ?? boardCenter(game) });
}

/**
 * Fire a TARGETED ability at a board point the player picked (Magnet). Runs the
 * effect toward `target` and plays the burst centred there. Returns false for a
 * non-targeted / unknown id.
 */
export function fireTargetedAbility(id: string, game: CanvasGameState, now: number, target: { x: number; y: number }): boolean {
  const def = getAbility(id);
  if (!def || !def.targeted) return false;
  if (def.kind === "magnet") {
    magnetPull(game, target);
    pushAbilityFx(game, def.color, false, now, target); // converge on the chosen point
    // A fading magnet icon marks exactly where the player pulled the balls to.
    game.magnetMarker = { x: target.x, y: target.y, startTime: now };
    return true;
  }
  return false;
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
      // Declines when every fence is holding a lock: nothing would change, and
      // burning a charge for no effect is worse than the button not responding.
      fired = clearAllFences(game, clearCallbacks);
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
