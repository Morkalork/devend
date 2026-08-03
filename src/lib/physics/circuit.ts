/**
 * "Wire the Integration" (the greed hook on fence PLACEMENT). A map's circuit
 * has terminals the player lights by routing fences THROUGH them; when all are
 * lit the circuit completes and opens a sealed bonus vault (reuses the vault
 * reveal path) that also pays a lock multiplier. Run once per committed cut.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { GrowingWall, Vector2 } from "@/types/game";
import type { GameCallbacks } from "./gameCallbacks";
import { pointToSegmentDistance } from "@/lib/polygon";
import { getRemainingPercent, captureUnreachableCells } from "@/lib/spaceGrid";
import { reopenCells, rebuildRegionsKeepAll } from "./destructibles";
import { wasteCapturedPickups } from "@/lib/pickups";

/** The line segments of a just-committed cut (both grown halves of the fence). */
function cutSegments(wall: GrowingWall): Array<[Vector2, Vector2]> {
  const segs: Array<[Vector2, Vector2]> = [];
  const add = (wps: Vector2[]) => {
    for (let i = 0; i < wps.length - 1; i++) segs.push([wps[i], wps[i + 1]]);
  };
  add(wall.startWaypoints);
  add(wall.endWaypoints);
  return segs;
}

/** True when any of the fence's segments passes within `radius` of the point. */
function segmentsHitPoint(segs: Array<[Vector2, Vector2]>, x: number, y: number, radius: number): boolean {
  const p = { x, y };
  for (const [a, b] of segs) {
    if (pointToSegmentDistance(p, a, b) <= radius) return true;
  }
  return false;
}

/**
 * Update the circuit after a fence commits: light the terminals this cut routes
 * through and, if that completes the circuit, open the vault. No-op on maps
 * without a circuit or once it is already complete.
 */
export function tickCircuitOnCut(game: CanvasGameState, wall: GrowingWall, callbacks: GameCallbacks): void {
  const c = game.circuit;
  if (!c || c.complete) return;

  const segs = cutSegments(wall);
  if (segs.length === 0) return;

  if (c.singleCut) {
    // Hard mode: ONE fence must thread every terminal. Partial threading of a
    // single cut lights nothing (no persistence), so it stays all-or-nothing.
    if (!c.terminals.every(t => segmentsHitPoint(segs, t.x, t.y, t.radius))) return;
    for (const t of c.terminals) t.lit = true;
  } else {
    // Cumulative: light any still-unlit terminal this fence passes through.
    for (const t of c.terminals) {
      if (!t.lit && segmentsHitPoint(segs, t.x, t.y, t.radius)) t.lit = true;
    }
    if (!c.terminals.every(t => t.lit)) return;
  }

  completeCircuit(game, callbacks);
}

/** All terminals lit: open the sealed vault (reuse the reveal path) + tint it. */
function completeCircuit(game: CanvasGameState, callbacks: GameCallbacks): void {
  const c = game.circuit;
  if (!c) return;
  c.complete = true;

  const grid = game.spaceGrid;
  if (grid && c.revealCells.length > 0) {
    // Same reopen -> recapture -> rebuild -> repaint a vault gate uses
    // (destructibles.ts). The reopened cells become capturable ground; any that
    // no ball can reach are recaptured so the remaining-% stays honest.
    reopenCells(game, c.revealCells);
    captureUnreachableCells(grid, game.balls, game.walls);
    rebuildRegionsKeepAll(game);
    wasteCapturedPickups(game);
    callbacks.repaintRegionCanvas();
    callbacks.setRemainingPercent(Math.round(getRemainingPercent(grid)));
  }

  // The revealed pocket now pays its lock multiplier: bonusLockMultiplierAt
  // reads game.lockZones in checkBallWonState, so this needs no scoring change.
  game.lockZones = [...game.lockZones, c.bonusZone];

  callbacks.onCircuitComplete?.(c.announce);
}
