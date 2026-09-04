/**
 * Fence budget / "WIP Limit" (MAP_DESIGN_GUIDELINES.md modifier).
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
 * What running out of fences should do here.
 *
 * `fail` is the ordinary case: the last allowed fence completed, the map is not
 * won, you are out of moves.
 *
 * `bank` is the case this used to get wrong. The old rule simply returned false
 * whenever the push flow was open, meaning to spare a WINNING final cut from
 * failing - and in doing so it stopped the budget counting for the whole push.
 * You could cut past it indefinitely (level 17 has a budget of 10 and the
 * report came with 13 cuts on the HUD), which both makes the WIP limit
 * meaningless on exactly the maps built around it AND strands you: no fail, no
 * end, and if the last ball cannot be sealed, nothing left to do.
 *
 * It banks rather than fails because the map was already WON when the prompt
 * opened. The push is a bet on extra, and running out of fences is the end of
 * the bet, not a reason to take back a win the player had already earned.
 */
export type FenceBudgetOutcome = "none" | "fail" | "bank";

export function fenceBudgetOutcome(
  fenceBudget: number | undefined,
  completedCuts: number,
  flags: FenceBudgetFlags,
): FenceBudgetOutcome {
  if (fenceBudget == null) return "none";
  if (completedCuts < fenceBudget) return "none";
  if (flags.levelComplete || flags.gameOver) return "none";
  // The prompt is open and the player has not chosen yet: the cut that opened
  // it must not fail them, and there is nothing to bank that banking would not
  // already do.
  if (flags.pushMode === "prompt" || flags.pushPromptPending) return "none";
  return flags.pushMode === "pushing" ? "bank" : "fail";
}

/** Kept for the callers that only ask "should this map fail". */
export function fenceBudgetExhausted(
  fenceBudget: number | undefined,
  completedCuts: number,
  flags: FenceBudgetFlags,
): boolean {
  return fenceBudgetOutcome(fenceBudget, completedCuts, flags) === "fail";
}

/** Fences remaining (never negative), for the HUD. */
export function fencesLeft(fenceBudget: number, completedCuts: number): number {
  return Math.max(0, fenceBudget - completedCuts);
}
