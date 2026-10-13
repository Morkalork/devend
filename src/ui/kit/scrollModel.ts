/**
 * The arithmetic behind the canvas ScrollView, kept out of the component so it
 * can be tested without a renderer.
 *
 * Everything here runs on elapsed milliseconds, never on frames. The library
 * scroller this replaces slowed a fling by 10% per FRAME, so a flick on a 120 Hz
 * phone stopped in half the time it took at 60 Hz, and a busy frame cut it
 * short. A position is the content's offset along the scroll axis: 0 at the
 * top (or left), down to `min` at the far end, so it is never positive in range.
 */

/** Finger travel before a press on a scroller turns into a scroll (the kit's press slop). */
export const SCROLL_SLOP_PX = 10;
/** Momentum kept per millisecond of a fling: UIScrollView's "normal" rate. */
export const DECELERATION_PER_MS = 0.998;
/** Below this speed (px/ms) a fling has stopped. */
export const STOP_SPEED = 0.01;
/** The fastest a fling may start (px/ms), so one wild sample cannot launch the page. */
export const MAX_FLING_SPEED = 8;
/** How far back the release velocity looks (ms). */
export const VELOCITY_WINDOW_MS = 100;
/** A finger that has been still this long before lifting lifts without a fling (ms). */
export const FLING_STALE_MS = 50;
/** Stiffness of the pull back from past an end (per ms); settles in about 400ms. */
export const BOUNCE_OMEGA = 0.012;
/** How hard the rubber band resists a drag past an end (iOS's constant). */
export const RUBBER_BAND = 0.55;
/** One frame's step is never longer than this, so a stall does not teleport the page. */
export const MAX_STEP_MS = 50;

export interface ScrollMotion {
  /** Offset along the axis, 0 at the start, `min` at the end. */
  position: number;
  /** Px per ms. */
  velocity: number;
}

export interface Sample {
  /** ms */
  t: number;
  position: number;
}

/** The furthest the content may travel: 0 when it fits, negative when it overflows. */
export function scrollMin(viewport: number, content: number): number {
  return Math.min(0, viewport - content);
}

/** The bound a position is past, or null when it is in range. */
export function boundPast(position: number, min: number): number | null {
  if (position > 0) {
    return 0;
  }
  if (position < min) {
    return min;
  }
  return null;
}

/** Hard clamp into range (the wheel, and content that shrank under a resting page). */
export function clampScroll(position: number, min: number): number {
  return Math.max(min, Math.min(0, position));
}

/**
 * Where a drag that would put the content at `raw` actually puts it: one for
 * one in range, and past an end a rubber band that gives less the further it
 * is pulled and never reaches `dimension`.
 */
export function rubberBand(raw: number, min: number, dimension: number): number {
  const bound = boundPast(raw, min);
  if (bound === null || dimension <= 0) {
    return bound === null ? raw : bound;
  }
  const over = Math.abs(raw - bound);
  const give = (1 - 1 / ((over * RUBBER_BAND) / dimension + 1)) * dimension;
  return bound + Math.sign(raw - bound) * give;
}

/**
 * The release velocity (px/ms) from the drag's recent samples: the travel over
 * the last VELOCITY_WINDOW_MS, and nothing when the finger had stopped before
 * it lifted, so a careful placement does not drift off.
 */
export function releaseVelocity(samples: readonly Sample[], now: number): number {
  if (samples.length < 2) {
    return 0;
  }
  const last = samples[samples.length - 1];
  if (now - last.t > FLING_STALE_MS) {
    return 0;
  }
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > VELOCITY_WINDOW_MS) {
      break;
    }
    first = samples[i];
  }
  const span = last.t - first.t;
  if (span <= 0) {
    return 0;
  }
  const v = (last.position - first.position) / span;
  return Math.max(-MAX_FLING_SPEED, Math.min(MAX_FLING_SPEED, v));
}

/** Keep only the samples releaseVelocity can still read. */
export function pruneSamples(samples: Sample[], now: number): Sample[] {
  const keepFrom = now - VELOCITY_WINDOW_MS * 2;
  let i = 0;
  while (i < samples.length - 2 && samples[i].t < keepFrom) {
    i++;
  }
  return i > 0 ? samples.slice(i) : samples;
}

/** True when the content is at rest in range: nothing left for a step to do. */
export function isSettled(motion: ScrollMotion, min: number): boolean {
  return motion.velocity === 0 && boundPast(motion.position, min) === null;
}

/**
 * Advance a released scroll by `dtMs`. In range a fling decays exponentially;
 * past an end a critically damped spring pulls it back (carrying whatever
 * speed it hit the end with, so a fling into an end overshoots and returns).
 * Both are solved exactly for the step, so the result does not depend on how
 * the time was cut into frames.
 */
export function stepScroll(motion: ScrollMotion, dtMs: number, min: number): ScrollMotion {
  const dt = Math.max(0, Math.min(MAX_STEP_MS, dtMs));
  if (dt === 0) {
    return motion;
  }
  const bound = boundPast(motion.position, min);
  if (bound === null) {
    if (motion.velocity === 0) {
      return motion;
    }
    const k = -Math.log(DECELERATION_PER_MS);
    const decay = Math.exp(-k * dt);
    const position = motion.position + (motion.velocity * (1 - decay)) / k;
    const velocity = motion.velocity * decay;
    if (Math.abs(velocity) < STOP_SPEED && boundPast(position, min) === null) {
      return { position, velocity: 0 };
    }
    return { position, velocity };
  }
  // Critically damped spring towards the bound: x(t) = (x0 + (v0 + w x0) t) e^(-w t).
  const w = BOUNCE_OMEGA;
  const x0 = motion.position - bound;
  const v0 = motion.velocity;
  const e = Math.exp(-w * dt);
  const x = (x0 + (v0 + w * x0) * dt) * e;
  const v = (v0 - w * (v0 + w * x0) * dt) * e;
  if (Math.abs(x) < 0.5 && Math.abs(v) < STOP_SPEED) {
    return { position: bound, velocity: 0 };
  }
  return { position: bound + x, velocity: v };
}
