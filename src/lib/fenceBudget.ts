/**
 * Fence budget / "WIP Limit" (LEVELDESIGN.md modifier).
 *
 * A per-map cap on COMPLETED fences. When the last allowed fence completes and
 * the map still is not won, the player has run out of moves: lose a life and
 * restart the map. Only successful partitions count toward the budget (a fence a
 * ball destroys mid-draw never completes, so it is free, no double jeopardy with
 * the existing "ball wrecks your fence" tension).
 */

export interface FenceBudgetFlags {
  levelComplete: boolean;
  gameOver: boolean;
  pushMode: "none" | "prompt" | "pushing";
  pushPromptPending: boolean;
}

/**
 * True when the map should fail for running out of fences: a budget is set, it
 * has been reached, and the map is still in normal play (not won, not already
 * over, and not in the push-your-luck flow that a winning final cut opens).
 */
export function fenceBudgetExhausted(
  fenceBudget: number | undefined,
  completedCuts: number,
  flags: FenceBudgetFlags,
): boolean {
  if (fenceBudget == null) return false;
  if (completedCuts < fenceBudget) return false;
  return !flags.levelComplete && !flags.gameOver && flags.pushMode === "none" && !flags.pushPromptPending;
}

/** Fences remaining (never negative), for the HUD. */
export function fencesLeft(fenceBudget: number, completedCuts: number): number {
  return Math.max(0, fenceBudget - completedCuts);
}
