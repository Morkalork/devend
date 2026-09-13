/**
 * Bounce light: what a ball does to the surface it is about to touch.
 *
 * THE GAP THIS FILLS. The board has two lights and until now they never
 * acknowledged each other. The monitor lights the furniture; the balls light
 * the floor. So a fence's rim highlight points at the monitor whether or not a
 * blue ball is sitting a radius away from it, and the ball's own shading has no
 * idea the fence is there at all. Two lights in one room that ignore each other
 * is most of why the board reads as flat: it is not that there is too little
 * light, it is that nothing RESPONDS to it.
 *
 * WHY THIS IS CHEAP. The ball-light pass already walks every wall once per ball
 * per frame and measures `segmentDistance` to it, keeping the ones inside the
 * pool - that walk is the dominant cost of the whole lighting pass. A bounce
 * needs exactly the walls that survive it, ranked by exactly that distance, so
 * the expensive part is already paid. What is added is a closest-point, a
 * falloff and one sprite, for pairs that a tight proximity gate keeps in the
 * single digits: a ball crossing open board has none, one running a corridor
 * has one or two, one wedged in a corner has three.
 *
 * WHY IT IS NOT DRAWN IN THE LIGHT BUFFER. That was the first attempt and it
 * cannot work: the light buffer is composited UNDER everything that stands on
 * the floor, so light painted where a wall is gets painted over by the wall.
 * A reflection lives ON a surface, so it has to be drawn with that surface -
 * which is also why it needs no occlusion machinery of its own. The wall is
 * the occluder.
 *
 * Everything here is pure and in WORLD units; bounceLayer.ts draws it.
 */

import type { Ball } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";
import type { CanvasGameState } from "@/types/gameState";

/**
 * How far from a ball's SURFACE a wall still catches its light, in ball radii.
 *
 * Deliberately far short of the pool's 5.4. The pool is the light a ball throws
 * across the room; this is the light coming back off something it is nearly
 * touching, and it only reads as contact if it is rare. Wider, and every fence
 * in a corridor glows at once, which says nothing - the whole value of the
 * effect is that it fires when, and only when, a ball is about to arrive.
 */
export const BOUNCE_REACH_RADII = 2.2;

/**
 * Length of the lit band along the wall, in ball radii, at full strength.
 *
 * Long, and it has to be. The first version was 3.4, which put the whole band
 * inside the ball's own corona (CORONA_RADII 2.4, so a disc 43 world units
 * across at a standard ball) and made it invisible on screen while every
 * headless check passed: two soft glows in the same place are one soft glow.
 * The bounce only reads if it is a shape the corona cannot make, and the shape
 * a light source lying against a plane actually makes is a long streak - the
 * grazing incidence spreads it. At 10 the visible tail runs to about 63 units
 * either side, well clear of the corona, and what you see is light raking
 * along the fence rather than a dot painted on it.
 */
export const BOUNCE_LENGTH_RADII = 11;

/**
 * Peak alpha of the band, before the per-bounce falloff.
 *
 * Held below the point where the rim blows out to white on a fence, because a
 * saturated core throws away the one piece of information the bounce carries
 * that the wall's own rim does not: which ball is against it.
 */
export const BOUNCE_ALPHA = 0.7;

/** Peak alpha of the return light on the ball's own near side. */
export const BOUNCE_KISS_ALPHA = 0.34;

/** Radius of the return light, in ball radii. */
export const BOUNCE_KISS_RADII = 0.85;

/**
 * How far the bounce colour is pulled toward white.
 *
 * LESS than the pool's 0.35, which is the opposite of what the physics would
 * suggest and is the right answer anyway. The bounce is drawn ADDITIVELY on
 * top of a fence that already carries a bright accent line, so a whitened
 * bounce just makes that green line whiter - which reads as "the fence got
 * brighter", not as "the red ball is against it". Keeping the hue is what
 * makes it legible as the BALL's light rather than the fence's own.
 */
