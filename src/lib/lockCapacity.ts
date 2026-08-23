/**
 * A map's lock capacity, and the quality premium measured against it.
 *
 * This is the bridge between what actually happened on the board and the
 * Delivery and Craft axes (see scoreAxes.ts). Both axes are scored as a
 * fraction of what THIS map could give, and the reason is the single biggest
 * flaw in the economy this replaced: a 1-ball map holds 12h of lock capacity
 * and a 4-ball act-III map holds 240h, yet every map paid into the same flat
 * 80h ceiling. Big maps threw most of a skilled run away and small ones could
 * not fill the pot at all.
 *
 * Reading it as a ratio makes the same quality of play worth the same on level
 * 3 and on level 29, so a map's roster changes how it PLAYS rather than what
 * it is worth, and the axis ceilings can be one set of numbers for all 35.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { LockAxisInput } from "@/lib/scoring";
import { getLockValue, getLockQuality } from "@/lib/scoring";

/**
 * What a clean sweep of this map is worth in raw lock hours: every ball's
 * lockMultiplier, with no quality multipliers applied.
 *
 * Counts the whole roster, won balls included, because balls stay in the array
 * once locked. A ball deliberately removed from play (Descope) is genuinely
 * gone from the denominator, which is right: you cannot be marked down for
 * failing to lock a ball that no longer exists.
 */
export function totalLockCapacity(game: Pick<CanvasGameState, "balls">, lockValue: number): number {
  let sum = 0;
  for (const b of game.balls) sum += b.lockMultiplier ?? 1;
  return sum * lockValue;
}

/**
 * Everything the Delivery and Craft axes need, read off the finished map.
 *
 * `lockDeliveryBonus` is accumulated at lock time rather than reconstructed
 * here, because the quality multipliers (superior, zone, simultaneous, money,
 * frozen, gravity) sit inside a product with the raw capacity and there is no
 * way to unpick the raw share from the total afterwards.
 */
export function readLockAxes(
  game: Pick<CanvasGameState, "balls" | "lockBonus" | "lockDeliveryBonus">,
): LockAxisInput {
  const lockValue = getLockValue();
  const { superiorMultiplier } = getLockQuality();
  const totalCapacity = totalLockCapacity(game, lockValue);
  const lockedCapacity = Math.max(0, game.lockDeliveryBonus ?? 0);
  return {
    totalCapacity,
    lockedCapacity,
    // Whatever the quality stack added on top of the raw hours.
    premiumEarned: Math.max(0, (game.lockBonus ?? 0) - lockedCapacity),
    // What the premium would be with every lock superior and nothing else
    // stacked. Zone and simultaneous plays push past this and clamp, so they
    // are alternative ROUTES to a full Craft axis rather than a bigger one:
    // a map with no colored area is not locked out of the axis.
    premiumAvailable: totalCapacity * Math.max(0, superiorMultiplier - 1),
  };
}
