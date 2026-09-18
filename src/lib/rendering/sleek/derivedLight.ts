/**
 * Second-hand light: what the board's two topological objects do with a pool.
 *
 * A MIRROR gives it back. Wall.isMirror has existed since map 13 and until now
 * the only way to know a wall was one was to watch a ball leave it at the wrong
 * angle. A mirror that returns the light standing in front of it says what it
 * is before anything touches it, which is the useful order.
 *
 * A PORTAL passes it. The pair is the one thing on the board that changes what
 * is NEXT TO what rather than what is in the way, and light arriving at the
 * far mouth before the ball does is the only cue that says so without a label.
 * It is also a real read: something is coming out of there, shortly.
 *
 * THE MIRROR'S LIGHT STANDS BEHIND THE MIRROR, at the ball's virtual image, and
 * that is the whole trick. The first version of this put it ON the mirror's
 * face, to dodge two real problems - a light behind a wall is shadowed by that
 * wall, and it would spill out the back - and in dodging them it gave up the
 * only thing that could have made it visible. A mirror only lights up when a
 * ball is within one pool of it, which is exactly when the ball's OWN pool is
 * already covering the mirror; a dimmer copy of the same coloured pool, sitting
 * inside the brighter original, is invisible on a screen. Reported as "I can't
 * see any effect at all".
 *
 * A reflection reads when it comes from somewhere the ball is not. So the image
 * goes where the optics say it is - as far behind the face as the ball is in
 * front, mirrored across it - and the two problems are paid for rather than
 * avoided:
 *
 *   ITS OWN MIRROR IS NOT AN OCCLUDER for it (ballLightPass skips the walls of
 *     the mirror that produced the light). Every other wall still occludes it
 *     exactly as it occludes a ball, which is what makes the second set of
 *     shadows land in a different direction from the first - the strongest cue
 *     the board has that these are lights and not painted glows.
 *   IT IS CUT OFF AT THE FACE. The half-plane behind the mirror is filled with
 *     shadow, so the pool only exists on the side the light came from. Without
 *     it the mirror would read as a window.
 *
 * Single bounce only: a derived light never derives another. Two mirrors facing
 * each other are a hall of mirrors, and the honest end of that recursion is a
 * frame budget, not a picture.
 */

import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import { portalExit } from "@/lib/physics/portal";
import { REACH_RADII } from "./ballLight";
import { closestOnSegment } from "./ballBounce";

/**
 * How much of the light landing on a mirror comes back.
 *
 * Well under 1. A mirror that returned everything would be a second ball, and
 * on a board where the balls ARE the lights that reads as an extra ball rather
 * than as a reflection - the thing the eye is tracking would have a twin.
 */
export const MIRROR_RETURN = 0.7;

/**
 * A returned pool is wider and flatter than the one that made it.
 *
 * Over 1, where the face-mounted version used 0.85, because half of this pool
 * is now masked off behind the mirror: what the player sees is the part that
 * clears the face, and at 0.85 a ball half a pool away threw a reflection that
 * barely reached the mirror's own edge.
 */
export const MIRROR_SPREAD = 1.3;

/** How much of a ball's light reaches the far mouth of a portal. */
export const PORTAL_THROUGH = 0.7;

/**
 * How close a ball must be to a portal's mouth, in ball radii past the mouth's
 * own radius, before anything shows at the other end.
 *
 * Long enough that the far mouth is already lit while the ball is still
 * closing, since a warning that arrives with the ball is not a warning; short
 * enough that a portal nobody is near stays dark rather than being a lamp.
 */
export const PORTAL_REACH_RADII = 5;

/**
 * Derived lights per ball, hard cap.
 *
 * A pathological map - a mirrored corridor, a ring of six portals - must cost a
 * bounded number of emitters, and past a handful nobody can read which light
 * came from where anyway.
 */
export const MAX_DERIVED_PER_BALL = 4;

export type DerivedKind = "mirror" | "portal";

export interface DerivedLight {
  kind: DerivedKind;
  /** World position of the light. */
  x: number;
  y: number;
  /** Multiplier on the parent ball's intensity. */
  gain: number;
  /** Multiplier on the parent ball's reach. */
  spread: number;
  /**
   * Mirrors only: the wall-id prefix every edge of the mirror shares.
   *
   * The light stands behind that mirror, so the mirror must not shadow it -
   * it would black out the very room it is lighting. Carried rather than
   * recomputed so the shadow pass makes the exemption for exactly the one
   * object that earned it, and every other wall on the board still occludes.
   */
  owner?: string;
  /**
   * Mirrors only: the reflecting face, in world units.
   *
   * The pool is clipped to the side of this line the light did NOT come from,
   * which is what keeps a reflection from also lighting the back of the mirror.
   */
  face?: { ax: number; ay: number; bx: number; by: number };
}

