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
 * BOTH ARE PLAIN EMITTERS, placed in world space, and that is the whole trick.
 * There is no clipping, no aperture wedge, no second pass. A virtual image
 * behind a mirror would need all of that (its own mirror would shadow it, and
 * the fix is a cone through the mirror's ends); a light sitting ON the mirror's
 * face needs none, because shadowQuad already declines to cast from a wall the
 * light is standing on, and every OTHER wall still occludes it correctly. For a
 * flat board seen from above, "the mirror is lit and throws it back" is also
 * the truer picture than a virtual image nobody has an eye position for.
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
export const MIRROR_RETURN = 0.55;

/** A returned pool is wider and flatter than the one that made it. */
export const MIRROR_SPREAD = 0.85;

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

  for (const wall of game.walls) {
    if (!wall.isMirror || wall.portal) continue;
    if (out.length >= MAX_DERIVED_PER_BALL) break;
    const c = closestOnSegment(p.x, p.y, wall.start.x, wall.start.y, wall.end.x, wall.end.y);
    const gain = MIRROR_RETURN * poolFalloff(c.dist, reach);
    if (gain <= 0.001) continue;
    // ON the mirror's centreline, not in front of it and not behind: exactly
    // there is where shadowQuad declines to cast from this wall, so the mirror
    // does not black out the room it is lighting.
    out.push({ kind: "mirror", x: c.x, y: c.y, gain, spread: MIRROR_SPREAD });
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
