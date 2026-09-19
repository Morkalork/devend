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
import { collapse } from "@/lib/rendering/ballTell";
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

/**
 * Peak pool alpha, before the per-ball dimming below.
 *
 * Raised from 0.34: the first pass was tuned as an accent, and the ask was for
 * the balls to LIGHT the board. The ceiling is not taste either - the pool is
 * additive, so it adds the same amount to cut and live space and compresses the
 * contrast between them, which is the read the whole game runs on. At 0.55 that
 * ratio is still 1.24 against a floor of 1.15 (see ballLighting.test.ts); much
 * past here and the board starts going flat where the balls are.
 */
export const BASE_INTENSITY = 0.55;

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
  /**
   * The emitter's own screen radius, for the penumbra in `shadowQuad`.
   *
   * Optional, and absent means a point source and therefore a hard shadow,
   * which is what everything here did before it existed. Only a BALL fills it
   * in: a lock flash has no body, a caustic is a focused core rather than a
   * disc, and a fence tip is a point by construction.
   */
  source?: number;
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
  let reach = radius * REACH_RADII;
  if (ball.state === "won") {
    // Fades with the same clock the body's colour drains on, so the light and
    // the ball go out together instead of on two schedules.
    const fade = Math.min(1, ball.assimColorFade ?? 0);
    intensity *= 0.55 * (1 - fade * 0.6);
    // And COLLAPSES rather than merely fading. A pool that dims where it
    // stands reads as the light going out; one that pulls in toward the ball
    // reads as the ball taking it into the pocket, which is what happened.
    reach *= collapse(fade);
  }
  // A boss is bigger, and a bigger emitter is a brighter one. This is the only
  // per-ball variation: everything else about the light comes from its radius,
  // so an upgrade that grows a ball grows its light without touching this file.
  if (ball.isBoss) intensity *= 1.25;

  if (intensity <= 0.001) return null;

  return {
    x: screen.x,
    y: screen.y,
    reach,
    intensity,
    color: whiten(color, WHITEN),
    // The ball's drawn radius, so a grown ball softens its shadows by as much
    // as it brightens them. `radius` is already screen-scaled by the caller.
    source: radius,
  };
}

/**
 * The shadow a wall segment throws away from a ball light: the quad swept by
 * projecting both endpoints directly away from the light, out past the pool's
 * edge.
 *
 * `spread` is the emitter's radius, and it is what turns this from a point
 * light's shadow into an AREA light's. A ball is about eighteen world units
 * across, which is a fifth of its own pool, so treating it as a point was the
 * single most obviously wrong thing left in the shadow: every edge was equally
 * razor-sharp whether the wall casting it was touching the ball or most of a
 * pool away. Passing a spread pushes the far corners apart by the angle the
 * source subtends at each endpoint, and calling this twice - once at zero, once
 * at the radius - gives two quads that bracket the penumbra.
 *
 * TWO THINGS COME OUT OF THAT, and both are cues nothing else on the board
 * carries:
 *
 *   ALONG the shadow, the fringe is nothing at the wall and widens the further
 *     out you go. That is the contact-shadow read: a shadow is sharp where the
 *     object meets the floor and softens away from it, which is why the NEAR
 *     corners stay exactly on the wall here. Rounding those off is the classic
 *     way soft shadows start looking like fog.
 *   BETWEEN shadows, a wall the ball is CLOSE to flares faster than one it is
 *     far from, because the source subtends spread/distance at each endpoint
 *     and that angle is what opens the quad. This is the part that reads
 *     backwards until you look at a real lamp: a light almost touching an
 *     object throws an enormous soft shadow, and the same object held at arm's
 *     length throws a tight one. So the softness says how far the LIGHT is
 *     from the occluder, and the gradient along it says how far the occluder
 *     is from the floor it is falling on.
 *
 * Defaults to 0, so every existing caller gets exactly the shadow it had.
 *
 * Returns null when the segment is out of reach or the light sits on its line.
 */
export function shadowQuad(
  light: BallLight, ax: number, ay: number, bx: number, by: number, spread = 0,
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

  let faX = light.x + (adx / da) * far, faY = light.y + (ady / da) * far;
  let fbX = light.x + (bdx / db) * far, fbY = light.y + (bdy / db) * far;

  if (spread > 0.01) {
    // Outward is along the line joining the two far corners: away from B for
    // A's corner and away from A for B's. Taking the axis from the CORNERS
    // rather than from the wall keeps it right when the wall is nearly
    // end-on to the light, where the wall's own direction points almost at
    // the light and would push the corners forward instead of apart.
    const ox = faX - fbX, oy = faY - fbY;
    const ol = Math.hypot(ox, oy);
    if (ol > 1e-6) {
      // Small-angle penumbra half-width: the source subtends about
      // spread/distance at each endpoint, and the shadow has `far` to spread
      // over. Divided by the endpoint's OWN distance, so the wall the ball is
      // hugging - where that distance is smallest - is the one whose shadow
      // opens out fastest past it, which is what a wide source does.
      const ux = ox / ol, uy = oy / ol;
      const sa = (far * spread) / da;
      const sb = (far * spread) / db;
      faX += ux * sa; faY += uy * sa;
      fbX -= ux * sb; fbY -= uy * sb;
    }
  }

  // Walk order (a, aFar, bFar, b), so it fills as a simple quadrilateral.
  // Endpoint order (a, b, aFar, bFar) gives a bow-tie that fills as two
  // triangles with a gap between them: the classic way this looks broken.
  return [
    { x: ax, y: ay },
    { x: faX, y: faY },
    { x: fbX, y: fbY },
    { x: bx, y: by },
  ];
}

/**
 * How dark the penumbra fringe is against the umbra it surrounds.
 *
 * The fringe is drawn first and the umbra over it, so the umbra ends up at
 * full black either way and this is only the half-shadow outside it. Under
 * half, because a penumbra is by definition light that is partly getting
 * through - and because the pass draws the board at half resolution, so the
 * bilinear upscale is already softening the fringe's own outer edge for free.
 */
export const PENUMBRA_ALPHA = 0.4;

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
