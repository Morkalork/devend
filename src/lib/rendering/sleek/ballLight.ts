/**
 * Balls as light sources.
 *
 * The monitor in light.ts is the board's key light and it is deliberately dim:
 * it sits off-frame past the bottom-right and washes out toward the far corner.
 * That is the right shape for a key light and the wrong shape for the only one,
 * which is most of why testers kept calling the board dark - the lift in
 * boardBrightness.test.ts raised the floor, but a floor is still flat.
 *
 * So the balls carry their own light. This is not decoration: the ball is the
 * thing the player is tracking, and a pool of its own colour travelling with it
 * puts light exactly where the eye already is, moves that light around the board
 * for free, and tells you a red ball is coming before the ball itself clears the
 * obstacle. A static board and a busy board now look different, which is the
 * honest reading of the situation.
 *
 * TWO RULES, mirroring light.ts:
 *
 * 1. A BALL LIGHT IS NOT THE MONITOR. It does not flicker with the monitor's
 *    signal, and it is not blended into the monitor's scope. Two light sources
 *    that pulse together read as one badly-implemented source.
 * 2. IT IS OCCLUDED. A pool that shines straight through a wall is a glow effect
 *    wearing a light's costume, and it makes the board read as flatter rather
 *    than less flat, because it visibly ignores the geometry the player is
 *    building. `shadowQuad` is what stops that, and it is why anything using
 *    `ballLight` has to do the occlusion pass too.
 *
 * Everything here is screen-space and pure: the pass that draws it is in
 * ballLightPass.ts, and the numbers are pinned in ballLighting.test.ts.
 */

import type { Ball } from "@/types/game";
import type { Pt } from "./pixelGrid";

/**
 * Pool radius, in ball radii.
 *
 * Local on purpose. A ball is ~18 world units on a board ~800 across, so this
 * is a pool about an eighth of the board wide: big enough to light the corridor
 * a ball is running down, small enough that five of them do not merge into one
 * bright sheet - which would be the flat board again, only brighter.
 *
 * Widening this is the safe way to answer "too dark" and raising BASE_INTENSITY
 * is not: the falloff is a fraction of the reach, so a wider pool lights more
 * board at the same PEAK, and the peak is the number that compresses the
 * cut-versus-live read the whole game depends on.
 */
export const REACH_RADII = 5.4;

/** Peak pool alpha, before the per-ball dimming below. */
export const BASE_INTENSITY = 0.34;

/**
 * How far the pool colour is pulled toward white.
 *
 * A real source is whiter at its core than the object it comes from, and fully
 * saturated pools of five different hues on one board fight each other. Keeping
 * some hue is the point though - which ball is lighting this corner is useful
 * information - so this pulls, it does not wash out.
 */
export const WHITEN = 0.35;

export interface BallLight {
  /** Screen-space centre. */
  x: number;
  y: number;
  /** Pool radius in screen pixels. Nothing beyond this is lit or shadowed. */
  reach: number;
  /** Peak alpha of the pool, 0 to 1. */
  intensity: number;
  /** Emitter colour, already whitened. */
  color: number;
}

function whiten(color: number, amount: number): number {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const lift = (c: number) => Math.round(c + (255 - c) * amount);
  return (lift(r) << 16) | (lift(g) << 8) | lift(b);
}

/**
 * The light a ball emits, or null if it emits none.
 *
 * A DORMANT ball is dark. It is asleep, it casts no shadow (ballLayer skips
 * that too), and lighting the board with something that is not yet in play
 * would say the opposite of what the teal cage around it says.
 *
 * A WON ball is dimmed rather than cut: it is draining into the territory it
 * just created over about two seconds, and snapping its light off at the
 * instant of the lock would put a hole in the board at the exact moment the
 * player is being congratulated.
 *
 * `screen` is the ball's already-transformed centre and `radius` its already-
 * scaled screen radius, so this never has to know about the board transform.
 */
