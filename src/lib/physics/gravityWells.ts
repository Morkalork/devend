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
 * MAP_DESIGN_GUIDELINES.md in a new form: go near the dangerous thing to put a ball where
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
import type { GravityWell, WellPull } from "@/types/level";
import { steerToward } from "@/lib/physics/gravity";

/**
 * The four bearings, in SCREEN space. Absolute, not map-relative: see
 * GravityWell.pull for why that is the whole mechanic rather than a detail.
 */
export const PULL_VECTORS: Record<WellPull, Vector2> = {
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** A well that does not say which way it pulls pulls down, as they all used to. */
export const DEFAULT_PULL: WellPull = "down";

/** Retained name for the default bearing, which most wells still use. */
export const WELL_PULL: Vector2 = PULL_VECTORS[DEFAULT_PULL];

/** Fallback bend rate for a well that does not author one. */
export const DEFAULT_WELL_TURN_RATE = 2.6;

/** This well's bearing, defaulting to down. */
export function wellPull(well: GravityWell): WellPull {
  const p = well.pull;
  return p && p in PULL_VECTORS ? p : DEFAULT_PULL;
}

/** This well's pull as a unit vector in screen space. */
export function wellPullVector(well: GravityWell): Vector2 {
  return PULL_VECTORS[wellPull(well)];
}

/**
 * Is this well pulling yet?
 *
 * A well with no `activeFrom` is live from the first frame, which is every well
 * authored before dormancy existed. One with a threshold stays inert until the
 * board has been cleared down to it.
 *
 * `spaceRemainingPercent` is undefined before the first cut of a map resolves,
 * and is treated as a full board: nothing has been cleared, so a dormant well
 * has certainly not woken. Defaulting the other way would wake every dormant
 * well for the opening seconds of every map and then put it back to sleep.
 */
export function wellIsLive(
  well: GravityWell, spaceRemainingPercent: number | undefined,
): boolean {
  if (well.activeFrom == null) return true;
  const remaining = Number.isFinite(spaceRemainingPercent as number)
    ? (spaceRemainingPercent as number)
    : 100;
  return remaining <= well.activeFrom;
}

/** Is this point inside the well? Mirrors pointInArea for coloured areas. */
export function pointInWell(x: number, y: number, w: GravityWell): boolean {
  return x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height;
}

/**
 * The first well containing the point, or null.
 *
 * Dormancy-blind on purpose: the renderer and the map builder need to find a
 * well whether or not it has woken. Anything that cares about the well DOING
 * something wants liveWellAt.
 */
export function wellAt(
  x: number, y: number, wells: readonly GravityWell[] | undefined,
): GravityWell | null {
  if (!wells || wells.length === 0) return null;
  for (const w of wells) if (pointInWell(x, y, w)) return w;
  return null;
}

/** The first LIVE well containing the point, or null. */
export function liveWellAt(
  x: number, y: number,
  wells: readonly GravityWell[] | undefined,
  spaceRemainingPercent: number | undefined,
): GravityWell | null {
  if (!wells || wells.length === 0) return null;
  for (const w of wells) {
    if (pointInWell(x, y, w) && wellIsLive(w, spaceRemainingPercent)) return w;
  }
  return null;
}

/**
 * The velocity a ball at `position` should have after `dt` inside whatever live
 * well it is in, or null when it is in none and nothing should change.
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
  spaceRemainingPercent?: number,
  bendMultiplier = 1,
): Vector2 | null {
  const well = liveWellAt(position.x, position.y, wells, spaceRemainingPercent);
  if (!well) return null;
  const authored = Number.isFinite(well.turnRate) && (well.turnRate as number) > 0
    ? (well.turnRate as number)
    : DEFAULT_WELL_TURN_RATE;
  // Free Fall (Escape Velocity) can soften the bend. Guarded rather than
  // trusted: a zero or negative multiplier would make steerToward a no-op or
  // turn the pull inside out, and a well that silently pushes AWAY is far
  // worse than one that does nothing.
  const scale = Number.isFinite(bendMultiplier) && bendMultiplier > 0 ? bendMultiplier : 1;
  const rate = authored * scale;
  if (rate <= 0) return null;
  return steerToward(velocity, wellPullVector(well), rate, dt);
}

/**
 * Does this well pull into a board edge it is sitting against?
 *
 * The authoring rule, made checkable. A well whose pull points at a nearby
 * surface pins a ball against it, bouncing in place: not stopped, since speed
 * is preserved, but stuck on one axis and trivially fenceable, which is worse
 * than either.
 *
 * Which edge counts follows the well's own bearing, so an "up" well is checked
 * against the ceiling and a "right" well against the right wall. The board is
 * square, so one size describes all four.
 */
export function pullsIntoWall(
  well: GravityWell, boardSize: number, clearance = 60,
): boolean {
  switch (wellPull(well)) {
    case "up": return well.y < clearance;
    case "left": return well.x < clearance;
    case "right": return boardSize - (well.x + well.width) < clearance;
    default: return boardSize - (well.y + well.height) < clearance;
  }
}
