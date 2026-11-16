/**
 * What a build hands every map at the moment it starts: Cold Boot's frozen
 * opening, Cold Storage's frozen fastest balls and Reliability's opening slow.
 *
 * Lifted out of GameCanvas, unchanged, so the headless bot deals the same
 * start. It lived only in the component, so the bot never applied it and the
 * upgrade sweep reported Cold Boot as changing nothing in 240 runs.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import { simNow } from "@/lib/simClock";
import { START_FROZEN_SECONDS, startFrozenPicks } from "@/lib/offerPerks";

export function applyMapStartBoons(game: CanvasGameState, activeModifiers: GameModifiers): void {
  // Cold Boot: the map boots frozen, all balls hold still for a planning
  // beat. Same frozenUntil path as tap-freeze; freezeReadyAt is left unset
  // so the spawn thaw carries no re-freeze cooldown.
  if (activeModifiers.spawnFreezeSeconds > 0) {
    const thaw = simNow() + activeModifiers.spawnFreezeSeconds * 1000;
    for (const ball of game.balls) {
      ball.frozenUntil = thaw;
    }
  }
  // Cold Storage (Sprint Planning): the fastest balls start frozen, by the
  // same path, and never thaw EARLIER than a Cold Boot already holds them.
  if (activeModifiers.startFrozenBalls > 0) {
    const thaw = simNow() + START_FROZEN_SECONDS * 1000;
    for (const ball of startFrozenPicks(game.balls, activeModifiers.startFrozenBalls)) {
      ball.frozenUntil = Math.max(ball.frozenUntil ?? 0, thaw);
    }
  }
  // Reliability (Sprint Planning): the opening slow, read by updateBall.
  game.openingSlowSeconds = activeModifiers.openingSlowSeconds;
  // Permafrost: read by updateBall where a ball bounces off an Ice fence.
  game.iceFreezeSeconds = activeModifiers.iceFreezeSeconds;
  // Crash Barrier and Tensioned Wire: read where a Guardrail is struck and
  // where a finished fence is given its hit budget.
  game.guardrailExtraShields = Math.max(0, Math.round(activeModifiers.guardrailExtraShields));
  game.fenceExtraHits = Math.max(0, Math.round(activeModifiers.fenceExtraHits));
}

/** Shields granted fresh every map (Defensive Programming, Second Wind). */
export function mapStartShields(activeModifiers: GameModifiers): number {
  return Math.max(0, Math.round(activeModifiers.wallShieldsPerMap));
}

/** Feature Freeze taps for this map: the owned per-map allowance. */
export function mapStartFreezeUses(activeModifiers: GameModifiers): number {
  return Math.max(0, Math.round(activeModifiers.freezeUsesPerMap));
}
