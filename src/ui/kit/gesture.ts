/**
 * Who owns a finger's drag.
 *
 * On the DOM the browser decided whether a drag belonged to the page or to a
 * strip inside it, and a button let go of its tap once the page took the
 * finger. On the canvas every handler hears every pointer, so without this the
 * store's page scrolled along with every swipe of the card strip inside it.
 *
 * The rule: whoever first sees the finger travel past the press slop along its
 * own axis claims the pointer, and from then on everyone else leaves it alone.
 * A press (usePress) never claims; it lets go of its tap when anyone else does.
 */

/** The owner of each live pointer's drag, by pointer id. */
const owners = new Map<number, symbol>();
/** The DOM event that started each pointer's current gesture. */
const starts = new Map<number, unknown>();

/**
 * A touch-down: if it is a new one for this pointer id, forget whoever owned
 * the last. Every participant calls it from its own pointer-down, and they all
 * hear the same DOM event, so `start` (that event) is what tells a new touch
 * from a second listener of this one: a scroller catching a fling claims on
 * touch-down, and the next listener up must not wipe that claim. It also
 * means a claim whose pointer-up never arrived cannot outlive its gesture.
 */
export function beginPointer(pointerId: number, start: unknown): void {
  if (starts.get(pointerId) === start) {
    return;
  }
  starts.set(pointerId, start);
  owners.delete(pointerId);
}

/** Take the drag. True when it is now (or already was) yours. */
export function claimPointer(pointerId: number, owner: symbol): boolean {
  const current = owners.get(pointerId);
  if (current !== undefined && current !== owner) {
    return false;
  }
  owners.set(pointerId, owner);
  return true;
}

/** Whether someone other than `owner` holds the drag. */
export function claimedByOther(pointerId: number, owner?: symbol): boolean {
  const current = owners.get(pointerId);
  return current !== undefined && current !== owner;
}

/** Give the drag back, if it is yours. */
export function releasePointer(pointerId: number, owner: symbol): void {
  if (owners.get(pointerId) === owner) {
    owners.delete(pointerId);
  }
}
