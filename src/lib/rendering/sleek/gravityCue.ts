/**
 * The gravity indicator, as geometry.
 *
 * Reported three times from real play, most recently as "the gravity has gone
 * bananas" on a level 16 that had simply rolled the Technical Gravity mutator.
 * Nothing was wrong with the physics. Nothing told the player it was on:
 *
 *   - the board only TILTS to keep the pull at screen-bottom, and the opening
 *     phase pulls down, whose rest angle is zero. So the most common state of a
 *     gravity map is one that looks exactly like a map without gravity.
 *   - the board is SQUARE, so even at 90, 180 or 270 degrees the frame is
 *     unchanged; only its contents move.
 *   - the mutator's name lives inside the collapsed SPECS panel, one tap away
 *     and with nothing to say it matters.
 *   - and `secondsToNextShift` in gravity.ts has always been documented as
 *     being "for the on-screen indicator". Nothing ever called it. The
 *     indicator was designed and never built.
 *
 * So a mechanic that bends every path on the board had no expression on the
 * board, and a player meeting it reads a malfunction. MAP_DESIGN_GUIDELINES.md's third
 * convention already covers this: a Turn has to be visible coming or it is an
 * ambush.
 *
 * Split from the drawing for the same reason compassRing.ts is: the arithmetic
 * here (which way is the pull ON SCREEN, how long until it changes, where it
 * goes next) is the part worth testing, and a renderer that cannot compute is
 * a renderer that cannot be wrong about it.
 */
import {
  gravityVectorAt, gravityPhaseCount, secondsToNextShift,
  type GravityConfig,
} from "@/lib/physics/gravity";

/** The last stretch before a shift, when it should start catching the eye. */
export const URGENT_SECONDS = 1.5;

export interface GravityCue {
  /**
   * Unit vector the pull runs along, IN SCREEN SPACE, or null during a
   * gravity-free stretch.
   *
   * Screen space rather than world, because the board turns underneath the
   * pull to keep it at the bottom of the screen: a world-space arrow would
   * point somewhere the player is not being pulled for the 0.7s of every turn,
   * which is exactly the moment the cue matters most.
   */
  pull: { x: number; y: number } | null;
  /** Seconds until the pull changes. */
  secondsLeft: number;
  /** 0 at the start of the phase, 1 the instant it changes. */
  progress: number;
  /** In the final stretch: the shift is about to land. */
  urgent: boolean;
  /**
   * Where the pull goes at the next shift, in the CURRENT screen frame, or
   * null when the next stretch is a calm one.
   *
   * The current frame is the honest one to draw it in: the pull changes the
   * instant the phase does, and the board then spends 0.7s rotating to catch
   * up with it. So this is genuinely where everything is about to be dragged,
   * not a guess about where the screen will be pointing afterwards.
   */
  next: { x: number; y: number } | null;
}

/** Rotate a world vector into the frame the board is currently drawn in. */
function toScreen(v: { x: number; y: number }, tilt: number) {
  if (tilt === 0) return { x: v.x, y: v.y };
  const cos = Math.cos(tilt), sin = Math.sin(tilt);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/**
 * The cue for this moment, or null on a board where nothing pulls.
 *
 * Null rather than an all-zero cue so the caller can skip the whole draw: every
 * map that is not a gravity map pays nothing for this.
 */
export function gravityCue(
  cfg: GravityConfig | null | undefined,
  activeSeconds: number,
  tiltAngle: number,
): GravityCue | null {
  if (!cfg || cfg.sequence.length === 0) return null;

  const t = Number.isFinite(activeSeconds) && activeSeconds > 0 ? activeSeconds : 0;
  const pull = gravityVectorAt(t, cfg);

  // The pull one phase on. Read off the sequence rather than off a clock a
  // phase into the future, so it cannot disagree with what the physics will do.
  const nextIndex = (gravityPhaseCount(t, cfg) + 1) % cfg.sequence.length;
  const nextDir = cfg.sequence[nextIndex];
  const nextPull = nextDir === "none" ? null : gravityVectorAt(nextIndex * cfg.period, cfg);

  const secondsLeft = Math.max(0, secondsToNextShift(t, cfg));

  return {
    pull: pull ? toScreen(pull, tiltAngle) : null,
    secondsLeft,
    progress: cfg.period > 0 ? Math.max(0, Math.min(1, 1 - secondsLeft / cfg.period)) : 0,
    urgent: secondsLeft <= URGENT_SECONDS,
    next: nextPull ? toScreen(nextPull, tiltAngle) : null,
  };
}

/**
 * Which edge of the board a screen-space direction points at, as a rectangle
 * hugging that edge.
 *
 * The band is drawn on the edge the pull runs INTO, because that is where the
 * balls are going to end up: it reads as the low side of a tipped table, which
 * is the whole metaphor.
 *
 * A diagonal (mid-turn, when the board is part way round) takes whichever axis
 * dominates, so the band slides from one edge to the next over the turn rather
 * than blinking between them.
 */
export function pullEdge(
  dir: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  thickness: number,
): { x: number; y: number; width: number; height: number } {
  const { left, top, width, height } = rect;
  if (Math.abs(dir.x) >= Math.abs(dir.y)) {
    return dir.x >= 0
      ? { x: left + width - thickness, y: top, width: thickness, height }
      : { x: left, y: top, width: thickness, height };
  }
  return dir.y >= 0
    ? { x: left, y: top + height - thickness, width, height: thickness }
    : { x: left, y: top, width, height: thickness };
}
