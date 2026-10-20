/**
 * The arithmetic behind the startup splash (TapToStartGate), kept out of the
 * component so it can be tested without a renderer.
 */

/**
 * How long the first screen must stay ready before the splash lifts: the
 * menu's own entrance (its staggered fade-in, ~450ms) finishes under the
 * splash rather than in front of the player.
 */
export const SETTLE_MS = 500;
/** Never hold the splash longer than this, whatever is still loading. */
export const MAX_WAIT_MS = 10000;
/**
 * How long, from the moment the first screen has settled, to wait to learn
 * whether audio needs a tap; past it, it does not. Counted from the settle and
 * not from startup: the browser can only say "blocked" once the menu music has
 * tried to play, which waits on the music list, and on a slow connection that
 * outlasted a clock started at boot - the splash lifted without ever asking.
 */
export const AUDIO_DECISION_MS = 2500;

/**
 * Where the label sits: this far below the screen's centre (px), under the
 * logo, which alone is centred so the label can never move it.
 */
export const LABEL_BELOW_CENTRE = 56;

export type SplashPhase = "loading" | "tap" | "gone";

/**
 * What the splash shows. `settled`: the first screen is ready (and has stayed
 * so for SETTLE_MS), or MAX_WAIT_MS has passed. Audio: unlocked (autoplay was
 * allowed), awaiting a gesture (blocked), or neither yet, which after
 * AUDIO_DECISION_MS counts as allowed.
 */
export function splashPhase(s: {
  settled: boolean;
  tapped: boolean;
  audioUnlocked: boolean;
  awaitingGesture: boolean;
  audioDecisionTimedOut: boolean;
}): SplashPhase {
  if (s.tapped) {
    return "gone";
  }
  if (!s.settled) {
    return "loading";
  }
  if (s.audioUnlocked || (!s.awaitingGesture && s.audioDecisionTimedOut)) {
    return "gone";
  }
  return s.awaitingGesture ? "tap" : "loading";
}
