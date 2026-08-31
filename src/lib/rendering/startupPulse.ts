/**
 * The "look here" pulse every marked zone gets when a map opens.
 *
 * A colored area and a delivery box are both painted ON the floor, which is
 * exactly right once you have noticed them and useless before: a floor marking
 * is designed not to compete with the objects standing on it, so on a busy
 * board it is the first thing a player's eye skips. Reported as simply missing
 * them, and the fix is not to make them permanently louder - that would undo
 * the reason they are floor markings - but to make them announce themselves
 * once, at the moment the player is looking at the whole board anyway.
 *
 * ── Why active-play seconds ────────────────────────────────────────────────
 *
 * Timed on game.activePlaySeconds, not the wall clock. A map with a delivery
 * box opens behind that box's own explainer modal, and on the wall clock the
 * whole pulse would burn down while the player was reading it - so the one
 * announcement they were meant to see would already be over by the time the
 * board appeared. Every other timer in this game runs on active play for the
 * same family of reasons.
 */

/** How long the announcement lasts, in seconds of active play. */
export const STARTUP_PULSE_SECONDS = 3.2;

/** Beats within that window. Three reads as deliberate; one reads as a glitch. */
const BEATS = 3;

export interface StartupPulse {
  /** 0 when it is over. Overall strength, eased so it fades out rather than stopping. */
  strength: number;
  /** 0..1 within the current beat, for a ring that expands and repeats. */
  beat: number;
  /** True while anything should be drawn at all, so a caller can skip the work. */
  active: boolean;
}

/**
 * The envelope at this moment of a map.
 *
 * Separated from the drawing so the shape of the animation can be reasoned
 * about, and tested, without a renderer: "does it start strong", "does it
 * finish", "does it pulse more than once" are all questions about these three
 * numbers and none of them is a question about Pixi.
 */
export function startupPulse(activePlaySeconds: number): StartupPulse {
  const t = activePlaySeconds / STARTUP_PULSE_SECONDS;
  if (!(t >= 0) || t >= 1) return { strength: 0, beat: 0, active: false };

  // Fades out over the window rather than cutting: a marking that stops
  // pulsing mid-beat reads as a rendering fault.
  const strength = Math.pow(1 - t, 1.4);
  const beat = (t * BEATS) % 1;
  return { strength, beat, active: true };
}
