/**
 * One line under the board, and which of the three things gets it.
 *
 * The refusal message, the Ship Early countdown and the ability timers each
 * had their own separately positioned bar. None of them is on most of the
 * time, so the stack was usually mostly empty - but each appeared and
 * disappeared independently, which meant the whole bottom of the screen moved
 * whenever any of them changed. A control that shifts while you are reaching
 * for it is worse than one that is slightly too small, and the ability buttons
 * sat directly underneath.
 *
 * So they share one slot, the slot always reserves its height, and this decides
 * who is in it. The height is reserved even when the answer is `null`, which is
 * the entire point: an empty lane that occupies space is what stops the layout
 * moving.
 *
 * The push exit is deliberately NOT in here. It is an action, not a readout,
 * and it belongs with the controls - and it was reported missing once already
 * while it was on screen, so it is not going to be put in a queue behind a
 * transient message.
 */

/** Who is using the slot. */
export type ContextLane = "message" | "shipEarly" | "abilityTimers" | null;

export interface ContextState {
  /** The map is over; the results own the screen now. */
  mapComplete: boolean;
  /** A refusal is up: why the last cut did nothing. */
  hasMessage: boolean;
  /** This map has a deadline and is not mid-push. */
  shipEarlyVisible: boolean;
  /** Abilities currently counting down. */
  timerCount: number;
}

/**
 * Which lane owns the slot.
 *
 * Ordered by how long the player has to act on it, shortest first.
 *
 *   message       transient and self-expiring, and it is the answer to
 *                 something the player just tried and got nothing from. If it
 *                 loses the slot it is simply never seen.
 *   shipEarly     a bonus window closing over tens of seconds. Worth watching,
 *                 survivable to miss for four seconds while a message shows.
 *   abilityTimers ambient. The ability is already running; the countdown is
 *                 information about something that is going to finish either
 *                 way.
 */
export function pickContext(state: ContextState): ContextLane {
  if (state.mapComplete) return null;
  if (state.hasMessage) return "message";
  if (state.shipEarlyVisible) return "shipEarly";
  if (state.timerCount > 0) return "abilityTimers";
  return null;
}
