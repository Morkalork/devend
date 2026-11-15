/**
 * How many fences may grow at once: 1, plus the additionalConcurrentFences
 * modifier, plus one while Fence Overclock is active (#38).
 *
 * In lib rather than useGameInput so the headless bot obeys the same limit:
 * it drew one fence at a time whatever the build, so Multithreading measured
 * as changing nothing.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import { abilityFenceRushFactor } from "@/lib/abilityEffects";

export function concurrentFenceLimit(game: CanvasGameState, activeModifiers: GameModifiers): number {
  const extra = Math.max(0, Math.round(activeModifiers.additionalConcurrentFences));
  return 1 + extra + (abilityFenceRushFactor(game) > 1 ? 1 : 0);
}
