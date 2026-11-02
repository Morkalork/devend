/**
 * The analytics events raised from inside a map (src/lib/analytics.ts has the
 * schema): a life lost, with its reason, and a special fence type used.
 *
 * Here rather than in the session hook because only the map knows the reason a
 * life went (the MapFailure), how long the map had run and which mutator it
 * carries. Called on the rare moments these happen (a life, a finished fence),
 * never per frame. The headless bot runs the same code with no client, so its
 * calls are no-ops.
 */
import { analytics } from "@/lib/analytics";
import type { MapFailure } from "@/lib/mapFailure";
import type { CanvasGameState } from "@/types/gameState";
import { STANDARD_FENCE_ID } from "@/lib/fences";

/** Fence types already reported for this map (one board = one game object). */
const fenceTypesSeen = new WeakMap<CanvasGameState, Set<string>>();

/** A life just went. `livesLeft` is after the loss (0 = the run ends). */
export function reportLifeLost(
  game: CanvasGameState,
  levelNumber: number,
  failure: MapFailure,
  livesLeft: number,
): void {
  analytics.lifeLost({
    level: levelNumber,
    reason: failure.kind,
    seconds: Math.round(game.activePlaySeconds),
    livesLeft: Math.max(0, livesLeft),
    mutator: game.mapMutator?.id ?? null,
  });
}

/** A fence was finished; reports a non-standard type the first time per map. */
export function reportFenceFinished(
  game: CanvasGameState,
  levelNumber: number,
  fenceTypeId: string | undefined,
): void {
  if (!fenceTypeId || fenceTypeId === STANDARD_FENCE_ID) {
    return;
  }
  let seen = fenceTypesSeen.get(game);
  if (!seen) {
    seen = new Set<string>();
    fenceTypesSeen.set(game, seen);
  }
  if (seen.has(fenceTypeId)) {
    return;
  }
  seen.add(fenceTypeId);
  analytics.fenceTypeUsed({ fenceTypeId, level: levelNumber });
}

/** A Feature Freeze tap landed (net/commands.ts applyFreezeTap). */
export function reportFreezeTap(useCharge: boolean): void {
  analytics.abilityUsed({ abilityId: useCharge ? "freezeCharge" : "featureFreeze" });
}
