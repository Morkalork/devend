/**
 * The compass ball's countdown ring, as geometry.
 *
 * Split out of the draw call for one specific reason. Pixi's `arc()` CONTINUES
 * the current path: it draws a straight line from wherever the path last was to
 * the arc's first point, exactly as the Canvas2D API it mirrors does. Every
 * other round thing in the ball layer uses `circle()`, which opens its own
 * subpath, so this was the only call that could do it - and it did, drawing a
 * beam across the whole board to the ball, in the ring's colour, turning red
 * with the ring in the last second before a turn.
 *
 * Returning `start` alongside the angles means the caller cannot forget to
 * `moveTo` it. That is the actual fix: the shape of the function makes the bug
 * hard to write again, where a comment saying "remember to moveTo" would not.
 */
import type { Ball } from "@/types/game";
import { turnProgress, turnDirection } from "@/lib/physics/turnTimer";

export interface CompassRing {
  radius: number;
  /** Where the arc begins, so the caller can open a fresh subpath there. */
  start: { x: number; y: number };
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

  // Pixi begins the arc at `lo` and sweeps forward to `hi`, so that is the
  // point a fresh subpath has to open on, and lo->hi is the whole sweep.
  return {
    radius,
    start: { x: cx + Math.cos(lo) * radius, y: cy + Math.sin(lo) * radius },
    from: lo,
    to: hi,
    urgent: progress > URGENT_FROM,
  };
}
