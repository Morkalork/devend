/**
 * The Feature Flag: a ball that blinks off and on (LATE_GAME_PLAN.md, act VI).
 *
 * On for a few seconds, an ordinary ball; then off for a few, drawn faint, and
 * while it is off it passes through the player's GROWING fences without
 * breaking them. Finished walls stop it either way, and a fence that completes
 * with it still on the line is a strike as always (applyCut's completion
 * check), so the off window covers the growth, not the finish.
 *
 * It is the one ball the player cuts across on purpose, timed to its off
 * window, and the one they never start a fence beside just before it comes back.
 *
 * The cycle runs on active-play seconds, so pauses and freezes do not eat a
 * window, and each ball is phased by its id from the run seed so two flags on
 * one board never blink as one.
 */
import type { Ball } from "@/types/game";

export const DEFAULT_FLAG_ON_SECONDS = 4;
export const DEFAULT_FLAG_OFF_SECONDS = 3;

/** Arm a freshly made Feature Flag ball. `phase01` is a seeded draw in [0, 1). */
export function armFeatureFlag(ball: Ball, onSeconds: number | undefined, offSeconds: number | undefined, phase01: number): void {
  ball.flagOnSeconds = onSeconds ?? DEFAULT_FLAG_ON_SECONDS;
  ball.flagOffSeconds = offSeconds ?? DEFAULT_FLAG_OFF_SECONDS;
  ball.flagPhase = phase01 * (ball.flagOnSeconds + ball.flagOffSeconds);
  ball.flagOff = false;
}

/**
 * Is it off at this active-play second? Pure, for the tests and the renderers.
 * The cycle opens with the on stretch, so a ball with phase 0 is on at second 0.
 */
export function flagOffAt(ball: Ball, activeSeconds: number): boolean {
  if (ball.ability !== "featureFlag") {
    return false;
  }
  const on = ball.flagOnSeconds ?? DEFAULT_FLAG_ON_SECONDS;
  const off = ball.flagOffSeconds ?? DEFAULT_FLAG_OFF_SECONDS;
  const cycle = on + off;
  if (!(cycle > 0)) {
    return false;
  }
  const t = ((activeSeconds + (ball.flagPhase ?? 0)) % cycle + cycle) % cycle;
  return t >= on;
}

/** Seconds until it next switches, for a countdown or a test. */
export function flagSecondsToSwitch(ball: Ball, activeSeconds: number): number {
  const on = ball.flagOnSeconds ?? DEFAULT_FLAG_ON_SECONDS;
  const off = ball.flagOffSeconds ?? DEFAULT_FLAG_OFF_SECONDS;
  const cycle = on + off;
  const t = ((activeSeconds + (ball.flagPhase ?? 0)) % cycle + cycle) % cycle;
  return t < on ? on - t : cycle - t;
}

/** Every frame: write each flag's state onto the ball, where fences and renderers read it. */
export function tickFeatureFlags(balls: ReadonlyArray<Ball>, activeSeconds: number): void {
  for (const ball of balls) {
    if (ball.ability !== "featureFlag") {
      continue;
    }
    ball.flagOff = ball.state === "active" && flagOffAt(ball, activeSeconds);
  }
}
