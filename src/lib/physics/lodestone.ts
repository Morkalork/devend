/**
 * The lodestone: a ball that continuously pulls the others toward itself.
 *
 * It is the Magnet ability's opposite number rather than a copy of it. The
 * ability is a one-shot you aim at a point you chose; this is always on, aimed
 * at a ball that is moving, and you cannot turn it off. What it changes is not
 * a moment but WHERE EVERYTHING TENDS TO BE, which is the read the whole game
 * is built on.
 *
 * Deliberately double-edged. The cluster it gathers is the opportunity and the
 * danger at once: the simultaneous-lock multiplier already pays 2x for two
 * balls in one cut and 3x for three, and until now that was reachable only by
 * luck. A lodestone makes it something you can set up. It also drags balls into
 * the pocket you were carefully keeping empty.
 *
 * ── Why it steers rather than accelerates ──────────────────────────────────
 *
 * Same reason gravity and the wells do, and the reason is worth repeating
 * because every heading effect in this game has had to learn it: updateBall
 * rewrites velocity to absolute magnitudes from three places every frame, so
 * anything that accumulated into SPEED would be erased within a frame. Bending
 * the heading survives untouched, and it also means a pulled ball can never
 * come to rest against the lodestone: it orbits and overshoots instead of
 * sticking, which is what keeps the cluster alive rather than congealed.
 */
import type { Ball } from "@/types/game";
import { steerToward } from "@/lib/physics/gravity";

/** Bend rate applied to a ball at the lodestone's centre, radians per second. */
export const DEFAULT_ATTRACT_TURN_RATE = 1.6;
/** Range in world units. Beyond this the lodestone is an ordinary ball. */
export const DEFAULT_ATTRACT_RADIUS = 320;

/** Is this ball currently able to pull others? */
export function isLodestone(ball: Ball): boolean {
  return ball.ability === "attract" && ball.state === "active";
}

/**
 * The pull one lodestone applies to one ball, as the velocity that ball should
 * have after `dt`, or null when nothing should change.
 *
 * Falls off with distance so the lodestone has a reach rather than a grip on
 * the whole board: a board-wide pull would collapse every map into one clump
 * and delete the topology the level was built around.
 */
export function attractStep(
  target: Ball, source: Ball, dt: number,
): { x: number; y: number } | null {
  if (target === source) return null;
  if (target.state !== "active") return null;

  const radius = source.attractRadius ?? DEFAULT_ATTRACT_RADIUS;
  const dx = source.position.x - target.position.x;
  const dy = source.position.y - target.position.y;
  const dist = Math.hypot(dx, dy);
  // Too far to feel it, or so close that the direction is numerically noise.
  if (dist > radius || dist < 1) return null;

  const rate = source.attractTurnRate ?? DEFAULT_ATTRACT_TURN_RATE;
  // Linear falloff to zero at the rim, so a ball drifting out of range eases
  // free instead of snapping straight the instant it crosses the line.
  const strength = rate * (1 - dist / radius);
  if (strength <= 0) return null;

  return steerToward(target.velocity, { x: dx, y: dy }, strength, dt);
}

/**
 * Apply every lodestone on the board to every other ball.
 *
 * Two lodestones pull each other, which is intended: they orbit, and the
 * cluster they make between them is the most dangerous piece of board on the
 * map. Nothing here compounds, because each step only rotates a heading.
 */
export function applyLodestones(balls: Ball[], dt: number, frozenBallId: string | null): void {
  let any = false;
  for (const b of balls) {
    if (isLodestone(b)) { any = true; break; }
  }
  if (!any) return;   // the common case: no allocation, no second pass

  for (const source of balls) {
    if (!isLodestone(source)) continue;
    for (const target of balls) {
      // A frozen ball is held on purpose and must not be dragged out of the
      // pocket it was frozen in, the same exemption gravity and wells make.
      if (frozenBallId && target.id === frozenBallId) continue;
      const pulled = attractStep(target, source, dt);
      if (pulled) { target.velocity.x = pulled.x; target.velocity.y = pulled.y; }
    }
  }
}
