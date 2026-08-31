/**
 * Obstacles that do not stop every ball.
 *
 * Until now a wall was a wall: solid to everything, always. Two map mechanics
 * change that, and they share this module because they are the same question
 * asked twice - "may THIS ball, moving THIS way, pass through THIS obstacle".
 *
 *   ONE-WAY  A membrane balls cross in one direction and bounce off in the
 *            other. It is the herding verb the game did not have: every other
 *            mechanic changes where a ball goes, none let you put one
 *            somewhere and know it will stay. Drive a ball through, seal
 *            behind it.
 *
 *   GATE     Passable only by named ball types. Eleven ball types exist and
 *            carry their own shape marks, and until now no wall in the game
 *            could tell them apart - identity was a legend, not a decision.
 *
 * Both are read at collision time by updateBall, which walks a flat
 * Polygon[]. The rules therefore live in a Map keyed by polygon identity
 * rather than in a parallel array: the phasing system already does exactly
 * this (`phasedOut.polys.has(obstacle)`), and an index-parallel array is one
 * careless insert away from applying the wrong rule to the wrong wall.
 */
import type { Ball } from "@/types/game";
import type { Polygon, Vector2 } from "@/lib/polygon";

/** The four bearings a one-way membrane can face. Same vocabulary as a well's pull. */
export type Bearing = "up" | "down" | "left" | "right";

export const BEARING_VECTOR: Record<Bearing, readonly [number, number]> = {
  down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0],
};

export interface ObstacleRule {
  /**
   * Balls travelling roughly this way pass through; the other way they bounce.
   * "right" means a ball moving in +x crosses it.
   */
  oneWay?: Bearing;
  /**
   * Ball type ids that may pass. Everything else bounces. An empty array is
   * treated as absent rather than as "nothing may pass", so a half-finished
   * edit in the admin leaves a normal solid wall rather than a wall that is
   * silently already correct.
   */
  passTypes?: string[];
}

/** A rule that does nothing is not worth storing; keeps map.yml and the Map clean. */
export function isEmptyRule(rule: ObstacleRule | undefined | null): boolean {
  if (!rule) return true;
  return !rule.oneWay && !rule.passTypes?.length;
}

/**
 * May this ball pass through this obstacle right now?
 *
 * The two conditions are OR, not AND, and that is a design decision worth
 * stating: a gate that names the black ball lets the black ball through from
 * either side, and a membrane facing right lets ANY ball through going right.
 * Combining them with AND would make "one-way gate for black balls only",
 * which is a third mechanic nobody asked for and which reads as broken from
 * the outside - a player watching a blue ball bounce off a gate it just came
 * through has no way to work out why.
 */
export function ballMayPass(
  rule: ObstacleRule | undefined | null, ball: Ball, velocity: Vector2,
): boolean {
  if (!rule) return false;

  if (rule.passTypes?.length && rule.passTypes.includes(ball.typeId)) return true;

  if (rule.oneWay) {
    const [bx, by] = BEARING_VECTOR[rule.oneWay];
    // Strictly greater than zero: a ball running exactly along the membrane
    // has no side to be on, and letting it "pass" is how a ball ends up
    // resolving inside a solid.
    return velocity.x * bx + velocity.y * by > 0;
  }

  return false;
}

/** The rules for a board, keyed by the polygon each belongs to. */
export type ObstacleRuleMap = Map<Polygon, ObstacleRule>;
