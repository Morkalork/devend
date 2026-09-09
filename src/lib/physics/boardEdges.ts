/**
 * Live outer walls: the four board edges, each with a behaviour of its own.
 *
 * Asked for as "gravity everywhere, and bouncy outer walls so the balls bounce
 * back up". Gravity already exists (physics/gravity.ts) and it is a STEERING
 * force - the heading bends toward the pull, the magnitude is never touched -
 * so a ball can never come to rest and never needs topping up. Which means
 * "bouncier" cannot mean "returns more of what it took": nothing was taken. A
 * plain wall here already reflects perfectly, `v - 2(v.n)n`, magnitude exact.
 *
 * So the axis that carries the idea is DIRECTION, not elasticity.
 *
 *   bearing  fire the ball along a fixed heading, keeping its speed. The same
 *            trick the kicker uses on a bumper: a bouncer scatters, a kicker
 *            aims, and a wall that aims is a wall a player can learn.
 *   kick     multiply the speed. Small, and clamped, because under gravity the
 *            floor is struck every couple of seconds - a 1.25 trampoline pins
 *            every ball at the ceiling inside ten bounces and the map turns to
 *            noise.
 *
 * ── Why the ceiling matters more here than on a bumper ─────────────────────
 *
 * A bumper is a thing a ball meets when its path happens to cross one. A board
 * edge is a thing every ball meets constantly and cannot avoid, so the same
 * multiplier compounds far faster. The clamp is the bumper's own ceiling,
 * BOUNCER_MAX_SPEED_SCALE, reused deliberately: two objects that speed a ball
 * up should not disagree about how fast a ball is allowed to be.
 *
 * ── Why a pure `bearing` on the floor would be a bug, not a feature ────────
 *
 * `bearing: up` on the bottom edge reads like the obvious way to say "bouncy
 * floor" and produces a ball in a perfectly vertical orbit: up, arc over, down,
 * up, forever, in one column. It never travels sideways, so it never touches
 * the rest of the board - and a board the balls do not touch is captured
 * wholesale by captureUnreachableCells (see MAP_DESIGN_GUIDELINES.md section 9).
 * The floor wants a `kick`, which keeps the incoming sideways component; the
 * SIDES want bearings, to throw a ball that reaches them back across.
 */
import type { Ball } from "@/types/game";
import type { Vector2 } from "@/lib/polygon";
import { BEARING_VECTOR, type Bearing } from "@/lib/physics/obstacleRules";
import { BOUNCER_MAX_SPEED_SCALE } from "@/lib/physics/bouncer";

/** Which side of the board an edge is. Screen space, not board space. */
export type BoardSide = "top" | "right" | "bottom" | "left";

export interface BoardEdgeSpec {
  /** Fire the ball along this heading instead of letting it reflect. */
  bearing?: Bearing;
  /** Speed multiplier on contact. 1 (or absent) leaves the speed alone. */
  kick?: number;
}

export type BoardEdgeSpecs = Partial<Record<BoardSide, BoardEdgeSpec>>;

/** The sides, in the order a reader expects them. */
export const BOARD_SIDES: readonly BoardSide[] = ["top", "right", "bottom", "left"] as const;

/**
 * Which side of the board this impact was on.
 *
 * The board is an axis-aligned rectangle, so an edge is horizontal or vertical
 * and its position says which. Compared against the bounds with a tolerance
 * rather than for equality: the edge comes back off the polygon's own vertices,
 * which are floats, and an exact match would silently classify nothing.
 *
 * Returns null for anything that is not one of the four, so a board that stops
 * being a rectangle degrades to "no edge behaviour" instead of picking a side
 * at random.
 */
export function sideOfEdge(
  edge: { start: Vector2; end: Vector2 },
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  tolerance = 1,
): BoardSide | null {
  const horizontal = Math.abs(edge.start.y - edge.end.y) <= tolerance;
  const vertical = Math.abs(edge.start.x - edge.end.x) <= tolerance;
  if (horizontal === vertical) return null;   // diagonal, or degenerate

  if (horizontal) {
    const y = (edge.start.y + edge.end.y) / 2;
    if (Math.abs(y - bounds.minY) <= tolerance) return "top";
    if (Math.abs(y - bounds.maxY) <= tolerance) return "bottom";
    return null;
  }
  const x = (edge.start.x + edge.end.x) / 2;
  if (Math.abs(x - bounds.minX) <= tolerance) return "left";
  if (Math.abs(x - bounds.maxX) <= tolerance) return "right";
  return null;
}

/**
 * Apply an edge's behaviour to a ball that has just bounced off it.
 *
 * Called AFTER the ordinary reflection, so `ball.velocity` is already the
 * outgoing vector and this only redirects or rescales it. Mutates the ball, the
 * way every other collision responder here does.
 *
 * A zero-length velocity is left alone rather than given a direction: it can
 * only happen to a ball that is already being held (a Breakpoint fence), and
 * launching one out of a wall it is resting against would take the hold away.
 */
export function applyBoardEdge(ball: Ball, spec: BoardEdgeSpec | undefined): void {
  if (!spec) return;

  let vx = ball.velocity.x;
  let vy = ball.velocity.y;
  let speed = Math.hypot(vx, vy);
  if (speed <= 0) return;

  if (spec.bearing) {
    const [bx, by] = BEARING_VECTOR[spec.bearing];
    vx = bx * speed;
    vy = by * speed;
  }

  if (spec.kick && spec.kick !== 1) {
    // The ceiling is the bumper's, and it is a ceiling on the RESULT rather
    // than on the multiplier: a map may author 1.4 and simply stop getting it
    // once the ball is at the cap, which is what a physical trampoline does.
    const cap = (ball.baseSpeed || speed) * BOUNCER_MAX_SPEED_SCALE;
    const wanted = speed * spec.kick;
    const next = spec.kick > 1 ? Math.min(wanted, Math.max(speed, cap)) : wanted;
    const scale = next / speed;
    vx *= scale;
    vy *= scale;
    speed = next;
  }

  ball.velocity.x = vx;
  ball.velocity.y = vy;
}
