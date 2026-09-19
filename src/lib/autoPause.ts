/**
 * Pausing when the player stops looking.
 *
 * This game is meant to be played on a commute, on a sofa, in the two minutes
 * before something else happens - and nothing in it paused when the phone did.
 * A call, a notification, a lock screen: the map just carried on. It never
 * produced a catch-up spiral, because the loop clamps its delta to 50ms, so the
 * failure was quiet rather than dramatic. The balls crept while you were not
 * watching, and the browser throttling requestAnimationFrame was the only thing
 * limiting the damage - which is a side effect, not a decision.
 *
 * The conditions live here rather than inline in the effect because they are
 * the whole feature. Pausing is one line; knowing WHEN not to is the part that
 * goes wrong, and it goes wrong in ways that only show up on a device.
 */

export interface AutoPauseState {
  /** document.visibilityState === "hidden". */
  hidden: boolean;
  /** The player already paused by hand. */
  alreadyPaused: boolean;
  /** A modal or panel is up, which already holds the loop. */
  modalActive: boolean;
  /**
   * The map is over: the results overlay is up, owned by the screen ABOVE this
   * one, which stays mounted over a live GameScreen. Pausing here would drop a
   * "PAUSED" sheet on top of a player's score.
   */
  levelEnded: boolean;
}

/**
 * Whether hiding the page should pause the game.
 *
 * Only ever returns true for `hidden`: this never RESUMES. Coming back has to
 * be a deliberate tap, because the alternative is the board springing to life
 * in the half second it takes to look at the screen again, which is precisely
 * the moment the player has no idea what is happening.
 */
export function shouldAutoPause(state: AutoPauseState): boolean {
  if (!state.hidden) return false;
  return pauseIsWelcome(state);
}

/**
 * Whether a viewport that is stuck zoomed should pause the game.
 *
 * The fourth report of an accidental zoom came with "it is breaking
 * everything", and it is the right description: the board no longer fits the
 * screen, half the HUD is outside it, and the balls carry on regardless. The
 * page cannot always be un-zoomed (lib/viewportZoom explains why not), but it
 * can always stop costing the player lives while they sort the view out.
 *
 * Same three exemptions as hiding, for the same reasons, and it never RESUMES
 * either: coming back is a deliberate tap, because a board that springs to life
 * as the view settles is the same surprise this is trying to prevent.
 */
export function shouldPauseForZoom(state: AutoPauseState & { zoomStuck: boolean }): boolean {
  if (!state.zoomStuck) return false;
  return pauseIsWelcome(state);
}

/** The conditions under which an automatic pause is not an interruption. */
function pauseIsWelcome(state: AutoPauseState): boolean {
  if (state.alreadyPaused) return false;
  if (state.modalActive) return false;
  if (state.levelEnded) return false;
  return true;
}
