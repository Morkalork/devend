/**
 * Abilities that come back every map.
 *
 * Most abilities are consumables: a chest grants one charge, you spend it, it
 * is gone. A REPLENISHING ability is different in kind - once you have earned
 * it, the map always opens with at least one, so it stops being a hoarded
 * resource and becomes part of how you play. Shockwave is the one that wants
 * this: it is the "get the balls moving again" button, and a safety valve you
 * are afraid to press is not a safety valve.
 *
 * ── Why this is not the `panicShockwave` feature ─────────────────────────────
 *
 * That feature already topped Shockwave up each map, but it was armed by
 * BEATING THE LEVEL 10 BOSS, while the ability itself can be won from a chest
 * from level 4. So a player who found Shockwave at level 5 spent their one
 * charge, watched it not come back for five maps, and reasonably concluded the
 * thing did not replenish at all. The trigger is now HAVING the ability, which
 * is what the player can actually see; the feature unlock still grants it to
 * players who never found a chest, so nobody loses what they had.
 *
 * Pure and separate from the hook for the usual reason: "tops up to one, never
 * lowers a bigger stack, only for abilities you have actually earned" is three
 * rules that all look identical when they are wrong, and none of them are
 * visible in a running game until the map has already started.
 */
import type { AbilityDef } from "@/lib/abilities";

/**
 * Top up every replenishing ability the player has earned.
 *
 * `held` is what the player has EVER held this run (not the current stack): a
 * spent ability is still an earned one, and that is the whole point. `granted`
 * is anything owed by something other than having earned it, today the
 * `panicShockwave` feature unlock. `retained` is what was BOUGHT in the store's
 * ability slot, which makes an otherwise consumable ability replenish.
 *
 * Returns the same object reference when nothing changes, so a React effect
 * calling this on every render does not loop.
 */
export function replenishAbilityCharges(
  charges: Readonly<Record<string, number>>,
  held: readonly string[],
  catalogue: readonly AbilityDef[],
  granted: readonly string[] = [],
  retained: readonly string[] = [],
): Record<string, number> {
  const earned = new Set([...held, ...granted, ...retained]);
  // A retainer bought in the store makes an ORDINARY ability replenish, which
  // is the whole product: one charge at the start of every remaining map. It
  // reads as a floor of 1 rather than a copy of `replenishTo`, so an ability
  // that already replenishes to more keeps its own larger number.
  const bought = new Set(retained);
  let next: Record<string, number> | null = null;

  for (const ability of catalogue) {
    const floor = Math.max(ability.replenishTo ?? 0, bought.has(ability.id) ? 1 : 0);
    if (floor <= 0 || !earned.has(ability.id)) continue;
    // Never LOWER a stack: chest-earned charges pile on top of the free one,
    // and a player who banked three Shockwaves must not be trimmed back to one
    // every time a map begins.
    if ((charges[ability.id] ?? 0) >= floor) continue;
    next ??= { ...charges };
    next[ability.id] = floor;
  }

  return next ?? (charges as Record<string, number>);
}

/**
 * The ability ids a player has earned, from their current stack plus whatever
 * has already been recorded as held.
 *
 * A charge you are holding is proof you earned it, which lets a run saved
 * before this existed (no `heldAbilityIds` in the snapshot) still replenish
 * what the player is visibly carrying, rather than silently downgrading them
 * to a consumable Shockwave until they find another chest.
 */
export function heldAbilityIds(
  charges: Readonly<Record<string, number>>,
  recorded: readonly string[] = [],
): string[] {
  const ids = new Set(recorded);
  for (const [id, count] of Object.entries(charges)) if (count > 0) ids.add(id);
  return [...ids];
}