export const BOUNCE_WHITEN = 0.22;

export interface Bounce {
  /** The wall catching the light. */
  wall: Wall;
  /** The ball throwing it. */
  ball: Ball;
  /** Closest point on the wall's CENTRELINE, in world units. */
  x: number;
  y: number;
  /** Unit vector along the wall. */
  ax: number;
  ay: number;
  /** Unit vector from the wall toward the ball: the face that is lit. */
  nx: number;
  ny: number;
  /** 1 where the ball is touching, 0 at the reach. */
  strength: number;
  /** The ball's colour, whitened. */
  color: number;
}

/** The point on a segment nearest `p`, and how far away it is. */
export function closestOnSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { x: number; y: number; dist: number } {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-9) return { x: ax, y: ay, dist: Math.hypot(px - ax, py - ay) };
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + vx * t, y = ay + vy * t;
  return { x, y, dist: Math.hypot(px - x, py - y) };
}

function whiten(color: number, amount: number): number {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const lift = (c: number) => Math.round(c + (255 - c) * amount);
  return (lift(r) << 16) | (lift(g) << 8) | lift(b);
}

function parseColor(c: string): number {
  const n = Number.parseInt(c.replace("#", ""), 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

/**
 * Does this ball light surfaces at all?
 *
 * The same three answers ballLight gives, for the same reasons: a sleeper is
 * dark, a locked ball is draining, everything else emits. Kept in step with it
 * deliberately - a ball whose pool is off must not still be scorching the
 * fence next to it.
 */
function emits(ball: Ball): boolean {
  if (ball.state === "dormant") return false;
  if (ball.state === "won") return (ball.assimColorFade ?? 0) < 0.9;
  return true;
}

/**
 * Every wall close enough to a ball to catch its light, this frame.
 *
 * The gate is measured from the ball's SURFACE, not its centre, so a big ball
 * and a small one light a fence they are equally close to equally hard - which
 * is what "nearly touching" means and what the eye is actually reading.
 *
 * Portals are skipped: a ball goes THROUGH one, so a rim that lit up as the
 * ball arrived would be claiming a collision that is not going to happen.
 */
export function collectBounces(game: CanvasGameState, out: Bounce[] = []): Bounce[] {
  out.length = 0;
  for (const ball of game.balls) {
    if (!emits(ball)) continue;
    const p = ball.splatMass ?? ball.renderPosition ?? ball.position;
    const reach = ball.radius * (ball.assimScale ?? 1) * BOUNCE_REACH_RADII;
    const surface = ball.radius * (ball.assimScale ?? 1);
    const color = whiten(parseColor(ball.color), BOUNCE_WHITEN);

    for (const wall of game.walls) {
      if (wall.portal) continue;
      const c = closestOnSegment(
        p.x, p.y, wall.start.x, wall.start.y, wall.end.x, wall.end.y,
      );
      // From the wall's FACE, not its centreline: a thick board edge and a thin
      // fence must light up at the same visible gap.
      const gap = c.dist - surface - wall.thickness / 2;
      if (gap >= reach) continue;

      let nx = p.x - c.x, ny = p.y - c.y;
      const len = Math.hypot(nx, ny);
      // The ball's centre is on the wall's line: there is no lit face to pick.
      // It cannot happen to a ball that is merely touching (its centre is a
      // radius out), only to one the physics has let overlap the centreline.
      if (len < 1e-6) continue;
      nx /= len; ny /= len;

      let ax = wall.end.x - wall.start.x, ay = wall.end.y - wall.start.y;
      const alen = Math.hypot(ax, ay);
      if (alen < 1e-6) continue;
      ax /= alen; ay /= alen;

      // Squared, so the band arrives late and hard rather than fading up from
      // half a board away. Contact is the event worth drawing.
      const t = 1 - Math.max(0, gap) / reach;
      out.push({ wall, ball, x: c.x, y: c.y, ax, ay, nx, ny, strength: t * t, color });
    }
  }
  return out;
}
