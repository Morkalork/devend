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
/**
 * A drag promised to one participant before anyone has claimed it: the pan
 * view reserves every touch that lands on it. Nobody else may claim a
 * reserved pointer, but a reservation is not a claim, so a tap under the
 * finger still fires until the reserver actually takes the drag.
 *
 * Why it exists: the ball tree's map is a pan view inside the between-map
 * screen's scroll view. Both heard the same finger, and on a phone the first
 * move often jumps past both slops in one event, so a vertical drag on the map
 * went to whichever listener ran first, often the page. A page pulled down at
 * its top rubber-bands, and a scroll view still moving claims the NEXT
 * touch-down to catch it, so the drag after that was the page's too. Reported
 * as the tree being very hard to pan, worst when dragging down.
 */
const reservations = new Map<number, symbol>();
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
  reservations.delete(pointerId);
}

/**
 * Promise this touch's drag to `owner`: nobody else may claim it. Called from
 * a pointer-down, after beginPointer. The innermost participant hears the
 * pointer-down first, so a pan view inside a scroll view reserves before the
 * scroll view can claim on touch-down.
 */
export function reservePointer(pointerId: number, owner: symbol): void {
  if (!reservations.has(pointerId)) {
    reservations.set(pointerId, owner);
  }
}

/** Take the drag. True when it is now (or already was) yours. */
export function claimPointer(pointerId: number, owner: symbol): boolean {
  const current = owners.get(pointerId);
  if (current !== undefined && current !== owner) {
    return false;
  }
  const reserved = reservations.get(pointerId);
  if (reserved !== undefined && reserved !== owner) {
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
  if (reservations.get(pointerId) === owner) {
    reservations.delete(pointerId);
  }
}
