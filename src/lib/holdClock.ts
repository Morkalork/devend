/**
 * How much sim time a HOLD frame is worth.
 *
 * ── The bug this exists to have a name for ──────────────────────────────────
 *
 * Reported three times from play, each time as "level 13 freezes", and the last
 * time precisely: "it freezes WHEN I FINISH IT". The screenshot showed a normal
 * board with a lock flash caught mid-pulse and no completion overlay - which is
 * exactly a held frame drawn over and over.
 *
 * The game loop has two kinds of frame. An ACTIVE one runs physics and advances
 * sim time one PHYSICS_STEP per step, which is what makes tick N the same
 * instant on every device. A HOLD frame - the dissolve, a finished level
 * playing out its locks, the deferred push prompt - runs no steps at all, and
 * its animations still have to play, so it advances sim time by its own elapsed
 * frame time instead.
 *
 * That second half was written as:
 *
 *     let lastFrameTs = 0;
 *     const holdElapsedMs = (timestamp) => {
 *       const ms = lastFrameTs === 0 ? 0 : min(timestamp - lastFrameTs, MAX);
 *       lastFrameTs = timestamp;          // cursor moves when a hold reads it
 *       return ms;
 *     };
 *
 *     const gameLoopBody = (timestamp) => {
 *       lastFrameTs = timestamp;          // ... and at the top of EVERY frame
 *
 * Both lines are individually reasonable and the second is even commented with
 * its reason: keep the cursor level with the frame on active frames too, or the
 * first hold after a spell of play sees the whole stretch as one elapsed frame.
 * Together they are fatal. Every call to holdElapsedMs happened AFTER the
 * top-of-frame assignment, in the same invocation, so `timestamp - lastFrameTs`
 * was always exactly 0. Hold frames advanced sim time by nothing, for ever.
 *
 * Nothing that runs on sim time could then finish:
 *
 *   - the shatter dissolve never progresses, so the callback that mounts the
 *     completion overlay is never reached - the map ends and no menu arrives;
 *   - the level-clear shimmer never expires, so the loop renders the same frame
 *     at 60fps indefinitely;
 *   - the deferred push prompt waits on a lock flash whose clock is stopped, so
 *     it never opens, and input is blocked the whole time.
 *
 * The loop is ALIVE through all of it - it renders and reschedules every frame -
 * which is why the dead-loop watchdog added for the previous report never fired,
 * and why the headless sweep could not see it either: the harness owns the sim
 * clock itself and replaces this loop wholesale, so the one piece of code with
 * the defect in it is the one piece the harness does not run.
 *
 * ── The shape that cannot do it again ───────────────────────────────────────
 *
 * The cursor is moved by ONE function, at a known point in the frame, and what
 * a hold reads is the value that move computed. A reader cannot advance the
 * cursor as a side effect of asking, because asking no longer touches it.
 */

/** A frame longer than this is a stall, not a frame: clamp rather than jump. */
export const MAX_HOLD_FRAME_MS = 50;

export interface HoldClock {
  /**
   * Open a frame. Call once, at the top of the loop body, on EVERY frame -
   * active and held alike, which is what keeps the first hold after a spell of
   * play down to one frame's worth instead of the whole stretch.
   */
  beginFrame(timestamp: number): void;
  /**
   * Sim milliseconds this frame is worth to a hold: the wall time since the
   * previous frame, clamped, and 0 on the very first frame of all. Pure - call
   * it as often as you like.
   */
  elapsed(): number;
}

export function createHoldClock(maxFrameMs: number = MAX_HOLD_FRAME_MS): HoldClock {
  let lastFrameTs = 0;
  let sinceLastFrame = 0;
  return {
    beginFrame(timestamp: number): void {
      sinceLastFrame = lastFrameTs === 0
        ? 0
        : Math.min(Math.max(0, timestamp - lastFrameTs), maxFrameMs);
      lastFrameTs = timestamp;
    },
    elapsed(): number {
      return sinceLastFrame;
    },
  };
}
