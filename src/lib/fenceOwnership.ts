/**
 * Which fence types the player has, and which four are in the slots.
 *
 * Three economies grant them (FENCE_TYPES_PLAN.md step 7) - the store, the
 * upgrade chains and the certificate store - and this is the one place that
 * turns "what did they buy" into "what is in the bar". Pure, so all three can
 * be tested without a run, and so none of them gets its own idea of what a
 * slot is.
 *
 * ── Owning IS holding a slot ───────────────────────────────────────────────
 *
 * There is no separate inventory and no swap screen. The plan allowed for one,
 * and building it turned out to buy nothing: five acquirable types against four
 * slots means a swap matters exactly once per run, and only for a player who
 * bought all five. So a purchase goes straight into a slot, and the store stops
 * offering fence types once the four are full.
 *
 * That makes the purchase a real decision instead of a shopping list, which is
 * the same argument the plan makes for everything else here - and it costs the
 * player the ability to change their mind, which is worth stating plainly
 * rather than discovering.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 *
 * Store and upgrade grants are RUN-scoped: they arrive during a run and are
 * gone at the end of it, like every other upgrade. A certificate grant is
 * ACCOUNT-scoped and is therefore seeded into the roster at run start, so the
 * drill is simply in the bar from map one for a player who owns it. Both kinds
 * flow through `fenceSlotsFrom` so the bar cannot tell them apart.
 */
import { FENCE_SLOTS, STANDARD_FENCE_ID, isKnownFenceType } from "@/lib/fences";

/** How many slots the player can actually fill. Slot 1 is standard, always. */
export const ACQUIRABLE_SLOTS = FENCE_SLOTS - 1;

/**
 * The slot list, from everything the player has been granted.
 *
 * Order is ACQUISITION order, not catalogue order: the bar should not
 * rearrange itself when a new type arrives, because the slot a player has
 * learned to reach for has to stay where it was.
 *
 * Standard is dropped (it is slot 1 and cannot be unequipped), unknown ids are
 * dropped (a retired type, a typo in a store card), duplicates are dropped, and
 * the result is capped. Every one of those is a thing that would otherwise
 * reach the bar and either draw a duplicate the player cannot remove or push a
 * real type out of view.
 */
export function fenceSlotsFrom(granted: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of granted) {
    if (id === STANDARD_FENCE_ID) continue;
    if (!isKnownFenceType(id)) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= ACQUIRABLE_SLOTS) break;
  }
  return out;
}

/** True when there is room for another type. The store asks before offering. */
export function hasFreeFenceSlot(granted: readonly string[]): boolean {
  return fenceSlotsFrom(granted).length < ACQUIRABLE_SLOTS;
}

/**
 * The type a purchase should grant, or null when it cannot be granted.
 *
 * Refuses what is already held and what will not fit, so a card that somehow
 * survives into a full bar takes the player's hours and does nothing - the one
 * outcome a store must never have.
 */
export function grantFenceType(
  granted: readonly string[], id: string,
): string[] | null {
  if (!isKnownFenceType(id) || id === STANDARD_FENCE_ID) return null;
  const slots = fenceSlotsFrom(granted);
  if (slots.includes(id)) return null;
  if (slots.length >= ACQUIRABLE_SLOTS) return null;
  return [...granted, id];
}

/**
 * The selection to use, given the slots.
 *
 * Called whenever the roster changes. A selection that is no longer in a slot
 * has to fall back to standard rather than persist invisibly: the player would
 * be drawing a fence with no lit button anywhere on the bar, which reads as the
 * bar being broken rather than as a stale selection.
 */
export function resolveSelection(selected: string | undefined, slots: readonly string[]): string {
  if (!selected || selected === STANDARD_FENCE_ID) return STANDARD_FENCE_ID;
  return slots.includes(selected) ? selected : STANDARD_FENCE_ID;
}
