/**
 * The compass ball: it turns ninety degrees on a timer, and wears the countdown.
 *
 * Every other ball ability is about speed, scoring, breaking, spawning or
 * tapping. None of them touches HEADING, which is what makes this a new axis
 * rather than a variation: it attacks the read the player is actually making,
 * which is where a ball is going to be.
 *
 * ── Why it is telegraphed, and why the turn is a right angle ───────────────
 *
 * LEVELDESIGN.md's third convention says a Turn has to be visible coming or it
 * is an ambush. A ball that changed heading unannounced would be noise: you
 * could not plan around it, only be robbed by it. The ring says WHEN.
 *
 * A right angle rather than a random heading is the other half of the same
 * argument. If the new direction were random the countdown would only tell you
 * when to stop trusting your read, which is a warning rather than a plan. With
 * a quarter turn in a direction the ring shows, you can put a fence where the
 * ball is going to be instead of where it is, and that is a decision worth
 * making rather than a hazard to survive.
 *
 * The direction of the NEXT turn is chosen when the previous one lands, not at
 * the moment it fires, precisely so the ring has something honest to show for
 * the whole cycle.
 */
import type { Ball } from "@/types/game";

/** Seconds between turns when the ball type does not author its own. */
export const DEFAULT_TURN_INTERVAL = 9;

/** A quarter turn, the only rotation this ability applies. */
const QUARTER = Math.PI / 2;

/**
 * How far through the current cycle this ball is, 0 (just turned) to 1 (about
 * to turn), or null when it does not turn at all.
 *
 * Used by the renderer for the ring, so it lives here beside the rule rather
 * than being re-derived: a ring that unwinds on a different clock from the turn
 * is worse than no ring, because it actively lies about when to act.
 */
export function turnProgress(ball: Ball, activeSeconds: number): number | null {
  if (ball.ability !== "turnTimer" || ball.nextTurnAt === undefined) return null;
  const interval = ball.turnIntervalSeconds ?? DEFAULT_TURN_INTERVAL;
  if (!(interval > 0)) return null;
  const remaining = ball.nextTurnAt - activeSeconds;
  return Math.max(0, Math.min(1, 1 - remaining / interval));
}

/** Which way the next turn goes: +1 clockwise, -1 counter-clockwise. */
export function turnDirection(ball: Ball): 1 | -1 {
  return ball.turnClockwise === false ? -1 : 1;
}

/**
 * Arm the ball's first turn. Called once, when the ball enters the map.
 *
 * Seeded off the ball's own id so a Daily plays the same turns for everyone,
 * and so two compass balls on one board do not turn in lockstep, which would
 * read as one event rather than two independent hazards.
 */
export function armTurnTimer(
  ball: Ball, activeSeconds: number, interval: number, rng: () => number,
): void {
  ball.turnIntervalSeconds = interval > 0 ? interval : DEFAULT_TURN_INTERVAL;
  ball.nextTurnAt = activeSeconds + ball.turnIntervalSeconds;
  ball.turnClockwise = rng() < 0.5;
}

/**
 * Turn the ball if its timer has come up. Returns true when it turned.
 *
 * Rotates the VELOCITY, magnitude untouched. Unlike the gravity steering this
 * sits beside, a quarter turn is exact rather than gradual, so it can be a
 * rotation rather than a nudge toward a target: there is no target, only a
 * heading ninety degrees off the current one.
 */
export function tickTurnTimer(
  ball: Ball, activeSeconds: number, rng: () => number,
): boolean {
  if (ball.ability !== "turnTimer" || ball.nextTurnAt === undefined) return false;
  if (activeSeconds < ball.nextTurnAt) return false;

  const dir = turnDirection(ball);
  const a = dir * QUARTER;
  const cos = Math.cos(a), sin = Math.sin(a);
  const { x, y } = ball.velocity;
  ball.velocity.x = x * cos - y * sin;
  ball.velocity.y = x * sin + y * cos;

  const interval = ball.turnIntervalSeconds ?? DEFAULT_TURN_INTERVAL;
  // Advance from the SCHEDULED time, not from now: anchoring on arrival would
  // let every frame of lag push the next turn later, so a stuttering device
  // would slowly drift a ball out of the rhythm the player had learned.
  ball.nextTurnAt += interval;
  // A long pause (a modal, a lock flash) can leave the schedule far behind.
  // Catch it up rather than firing a burst of turns to make up the difference.
  if (ball.nextTurnAt <= activeSeconds) ball.nextTurnAt = activeSeconds + interval;
  // Pick the next direction NOW, so the ring can show it for the whole cycle.
  ball.turnClockwise = rng() < 0.5;
  return true;
}
