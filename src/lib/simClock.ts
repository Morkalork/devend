/**
 * simClock — the clock the simulation runs on, as opposed to the wall clock.
 *
 * Every timestamp that lives on the game state (a fence's startTime, a ball's
 * frozenUntil, a lock flash, a boss phase, an ability's expiry) is stamped and
 * compared in SIM time. Sim time advances by exactly one PHYSICS_STEP per
 * physics step, so tick N is the same instant on every device that has run N
 * ticks, whatever frame rate got them there. That is the property two-player
 * lockstep needs (TWO_PLAYER_PLAN.md step 1) and it is also what lets a seeded
 * headless run reproduce a finding exactly.
 *
 * What stays on the WALL clock, deliberately:
 *
 *   - performance measurement (rendering/perfStats.ts): it measures real time,
 *     that is the whole point;
 *   - audio and music scheduling: the audio context has its own clock and the
 *     player hears real seconds;
 *   - purely presentational tweens driven by a rAF timestamp (the top bar's
 *     space counter, the level-complete score roll, the parallax background,
 *     the tutorial overlay): they compare against the `now` rAF handed them,
 *     never against anything on the game state.
 *
 * The rule that keeps the two from being confused: a timestamp that is stored
 * on `game` (or derived from one, like an ability timer's endMs) is sim time,
 * and everything that reads it - physics, input, the renderer, the HUD - calls
 * simNow(). A timestamp that never leaves its own module or comes from rAF is
 * wall time.
 *
 * Starting at 1000 rather than 0 keeps 0 usable as the "never happened"
 * sentinel that several fields rely on (game.shimmerStart, lastAutoFreezeAt).
 */

export const SIM_CLOCK_START_MS = 1000;

let nowMs = SIM_CLOCK_START_MS;

/** The current simulation time, in milliseconds. */
export function simNow(): number {
  return nowMs;
}

/** Advance the simulation clock. Negative deltas are ignored: sim time only
 *  ever moves forward, so a bad caller cannot make stamps in the future. */
export function advanceSimClock(deltaMs: number): void {
  if (deltaMs > 0) nowMs += deltaMs;
}

/**
 * Jump the clock to an absolute time. For the headless harness and tests, which
 * own the clock outright; the game itself only ever advances it.
 */
export function setSimNow(ms: number): void {
  nowMs = ms;
}

/** Back to the start, for a fresh harness run or a test that wants a clean slate. */
export function resetSimClock(): void {
  nowMs = SIM_CLOCK_START_MS;
}
