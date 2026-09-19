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

/**
 * How far a pool stretches along the heading at top speed, as a fraction.
 *
 * Small. This is a soft shape a couple of hundred pixels across, so a little
 * asymmetry reads clearly - and at anything more the pool stops looking like
 * light on a floor and starts looking like a comet, which claims a speed the
 * ball does not have.
 */
export const SPEED_STRETCH = 0.3;

/** The speed the stretch is measured against, in world units per second. */
export const SPEED_STRETCH_REF = 320;

/**
 * How much a pool is stretched along the heading, and squeezed across it.
 *
 * Volume-preserving, near enough: what is added to the long axis comes off the
 * short one, so a fast ball's pool covers about the same board as a slow one's
 * and speed reads as SHAPE.
 *
 * This used to say that speed must not touch brightness at all, on the grounds
 * that brightness already means how close a ball is. That is the right
 * instinct and the wrong conclusion, and speedGain below is where the line
 * actually falls: proximity is read from the GRADIENT inside one pool, which
 * spans better than ten to one from the core to the rim, so scaling a whole
 * pool by a fraction of that leaves the gradient intact. What would destroy
 * the read is a swing wide enough to make a dim near ball and a bright far one
 * look alike, which is why the gain below is bounded well inside it.
 */
export function speedStretch(speed: number, gain: number): { along: number; across: number } {
  if (!(speed > 0) || gain <= 0.001) return { along: 1, across: 1 };
  const k = SPEED_STRETCH * gain * Math.min(1, speed / SPEED_STRETCH_REF);
  return { along: 1 + k, across: 1 / (1 + k) };
}

/** The speed at which the energy lift is fully spent, world units per second. */
export const SPEED_GAIN_REF = 380;

/**
 * What a ball at a standstill keeps, and what one at the reference gains.
 *
 * A 1.6:1 swing end to end, against the better-than-10:1 span the falloff
 * gives across a single pool. Deliberately modest: the job is that a board
 * where everything is moving looks like a board where everything is moving,
 * not that speed becomes a second brightness channel.
 */
export const SPEED_GAIN_FLOOR = 0.82;
export const SPEED_GAIN_PEAK = 1.3;

/**
 * How hard a ball's own speed drives its output.
 *
 * Until this existed, the ONE thing about a ball that never reached its light
 * was how much was happening: a ball fresh off a slingshot, a boss at full
 * tilt and one nudging along a fence all emitted the same 0.55, and only the
 * pool's SHAPE moved. So a board at rest and a board in full flight were the
 * same brightness, which is the opposite of what a room does.
 *
 * Linear in speed rather than in v-squared, though energy is the thing being
 * described. Two curves cancel: energy goes as the square, and the eye's
 * response to light is nearer logarithmic, so a straight ramp on speed is
 * closer to how much energy a board READS as than either end of that.
 *
 * Exactly 1 at gain 0, so the dial off is the board as it was.
 */
export function speedGain(speed: number, gain: number): number {
  if (gain <= 0.001) return 1;
  const t = Math.min(1, Math.max(0, speed) / SPEED_GAIN_REF);
  const lift = SPEED_GAIN_FLOOR + (SPEED_GAIN_PEAK - SPEED_GAIN_FLOOR) * t;
  return 1 + (lift - 1) * gain;
}

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
