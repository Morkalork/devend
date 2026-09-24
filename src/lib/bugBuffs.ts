/**
 * "Is this ball still wearing a bug buff?" - asked from four places.
 *
 * A leaf module with no imports but the types, and that is the whole reason it
 * exists rather than living in physics/bugEffects.ts beside the code that sets
 * these timers. The readers are the damage model, the wall-collision path and
 * the lodestone, all of which sit UNDER the bug system in the import graph:
 * bugEffects reaches down into the lodestone's constants and into the ring's
 * lock pass, so anything it exported that those needed back would close a
 * cycle. Predicates are the part everyone needs, so the predicates move.
 *
 * Both buffs are wall-clock deadlines on the ball (simNow), so a paused game
 * does not burn one - the same clock `frozenUntil` uses.
 */
import type { Ball } from "@/types/game";
import { simNow } from "@/lib/simClock";

/**
 * Force Push in flight: triple damage, one-hit breaks, and it fractures the
 * player's own fences the way the black ball does.
 */
export function isWrecking(ball: Ball, now: number = simNow()): boolean {
  return ball.wreckingUntil !== undefined && now < ball.wreckingUntil;
}

/**
 * All Hands in flight: this ball pulls the others, borrowing the lodestone
 * ball type's steering for the duration.
 */
export function isAttracting(ball: Ball, now: number = simNow()): boolean {
  return ball.attractUntil !== undefined && now < ball.attractUntil;
}

/** Damage multiplier a ball's buffs apply to one impact. */
export const WRECKING_DAMAGE_MULTIPLIER = 3;
