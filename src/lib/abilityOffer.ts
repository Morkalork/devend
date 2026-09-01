/**
 * The store's ability slot: one ability, always on the shelf, beside the
 * upgrades rather than instead of one of them.
 *
 * ── What is being sold ──────────────────────────────────────────────────────
 *
 * Not a charge. A charge is a consumable and the store's whole grammar is
 * "spend hours once, own it forever": priced like an upgrade a single charge is
 * terrible value, and priced to sell it quietly deletes the reason to smash a
 * chest. What the slot sells is a RETAINER - the ability, plus a charge of it
 * at the start of every remaining map. That is a different object from what a
 * chest gives (a stack you hoard for a hard map), so neither makes the other
 * pointless, and it is the permanent form the codebase already had a name for:
 * `replenishTo` in abilities.yml, which until now only Shockwave carried.
 *
 * ── Why the slot closes rather than degrading ───────────────────────────────
 *
 * A player at the ability cap has nothing to buy here, and the slot is CLOSED
 * for them - the same word, and the same read, as the store's own closed
 * banner. The alternative was to keep the slot open and sell charges of what
 * they already hold, which is what a chest does at the cap
 * (rollCappedAbilityReward). It is the right answer there, where refusing means
 * a chest the player worked for pays nothing. It is the wrong answer here: a
 * shelf that silently changes what it sells is a shelf you stop reading, and
 * "your bar is full" is a fact worth showing rather than papering over.
 *
 * ── Why the price does not inflate ──────────────────────────────────────────
 *
 * Every other price in the shop multiplies by 1.35 per five-level block, which
 * is right for a permanent effect: it costs more later because you are richer.
 * A retainer is the opposite shape. Its value is one charge per map REMAINING,
 * so it is worth most on map 2 and least on map 34 - and the ordinary curve
 * would charge six times as much for a twentieth of the value. So the price is
 * derived from maps remaining and skips inflation entirely; see priceFor in
 * UpgradeShop, where that exemption lives.
 */
import { getEligibleAbilities, MAX_ABILITY_SLOTS, type AbilityDef } from "@/lib/abilities";
import type { UpgradeConfig, UpgradeTier } from "@/types/upgrade";

/** Ability offers are synthetic upgrade cards; this marks their ids. */
export const ABILITY_OFFER_PREFIX = "ability:";

/** Overtime hours a retainer costs per map it will still pay out on. */
export const ABILITY_HOURS_PER_MAP = 4;

/** Floor, so a retainer bought on the last map is still a real transaction. */
export const ABILITY_MIN_COST = 8;

export function abilityOfferId(abilityId: string): string {
  return `${ABILITY_OFFER_PREFIX}${abilityId}`;
}

/** The ability an offer card grants, or null for an ordinary upgrade card. */
export function abilityIdFromOffer(offerId: string): string | null {
  return offerId.startsWith(ABILITY_OFFER_PREFIX)
    ? offerId.slice(ABILITY_OFFER_PREFIX.length)
    : null;
}

/**
 * What a retainer costs: one charge per map still to come.
 *
 * Deliberately linear and deliberately legible - the card can say "N maps of
 * it" and the price is that number times a rate, so a player can check the
 * shop's arithmetic in their head. See the header for why inflation is not
 * applied on top.
 */
export function abilityOfferCost(mapsRemaining: number): number {
  const maps = Math.max(0, Math.floor(mapsRemaining));
  return Math.max(ABILITY_MIN_COST, Math.round(maps * ABILITY_HOURS_PER_MAP));
}

/** Later abilities are rarer and read as bigger; the tier is only cosmetic. */
function tierFor(def: AbilityDef): UpgradeTier {
  if (def.startLevel >= 15) return "Architect";
  if (def.startLevel >= 7) return "Principal";
  if (def.startLevel >= 4) return "Senior";
  return "Junior";
}

/**
 * True when the store's ability slot has nothing it could sell: the player
 * already holds as many distinct abilities as they may.
 *
 * `held` is what they have EVER held this run, not the current stack. A spent
 * ability still occupies its slot, which is the same rule the chest cap uses,
 * and the alternative would let a player free a slot by burning a charge.
 */
export function abilitySlotClosed(
  held: readonly string[],
  slots: number = MAX_ABILITY_SLOTS,
): boolean {
  return new Set(held).size >= Math.max(1, slots);
}

/**
 * The abilities on offer this visit, as cards the shop can render like any
 * other. Empty when the slot is closed, or when the player already holds
 * everything the level has unlocked.
 *
 * Seeded by the caller, so a Daily Stand-up shows every player the same shelf.
 */
export function rollAbilityOffers(
  level: number,
  mapsRemaining: number,
  held: readonly string[],
  count: number,
  rng: () => number,
  slots: number = MAX_ABILITY_SLOTS,
): UpgradeConfig[] {
  if (count <= 0) return [];
  const owned = new Set(held);
  const pool = getEligibleAbilities(level).filter(a => !owned.has(a.id));
  if (pool.length === 0) return [];

  // Weighted without replacement, by the same `weight` a chest rolls on, so a
  // rare ability stays rare wherever it is offered.
  const cost = abilityOfferCost(mapsRemaining);
  const picked: AbilityDef[] = [];
  const remaining = [...pool];
  // Never offer more distinct abilities than the player has room to take: two
  // cards with one slot left is two promises the shop cannot both keep, and at
  // the cap there is no room at all, which is what closes the slot. Stated once
  // here rather than also as an `abilitySlotClosed` guard above: two tests of
  // the same fact can disagree, and the one that is wrong is the one nobody
  // reads.
  const room = Math.max(1, slots) - owned.size;
  const want = Math.min(count, room, remaining.length);
  while (picked.length < want && remaining.length > 0) {
    const total = remaining.reduce((sum, a) => sum + a.weight, 0);
    let r = rng() * total;
    let idx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      r -= remaining[i].weight;
      if (r <= 0) { idx = i; break; }
    }
    picked.push(remaining.splice(idx, 1)[0]);
  }

  return picked.map((def): UpgradeConfig => ({
    id: abilityOfferId(def.id),
    name: def.name,
    tier: tierFor(def),
    description: def.description ?? "",
    cost,
    unlockLevel: def.startLevel,
    grantsAbility: def.id,
    abilityColor: def.color,
    abilityKind: def.kind,
    modifiers: {},
  }));
}
