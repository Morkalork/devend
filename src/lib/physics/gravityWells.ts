/**
 * Gravity wells (issue #77): local patches of the board that pull.
 *
 * The design argument, because it is the reason this is local rather than
 * global. Universal gravity makes every ball's path knowable, and this game's
 * tension is unpredictable motion in shrinking space, so a universal pull
 * trades the core loop for novelty. A well does the opposite: a ball flies
 * normally, bends while it is inside, and resumes ordinary motion on the way
 * out, so where it leaves depends on where and at what angle it entered. Two
 * balls crossing the same well a second apart come out on different vectors.
 *
 * A well is also a TOOL, not only a hazard. You can aim a ball into one to bend
 * it toward a pocket you have already fenced, which is the greed-hook from
 * LEVELDESIGN.md in a new form: go near the dangerous thing to put a ball where
 * you want it.
 *
 * The pull steers rather than accelerates, for the same reason gravity maps do
 * (see gravity.ts): this game rewrites velocity to absolute magnitudes every
 * frame, so anything that accumulated into speed would be erased. Steering also
 * means a ball can never come to rest, so "they must bounce" holds here too.
 *
 * And unlike a global pull, a well cannot produce the degenerate case where a
 * heading converges on the pull and the ball ping-pongs in a straight column:
 * it always leaves the well before converging. Locality fixes it for free.
 */
import type { Vector2 } from "@/types/game";
import type { GravityWell } from "@/types/level";
import { steerToward } from "@/lib/physics/gravity";

/** Wells pull DOWN the screen. Absolute, not map-relative: see GravityWell. */
export const WELL_PULL: Vector2 = { x: 0, y: 1 };

/** Fallback bend rate for a well that does not author one. */
export const DEFAULT_WELL_TURN_RATE = 2.6;

/** Is this point inside the well? Mirrors pointInArea for coloured areas. */
export function pointInWell(x: number, y: number, w: GravityWell): boolean {
  return x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height;
}

/** The first well containing the point, or null. */
export function wellAt(
  x: number, y: number, wells: readonly GravityWell[] | undefined,
): GravityWell | null {
  if (!wells || wells.length === 0) return null;
  for (const w of wells) if (pointInWell(x, y, w)) return w;
  return null;
}

/**
 * The velocity a ball at `position` should have after `dt` inside whatever well
 * it is in, or null when it is in none and nothing should change.
 *
 * Returning null rather than the unchanged vector lets the caller skip the
 * write entirely, which is the common case: most balls are outside every well
 * on most frames.
 */
export function wellStep(
  position: Vector2,
  velocity: Vector2,
  wells: readonly GravityWell[] | undefined,
  dt: number,
): Vector2 | null {
  const well = wellAt(position.x, position.y, wells);
  if (!well) return null;
  const rate = Number.isFinite(well.turnRate) && (well.turnRate as number) > 0
    ? (well.turnRate as number)
    : DEFAULT_WELL_TURN_RATE;
  return steerToward(velocity, WELL_PULL, rate, dt);
}

/**
 * Does this well pull into a wall it is sitting against?
 *
 * The authoring rule, made checkable. A well whose pull points at a nearby
 * surface pins a ball against it, bouncing in place: not stopped, since speed
 * is preserved, but stuck on one axis and trivially fenceable, which is worse
 * than either. `floor` is the board edge the pull points at.
 *
 * Stated generally on purpose. The obvious case is a down-pulling well resting
 * on the bottom of the board, but once maps start tilting any of the four
 * edges can become the one the pull is aimed at.
 */
export function pullsIntoWall(well: GravityWell, floorY: number, clearance = 60): boolean {
  return floorY - (well.y + well.height) < clearance;
}
