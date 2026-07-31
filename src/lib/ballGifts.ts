/**
 * Ball "gifts" (issue #64): the persistent mechanics each boss introduces, which
 * then appear on later maps at a small per-ball chance. Level-gated (no save
 * state) and seeded per map so Daily runs share the same rolls.
 *
 *  - Big balls  (boss 10 gift): from L11, 5% per ball spawns ~1.3x size.
 *  - Chained    (boss 20 gift): from L21, 5% of yellow/purple balls are chained
 *    to another ball on the map (any colour). The ordinary chain only tethers +
 *    snags; only the boss-pair chain breaks fences.
 *  - Black      (boss 30 gift): enabled via balls.yml unlockLevel (~25); breaks
 *    player fences in 3 hits (see updateBall.ts).
 */
import { BallAbility } from "@/lib/ballTypes";

export const BIG_BALL_MIN_LEVEL = 11;
export const BIG_BALL_CHANCE = 0.05;
export const BIG_BALL_RADIUS_SCALE = 1.3;
/** Extra lock multiplier an enlarged ball is worth (harder to trap = worth more). */
export const BIG_BALL_LOCK_BONUS = 1;

export const CHAINED_MIN_LEVEL = 21;
export const CHAINED_CHANCE = 0.05;

/** Only yellow (variableSpeed) and purple (slowOthers) can ANCHOR a gift chain. */
export function canAnchorChain(ability: BallAbility): boolean {
  return ability === "variableSpeed" || ability === "slowOthers";
}
