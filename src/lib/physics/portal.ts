/**
 * Portals: the first thing that changes the board's TOPOLOGY rather than its shape.
 *
 * Every other object rearranges where a ball can go by putting solid matter in
 * the way. A portal pair leaves the geometry alone and changes what is next to
 * what: a ball entering one leaves the other, so two parts of the board that
 * are nowhere near each other become adjacent.
 *
 * ── Solid to fences, open to balls ──────────────────────────────────────────
 *
 * A portal you bounce off would be a pillar, so balls pass through it. But it
 * is still built as an obstacle, so FENCES stop at it - which makes it a hole
 * you cannot simply cover over, and gives the object a cost as well as a use.
 *
 * ── The rule that had to be decided before this could be built ──────────────
 *
 * A region containing a live portal CANNOT be locked.
 *
 * This is not a flourish, it is the only honest answer. A lock is "this ball is
 * sealed in a pocket it cannot leave", and a pocket with a portal in it is a
 * pocket the ball can leave - it just does not look like one. Allowing the lock
 * would mean the game paying out for a seal that the very next second the ball
 * escapes from, and no screen would ever explain it.
 *
 * Made a rule rather than a bug, it is the most interesting thing about the
 * object: a portal turns one pocket into a place you must NOT use, so the map
 * acquires an order - deal with the portal, or seal somewhere else.
 */
import type { Ball } from "@/types/game";
import type { Polygon, Vector2 } from "@/lib/polygon";

export interface PortalSpec {
  id: string;
  /** Portals sharing a link are connected. Two make a pair; more make a ring. */
  link: string;
  centre: Vector2;
  /** Bounding radius, for the "is the ball in it" test and for drawing. */
  radius: number;
}

/**
 * How long a ball ignores portals after arriving through one, in ms.
 *
 * Without it a ball landing on the exit is instantly inside a portal again and
 * ping-pongs between the pair forever at 120Hz, which is not a hazard but a
 * hang. Long enough to clear the exit at any speed the game allows: at the
 * slowest ball, 200 units/second, 140ms carries it 28 units.
 */
export const PORTAL_COOLDOWN_MS = 140;

/** Whether this ball may enter a portal right now. */
export function portalReady(ball: Ball, now: number): boolean {
  return now - (ball.lastPortalAt ?? -Infinity) >= PORTAL_COOLDOWN_MS;
}

/**
 * The portal a ball entering `from` comes out of.
 *
 * Ordered by id so the pairing is stable across runs and rotations rather than
 * depending on which one the entity loop happened to see first. A link with
 * only one portal on it returns null: a lone portal is inert, and the map lint
 * says so rather than the game silently swallowing balls.
 */
export function portalExit(from: PortalSpec, all: readonly PortalSpec[]): PortalSpec | null {
  const ring = all.filter(p => p.link === from.link).sort((a, b) => a.id.localeCompare(b.id));
  if (ring.length < 2) return null;
  const i = ring.findIndex(p => p.id === from.id);
  return ring[(i + 1) % ring.length];
}

/**
 * Where a ball arrives, and how fast.
 *
 * It keeps its speed and its heading: a portal moves a ball, it does not aim
 * it. Placed one radius PAST the exit's centre along that heading, so it
 * emerges already leaving rather than sitting on top of the thing it just came
 * out of - which, with the cooldown, is what stops the pair from becoming a
 * loop.
 */
export function portalArrival(ball: Ball, exit: PortalSpec): Vector2 {
  const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
  const dx = speed > 1e-6 ? ball.velocity.x / speed : 1;
  const dy = speed > 1e-6 ? ball.velocity.y / speed : 0;
  const clear = exit.radius + (ball.radius ?? 0) + 2;
  return { x: exit.centre.x + dx * clear, y: exit.centre.y + dy * clear };
}

/** Is this world point inside the portal's mouth? */
export function inPortal(p: Vector2, spec: PortalSpec): boolean {
  return Math.hypot(p.x - spec.centre.x, p.y - spec.centre.y) <= spec.radius;
}

/** The portal (if any) whose mouth covers this point. */
export function portalAt(p: Vector2, portals: Map<Polygon, PortalSpec>): PortalSpec | null {
  for (const spec of portals.values()) if (inPortal(p, spec)) return spec;
  return null;
}
