/**
 * Motion blur for a ball, as geometry.
 *
 * A ball is a lit sphere about 18 world units across moving at 250 a second. At
 * 60fps that is four units a frame, and the eye is given nothing to join them
 * with: a fast ball reads as a dot being teleported rather than as something
 * travelling. Its DIRECTION is the single most useful fact on the board - the
 * whole game is deciding where a ball will be - and a still frame of it carries
 * none.
 *
 * So: a short smear behind the ball, and a literal one. The length is how far
 * the ball actually travels in `SHUTTER_SECONDS`, which is what a camera's
 * shutter would have caught. That makes it a measurement rather than a taste,
 * so a faster ball is longer for a reason and the fastest ball on the board is
 * visibly the fastest.
 *
 * Split from the drawing the way compassRing and gravityCue are: the arithmetic
 * is the part that can be wrong, and it can be wrong quietly.
 */
import type { Ball } from "@/types/game";

/** A camera shutter, in seconds. The trail is the distance travelled in this. */
export const SHUTTER_SECONDS = 0.05;

/**
 * Below this fraction of a ball's own radius the smear is shorter than the
 * antialiasing on the ball's edge, so it reads as a smudge rather than motion.
 * A slow ball is legible without help and gets none.
 */
export const MIN_TRAIL_FRACTION = 0.3;

/** Longest a trail may run, as a multiple of the ball's radius. */
export const MAX_TRAIL_RADII = 3;

export interface BallTrail {
  /** Screen-space tail, behind the ball. */
  from: { x: number; y: number };
  /** Screen-space head: the ball's own centre. */
  to: { x: number; y: number };
  /** Stroke width in screen pixels. */
  width: number;
  /** Fades in with speed, so the trail arriving is itself a speed cue. */
  alpha: number;
}

/**
 * The smear behind this ball, or null when it should not have one.
 *
 * `centre` and `radius` are already in screen space (the caller has the
 * transform); `scale` converts a world length to a screen one.
 */
export function ballTrail(
  ball: Ball,
  centre: { x: number; y: number },
  radius: number,
  scale: number,
  now: number,
): BallTrail | null {
  // A ball that is not in play is not moving, whatever its velocity says.
  if (ball.state !== "active") return null;
  // Held by a tap-freeze: it has a velocity it is not currently using, and a
  // trail on a stopped ball is a lie about the thing the player just paid to
  // stop.
  if (ball.frozenUntil !== undefined && now < ball.frozenUntil) return null;

  const vx = ball.velocity?.x ?? 0, vy = ball.velocity?.y ?? 0;
  const speed = Math.hypot(vx, vy);
  if (!(speed > 1e-6) || !Number.isFinite(speed)) return null;

  const lengthPx = speed * SHUTTER_SECONDS * scale;
  const min = radius * MIN_TRAIL_FRACTION;
  if (lengthPx < min) return null;

  const capped = Math.min(lengthPx, radius * MAX_TRAIL_RADII);
  const ux = vx / speed, uy = vy / speed;

  // Fade in over the first stretch above the floor rather than appearing at
  // full strength, or the trail pops into existence as a ball speeds up.
  const over = (capped - min) / Math.max(1e-6, radius * MAX_TRAIL_RADII - min);
  return {
    from: { x: centre.x - ux * capped, y: centre.y - uy * capped },
    to: { x: centre.x, y: centre.y },
    // Narrower than the ball so the smear sits inside its silhouette and reads
    // as the ball's own blur rather than as a separate ribbon trailing it.
    width: Math.max(1, radius * 0.85),
    alpha: 0.16 + 0.22 * Math.min(1, over),
  };
}
