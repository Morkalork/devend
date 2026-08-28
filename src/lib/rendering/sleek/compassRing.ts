/**
 * The compass ball's countdown ring, as geometry.
 *
 * Split out of the draw call because of the beam, and it now hands back the
 * ring already FLATTENED into points, so the ball layer never calls Pixi's
 * `arc()` at all. That is the fix, and it is the third one: the two before it
 * were both real and neither stopped the beam being reported.
 *
 * ── Why arc() had to go, not just be guarded ─────────────────────────────────
 *
 * `arc()` continues the current path, so it draws a line from wherever the path
 * last was to the arc's first point. Opening a subpath with `moveTo(start)`
 * fixes that call, and it does: driving the real layer and deleting the moveTo
 * puts a segment from the canvas origin to `start` straight back.
 *
 * But `arc()` also CORRUPTS the path state it leaves behind, and no moveTo can
 * help with that. Pixi's `GraphicsPath.getLastPoint()` handles `case "arc"` by
 * reading `data[5], data[6]` - the layout of `arcToSvg`, whose data really does
 * end in the x,y it finished at. A plain `arc(x, y, radius, start, end)` has no
 * such pair: `data[5]` is the optional `counterclockwise` FLAG and `data[6]`
 * does not exist. Measured on pixi.js 8.19.0, getLastPoint returns
 * `(undefined, undefined)` after a five-argument arc and `(false, undefined)`
 * after a six-argument one.
 *
 * Every `fill()` and `stroke()` then calls `_initNextPathLocation()`, which
 * clears the active path and re-seeds it with `moveTo(thatGarbage)`. So every
 * mark drawn after a stroked arc, on a Graphics SHARED by every ball and every
 * overlay, starts from a corrupt point. Usually the seed is harmless (a
 * two-point subpath is dropped when the next `moveTo` lands), which is exactly
 * why it survives a headless sweep and why reading the call site says it is
 * fine.
 *
 * A polyline has none of this. `moveTo` + `lineTo` is a shape Pixi's own
 * `getLastPoint` gets right, so the ring cannot leave a booby-trapped path
 * behind it for the next ball to inherit.
 */
import type { Ball } from "@/types/game";
import { turnProgress, turnDirection } from "@/lib/physics/turnTimer";

export interface CompassRing {
  radius: number;
  /** Where the ring begins: `points` opens here, and nothing else may. */
  start: { x: number; y: number };
  /**
   * The ring already flattened to a polyline, as flat x,y pairs starting at
   * `start`. The caller strokes these directly rather than handing the angles
   * to `arc()`, which is what keeps `arc()` out of the renderer entirely.
   *
   * Stepped the way Pixi's own `buildArc` steps, so the ring on screen is the
   * same ring it has always been rather than a visibly coarser or smoother one.
   */
  points: number[];
  /**
   * Arc bounds, ordered low to high, to be swept in that order.
   *
   * There is deliberately no `anticlockwise` flag. Which way the ball will turn
   * is already carried by WHICH bounds these are: a clockwise turn puts the
   * wedge after twelve o'clock, a counter-clockwise one before it. Handing the
   * caller a direction flag as well means the same fact is stated twice, and
   * the two statements can disagree - which is exactly what happened. Setting
   * it from the turn direction made Pixi sweep the LONG way round the circle
   * for every counter-clockwise ball, so half of all compass balls wore a ring
   * that was nearly full when the turn was about to fire and nearly empty just
   * after it landed. Precisely inverted, on a countdown whose whole job is to
   * be trusted.
   */
  from: number;
  to: number;
  /** The last moments before the turn, when the ring should catch the eye. */
  urgent: boolean;
}

/** How red the ring goes in its final stretch. */
export const URGENT_FROM = 0.8;

/**
 * The ring for this ball, or null when it does not turn or has nothing left to
 * unwind.
 *
 * Driven from turnProgress, the same function the turn itself uses, so the ring
 * cannot unwind on a different clock from the event it promises.
 */
export function compassRing(
  ball: Ball, cx: number, cy: number, ballRadius: number, scale: number,
  activeSeconds: number,
): CompassRing | null {
  const progress = turnProgress(ball, activeSeconds);
  if (progress === null) return null;

  const radius = ballRadius + Math.max(2, 3 * scale);
  const sweep = (1 - progress) * Math.PI * 2;   // unwinds as the turn nears
  if (sweep <= 0.01) return null;

  // Wound in the direction of the coming turn, so the ring says WHICH WAY as
  // well as when: that is what makes the countdown a plan rather than a
  // warning, and it is the whole reason the direction is chosen a cycle early.
  const cw = turnDirection(ball) > 0;
  const from = -Math.PI / 2;
  const to = cw ? from + sweep : from - sweep;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);

  // Walk lo->hi, which is the whole sweep. The first point IS `start`, so the
  // caller has one thing to open on and no second statement of it to disagree.
  //
  // The step count mirrors Pixi's buildArc (6 * cbrt(radius) * dist/PI, floored
  // at a dozen) so the flattening is the same flattening that has been on
  // screen all along: this change is about which path calls are made, and must
  // not also quietly restyle the ring.
  const span = hi - lo;
  const steps = Math.max(12, Math.ceil(6 * Math.cbrt(radius) * (span / Math.PI)));
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = lo + (span * i) / steps;
    points.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
  }

  return {
    radius,
    start: { x: points[0], y: points[1] },
    points,
    from: lo,
    to: hi,
    urgent: progress > URGENT_FROM,
  };
}