/** The wall-id prefix shared by every edge of one obstacle. */
export function mirrorOwner(wallId: string): string {
  const at = wallId.lastIndexOf("-edge-");
  return at > 0 ? wallId.slice(0, at) : wallId;
}

/** `p` mirrored across the infinite line through `a` and `b`. */
export function reflectAcross(
  p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
): { x: number; y: number } {
  const ux = b.x - a.x, uy = b.y - a.y;
  const len2 = ux * ux + uy * uy;
  if (len2 < 1e-9) return { x: p.x, y: p.y };
  const t = ((p.x - a.x) * ux + (p.y - a.y) * uy) / len2;
  const footX = a.x + ux * t, footY = a.y + uy * t;
  return { x: 2 * footX - p.x, y: 2 * footY - p.y };
}

/**
 * The pool's brightness at `dist`, as a fraction of its peak.
 *
 * An approximation of the baked falloff on purpose: this decides how much
 * light a mirror has to give back, and matching the bake stop for stop would
 * couple the two so that retuning the pool's edge silently retuned every
 * mirror on the board.
 */
function poolFalloff(dist: number, reach: number): number {
  if (dist >= reach) return 0;
  // LINEAR, where the bounce's falloff is squared, and the difference is the
  // difference between the two effects. The bounce says "contact", so it has
  // to arrive late and hard. These two say "something is about to happen
  // here", which is only worth saying EARLY - squared, a mirror two thirds of
  // a pool away gave back three percent, which is nothing, and the cue landed
  // at the same moment as the collision it was supposed to precede.
  return 1 - dist / reach;
}

export function derivedLights(
  ball: Ball, game: CanvasGameState, out: DerivedLight[] = [],
): DerivedLight[] {
  out.length = 0;
  const p = ball.splatMass ?? ball.renderPosition ?? ball.position;
  const radius = ball.radius * (ball.assimScale ?? 1);
  const reach = radius * REACH_RADII;

  // ONE reflection per mirror, not one per edge. A rect mirror is four walls,
  // and a ball in front of one face is in reach of three of them, so the old
  // loop spent three of the four derived slots lighting a single object from
  // three points a few units apart - and a map with two mirrors could only ever
  // show one of them.
  const nearest = new Map<string, { dist: number; wall: (typeof game.walls)[number] }>();
  for (const wall of game.walls) {
    if (!wall.isMirror || wall.portal) continue;
    const c = closestOnSegment(p.x, p.y, wall.start.x, wall.start.y, wall.end.x, wall.end.y);
    if (c.dist >= reach) continue;
    const owner = mirrorOwner(wall.id);
    const prev = nearest.get(owner);
    // The face the ball is actually looking at. Reflecting across one of the
    // short ends would put the image somewhere the ball can never see itself.
    if (!prev || c.dist < prev.dist) nearest.set(owner, { dist: c.dist, wall });
  }

  for (const [owner, { dist, wall }] of nearest) {
    if (out.length >= MAX_DERIVED_PER_BALL) break;
    const gain = MIRROR_RETURN * poolFalloff(dist, reach);
    if (gain <= 0.001) continue;
    const image = reflectAcross(p, wall.start, wall.end);
    out.push({
      kind: "mirror", x: image.x, y: image.y, gain, spread: MIRROR_SPREAD, owner,
      face: { ax: wall.start.x, ay: wall.start.y, bx: wall.end.x, by: wall.end.y },
    });
  }

  const portals = game.portals ? [...game.portals.values()] : [];
  for (const spec of portals) {
    if (out.length >= MAX_DERIVED_PER_BALL) break;
    const exit = portalExit(spec, portals);
    if (!exit) continue;  // a lone portal is inert; it does not glow either
    const d = Math.hypot(p.x - spec.centre.x, p.y - spec.centre.y);
    const near = spec.radius + radius * PORTAL_REACH_RADII;
    if (d >= near) continue;
    out.push({
      kind: "portal", x: exit.centre.x, y: exit.centre.y,
      gain: PORTAL_THROUGH * (1 - d / near), spread: 1,
    });
  }

  return out;
}
