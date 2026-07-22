/**
 * Player-activatable abilities ("ability bar", issue #38).
 *
 * Abilities are EARNED by smashing treasure chests (destruct-ups): each chest
 * grants one charge of the rolled ability, banked run-wide in the session. The
 * ability bar beneath the board shows the player's charges; pressing a button
 * spends one charge and fires the effect here.
 *
 * Three abilities:
 *  - freezeAll:    freeze every active ball for a few seconds (reuses the
 *                  per-ball frozenUntil freeze primitive; physics skips them).
 *  - slowAll:      globally slow every ball for a few seconds by folding a
 *                  factor into game.creepFactor (self-reverting, pause-safe).
 *  - clearFences:  remove all player fences and reopen ALL non-locked captured
 *                  space (remaining % rises) while locked pockets stay captured.
 *
 * Tuning lives here as constants (matching the sibling chests.ts / destructibles
 * .ts convention), so a single file owns each ability's numbers + logic.
 */
import { CanvasGameState } from "@/types/gameState";
import { ChestRewardId } from "@/lib/chests";
import { pointInPolygon } from "@/lib/polygon";
import {
  CellState,
  restoreCells,
  getRemainingPercent,
  gridIndexToWorld,
  captureUnreachableCells,
} from "@/lib/spaceGrid";
import { rebuildRegionsKeepAll } from "@/lib/physics/destructibles";

/** An ability id is the same string as its chest reward id. */
export type AbilityId = ChestRewardId; // "freezeAll" | "slowAll" | "clearFences"

/** All ability ids, in bar display order. */
export const ABILITY_IDS: AbilityId[] = ["freezeAll", "slowAll", "clearFences"];

// ── Tuning ───────────────────────────────────────────────────────────────────
/** Freeze All: how long every ball stays frozen (ms, performance.now clock). */
export const FREEZE_ALL_MS = 3000;
/** Slow All: creepFactor multiplier applied to every ball while active (<1). */
export const SLOW_ALL_FACTOR = 0.45;
/** Slow All: how long the global slow lasts (active-play seconds). */
export const SLOW_ALL_SECONDS = 5;

// ── Freeze All ───────────────────────────────────────────────────────────────

/** Freeze every active ball for FREEZE_ALL_MS (won balls are already still). */
export function freezeAllBalls(game: CanvasGameState, now: number): void {
  for (const b of game.balls) {
    if (b.state !== "active") continue;
    b.frozenUntil = now + FREEZE_ALL_MS;
    b.freezeReadyAt = now + FREEZE_ALL_MS; // no re-freeze churn during the hold
  }
}

// ── Slow All ─────────────────────────────────────────────────────────────────

/** Start a global slow: every ball moves at SLOW_ALL_FACTOR for SLOW_ALL_SECONDS. */
export function applySlowAll(game: CanvasGameState): void {
  game.abilitySlowUntil = game.activePlaySeconds + SLOW_ALL_SECONDS;
  game.abilitySlowMult = SLOW_ALL_FACTOR;
}

/**
 * The Slow All displacement multiplier for the current frame (1 when inactive).
 * Folded into game.creepFactor in useGameLoop so ball movement AND the aim-line
 * predictor both see it. Self-reverting: it just expires by clock comparison.
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

/** Dispatch a pressed ability by id. Returns false for an unknown id. */
export function fireAbility(
  id: string,
  game: CanvasGameState,
  now: number,
  clearCallbacks: ClearFencesCallbacks,
): boolean {
  switch (id) {
    case "freezeAll": freezeAllBalls(game, now); return true;
    case "slowAll": applySlowAll(game); return true;
    case "clearFences": clearAllFences(game, clearCallbacks); return true;
    default: return false;
  }
}
