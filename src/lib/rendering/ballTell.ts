/**
 * The light saying what the ball is about to do.
 *
 * The flicker (ballLife.ts) is a hashed function of the clock: the prettiest
 * thing on the board, and it means nothing. That is a waste of the one channel
 * the player is already watching, because the ball IS what they are tracking
 * and its light is the largest, softest, most peripherally visible thing about
 * it. A rhythm the eye can learn costs exactly what a rhythm it cannot costs.
 *
 * So three moments, all driven by state that already existed and none of them
 * a new mechanic:
 *
 *   THE COUNTDOWN  A compass ball turns ninety degrees on a timer, and the
 *     only warning is a ring you have to be looking AT. Its light now beats
 *     with that same countdown and quickens into the turn, so the warning
 *     reaches the corner of your eye from across the board.
 *   WAKING         A sleeper switching on instantly is a state change, not an
 *     event. A filament coming up to temperature - a dull ember, then its
 *     colour - is an event, and the truer picture of a thing that was off.
 *   DYING          A locked ball's pool used to fade in place, which reads as
 *     the light going out. Collapsing it inward instead reads as the ball
 *     taking its light WITH it into the pocket, which is what is happening.
 *
 * Pure, and hung off the clock rather than off stored animation state, so two
 * devices at the same timestamp light identically and there is nothing to
 * tick, reset or clean up.
 */

import type { Ball } from "@/types/game";
import { turnProgress } from "@/lib/physics/turnTimer";

/** How long a ball's light takes to come up to temperature, in ms. */
export const WARMUP_MS = 900;

/**
 * The ember a cold filament starts at.
 *
 * A deep red-orange, rather than "the ball's own colour, dimmer". Dimming
 * alone reads as a ball that is far away or half occluded; a hue that is
 * WRONG and then corrects itself is what reads as coming up to temperature,
 * and it is also how an incandescent actually behaves.
 */
export const WARMUP_EMBER = 0x6b1d08;

/**
 * How far into the warm-up the colour has arrived.
 *
 * Ahead of the brightness on purpose. A filament reaches its colour before it
 * reaches full output, and doing it the other way round gives a ball that is
 * already at full brightness in the wrong hue, which reads as a bug.
 */
export const WARMUP_HUE_LEAD = 1.7;

/** Beats per countdown for the compass tell, and how much it swings. */
export const TELL_BEATS = 4;
export const TELL_DEPTH = 0.38;

/** How much of its reach a locked ball's pool has left when it is fully drained. */
export const COLLAPSE_TO = 0.18;

export interface Warmup {
  /** Multiplier on intensity, 0 at the instant of switch-on. */
  gain: number;
  /** How far the colour has travelled from the ember to the ball's own, 0..1. */
  hue: number;
}

/**
 * Where a ball is in its warm-up. `spawnTime` is stamped both at map start and
 * again when a sleeper is booted (circuit.ts, launcher.ts), so this covers the
 * board powering on and one ball waking with the same clock and no new field.
 */
export function warmup(nowMs: number, spawnTime: number | undefined): Warmup {
  if (spawnTime === undefined) return { gain: 1, hue: 1 };
  const t = (nowMs - spawnTime) / WARMUP_MS;
  if (!(t >= 0)) return { gain: 1, hue: 1 };   // a clock that ran backwards: full
  if (t >= 1) return { gain: 1, hue: 1 };
  return {
    // Slow off the mark then rushing: a cold filament draws hard and lights
    // late, and a linear ramp reads as a dimmer being turned rather than as
    // something switching on.
    gain: t * t * (3 - 2 * t),
    hue: Math.min(1, t * WARMUP_HUE_LEAD),
  };
}

/**
 * The countdown beat, as a multiplier on intensity, or 1 for a ball that has
 * nothing to announce.
 *
 * The beat COUNT is fixed and the countdown's length is not, so the rhythm is
 * the same shape on a fast compass and a slow one while the pace tracks the
 * actual interval - which is what makes it learnable rather than merely
 * animated. It also sharpens: early beats are round, the last is a spike, so
 * "soon" and "now" do not look alike.
 */
export function tell(ball: Ball, activeSeconds: number): number {
  const p = turnProgress(ball, activeSeconds);
  if (p === null) return 1;
  // Sharpen with progress: a cosine early, a narrowing spike at the end.
  const phase = (p * TELL_BEATS) % 1;
  const sharp = 1 + p * 5;
  const pulse = Math.pow(0.5 + 0.5 * Math.cos(phase * Math.PI * 2), sharp);
  // And it swings harder the closer the turn is, so the last beat is the one
  // you notice without having been watching for the first.
  return 1 - TELL_DEPTH * p * (1 - pulse);
}

/**
 * How much reach a locked ball's pool has left, as a fraction.
 *
 * Never quite zero while it is still drawn: a pool that reaches nothing is a
 * hole in the board, and ballLight.ts dims a locked ball rather than cutting
 * it precisely so the payoff moment does not have one.
 */
export function collapse(fade: number): number {
  const t = Math.max(0, Math.min(1, fade));
  return 1 - (1 - COLLAPSE_TO) * t;
}
