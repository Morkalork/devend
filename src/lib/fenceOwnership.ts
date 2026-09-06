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
 * There is no separate inventory and no swap screen. The plan allowed for one
 * and it would still be the wrong shape: a purchase goes straight into a slot,
 * and the store stops offering fence types once the four are full.
 *
 * The margin has since narrowed, and it is worth stating rather than
 * discovering. There are SIX acquirable types now against four slots - one open
 * shelf, four crowns of maxed families, and the account-scoped drill - so a
 * player who owns the drill has three slots for five earnable types. Filling
 * the bar is a thing that happens rather than a corner case, which is why
 * hasFreeFenceSlot below is wired into the shelf rather than merely available
 * to it: a crown offered into a full bar would take the hours for a family the
 * player maxed and grant nothing.
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

/**
 * Would offering this fence-granting card be a card that grants nothing?
 *
 * The shelf's question, asked through `grantFenceType` rather than beside it,
 * so the store's idea of "there is room" and the grant's idea of "this lands in
 * a slot" cannot come apart. It covers both ways a fence card can be empty: the
 * bar is full, and the type is already held.
 *
 * Both of those used to be reachable and unguarded. `grantFenceType` and
 * `hasFreeFenceSlot` were written for exactly this and NOTHING CALLED THEM -
 * the shelf filtered on level and choice group and knew nothing about slots, so
 * fenceSlotsFrom capped silently and the purchase took the player's hours for
 * nothing. Six acquirable types against four slots is what turned that from a
 * corner case into an ordinary evening.
 */
export function fenceOfferIsEmpty(
  grantsFenceType: string | undefined, granted: readonly string[],
): boolean {
  if (!grantsFenceType) return false;
  return grantFenceType(granted, grantsFenceType) === null;
}
