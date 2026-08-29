/**
 * Push Your Luck: what a push has earned, and when you are allowed to stop.
 *
 * Clearing a map opens a choice: bank it, or keep cutting for extra hours at no
 * risk. The payout is one hour per quarter of the area that was still on the
 * board when the push began.
 *
 * That arithmetic used to live in three places - the bank path in GameCanvas
 * and both game-over paths in handleGameOver - written out longhand each time.
 * Three copies was survivable while nothing else read it. It stops being
 * survivable the moment the exit button shows the player what they are about to
 * bank, because a button computing the number a fourth way is a promise the
 * payout does not have to keep. So there is one function, and everything that
 * says a number calls it.
 */

/**
 * One chunk: a quarter of whatever was left when the push started.
 *
 * Deliberately measured against the START, not against what is left now. The
 * reward for pushing must not shrink as you succeed at it.
 */
export function pushChunkSize(startPercent: number): number {
  return startPercent * 0.25;
}

/**
 * Hours earned by a push, given how much board is left now.
 *
 * `currentPercent` is what remains: the caller decides whether that is the
 * live figure or the best ever reached, and the two differ on purpose. Banking
 * pays on the best the player got to, so a ball creeping space back after a
 * good cut cannot take an already-earned hour away; a failed push settles on
 * where it actually ended.
 *
 * Floored, not rounded, so a chunk pays only once it is genuinely complete -
 * the readout on the exit button and the hours in the results have to be the
 * same number, and rounding up would make the button promise an hour the
 * payout then declines to give.
 */
export function pushBonusEarned(
  startPercent: number,
  currentPercent: number,
  multiplier: number,
): number {
  const chunk = pushChunkSize(startPercent);
  if (!(chunk > 0)) return 0;
  const cleared = Math.max(0, startPercent - currentPercent);
  const bonus = Math.round(Math.floor(cleared / chunk) * multiplier);
  // A negative or non-finite multiplier is a config error, not a penalty: a
  // push is advertised as risk-free, so the worst it may ever pay is nothing.
  return Number.isFinite(bonus) ? Math.max(0, bonus) : 0;
}

/** What the exit button needs to know to decide whether to show itself. */
export interface PushExitState {
  /** The map is finished and the results are coming: nothing left to choose. */
  mapComplete: boolean;
  /** The player took the push and is back on the board. */
  pushMode: "none" | "prompt" | "pushing";
  /** The bank handler has been plumbed through from the canvas. */
  hasHandler: boolean;
}

/**
 * Whether to offer a way out of a push.
 *
 * Only while actually pushing. Not during the prompt, which carries its own
 * Bank button and where a second one would be two controls doing one job; and
 * not once the map is complete, where the button would sit over the results.
 *
 * This is a rule about a trap, which is why it is worth its own function and
 * its own test: before there was any exit at all, taking the push and then
 * finding the last ball unsealable left the player cutting at a board that
 * could never finish, with no way to take the hours they had already earned.
 */
export function canStopPushing(state: PushExitState): boolean {
  if (state.mapComplete) return false;
  if (state.pushMode !== "pushing") return false;
  if (!state.hasHandler) return false;
  return true;
}