export function ballLight(ball: Ball, screen: Pt, radius: number, color: number): BallLight | null {
  if (ball.state === "dormant") return null;

  let intensity = BASE_INTENSITY;
  if (ball.state === "won") {
    // Fades with the same clock the body's colour drains on, so the light and
    // the ball go out together instead of on two schedules.
    intensity *= 0.55 * (1 - Math.min(1, ball.assimColorFade ?? 0) * 0.6);
  }
  // A boss is bigger, and a bigger emitter is a brighter one. This is the only
  // per-ball variation: everything else about the light comes from its radius,
  // so an upgrade that grows a ball grows its light without touching this file.
  if (ball.isBoss) intensity *= 1.25;

  if (intensity <= 0.001) return null;

  return {
    x: screen.x,
    y: screen.y,
    reach: radius * REACH_RADII,
    intensity,
    color: whiten(color, WHITEN),
  };
}

/**
 * The shadow a wall segment throws away from a ball light: the quad swept by
 * projecting both endpoints directly away from the light, out past the pool's
 * edge.
 *
 * Returns null when the segment is out of reach or the light sits on its line.
 */
export function shadowQuad(
  light: BallLight, ax: number, ay: number, bx: number, by: number,
): [Pt, Pt, Pt, Pt] | null {
  const adx = ax - light.x, ady = ay - light.y;
  const bdx = bx - light.x, bdy = by - light.y;
  const da = Math.hypot(adx, ady);
  const db = Math.hypot(bdx, bdy);

  // Out of reach: the nearest point of the segment is past the pool's edge, so
  // whatever it blocks is already dark.
  if (segmentDistance(light.x, light.y, ax, ay, bx, by) >= light.reach) return null;
  // Sitting on an endpoint: there is no direction to project.
  if (da < 1.5 || db < 1.5) return null;

  // Sitting on the segment's LINE. This is the guard that has to be here rather
  // than the endpoint check above, which a light in the MIDDLE of a long wall
  // sails straight past: the two rays are then exactly opposite, the quad
  // collapses to a line, and either side of it the shadow snaps through 180
  // degrees. The perpendicular distance is the thing that is actually zero.
  const cross = adx * bdy - ady * bdx;
  const segLen = Math.hypot(bx - ax, by - ay);
  if (segLen < 1e-6) return null;
  if (Math.abs(cross) / segLen < 1.0) return null;

  // How far out to throw the corners.
  //
  // The quad's far side is a straight CHORD between the two projected corners,
  // and a chord sits closer to the light than the rays it joins - by cos(half
  // the angle the wall subtends). Throwing both corners a fixed distance
  // therefore leaves a lit crescent behind any wall wide enough in the ball's
  // view, which is exactly the walls a ball is closest to and the ones the
  // shadow matters most for. Dividing it back out makes the chord clear the
  // pool's edge whatever the wall's width.
  //
  // The floor only exists to keep the divisor off zero, and it is set LOW on
  // purpose. A long fence the ball is running alongside subtends nearly 180
  // degrees, so its half-angle cosine is a few hundredths - a comfortable-
  // looking clamp cuts exactly that case short and leaves a lit band behind
  // the wall the ball is hugging. The resulting quad is large, which costs
  // nothing: it is four points, and the board mask clips it.
  const cosFull = (adx * bdx + ady * bdy) / (da * db);
  const cosHalf = Math.max(0.02, Math.sqrt(Math.max(0, (1 + cosFull) / 2)));
  const far = (light.reach * 1.25) / cosHalf;

  // Walk order (a, aFar, bFar, b), so it fills as a simple quadrilateral.
  // Endpoint order (a, b, aFar, bFar) gives a bow-tie that fills as two
  // triangles with a gap between them: the classic way this looks broken.
  return [
    { x: ax, y: ay },
    { x: light.x + (adx / da) * far, y: light.y + (ady / da) * far },
    { x: light.x + (bdx / db) * far, y: light.y + (bdy / db) * far },
    { x: bx, y: by },
  ];
}

/** Distance from a point to a segment. Exported: the light pass filters occluders with it. */
export function segmentDistance(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}
