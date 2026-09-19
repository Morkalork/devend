/**
 * Has this event already had its residue burst?
 *
 * ── The bug this exists to make impossible ──────────────────────────────────
 *
 * Reported from play on level 7: "when I locked the ball in the bottom right
 * corner something happened and the lock highlight color flashes constantly.
 * Race condition?" It is not a race - the game state after a lock is stable,
 * measured over 240 frames, nothing about it moves. It is a cache eviction
 * turning a one-shot event into a repeating one.
 *
 * The mote layer sprays a puff of coloured residue when something happens: a
 * slab breaks, a pocket locks. Both events are read off state the game already
 * keeps (`objectDebris`, `assimilations`), because both carry a start time and
 * a burst is then a read of something that happened rather than a second thing
 * to remember to fire. A `seen` set of keys kept one event from spraying on
 * every frame of its animation.
 *
 * Neither list is ever pruned - `assimilations` is cleared when the NEXT map is
 * built, and `objectDebris` likewise - so every lock and every break stands in
 * it for the rest of the map. That was survivable only while `seen` remembered
 * them, and `seen` could not: it grew with every event, so it was emptied
 * wholesale past 200 entries. The frame after that, every lock and every break
 * still standing in those lists read as brand new and sprayed again. Then the
 * set refilled, was emptied again, and sprayed again - in the lock's own
 * colour, at the locked pocket, for the rest of the map.
 *
 * Level 7 is where it was found and not a coincidence: eleven brittle
 * partitions and a chest put events through that cap faster than anything else
 * on the ladder.
 *
 * ── Why an age and not a bigger cache ───────────────────────────────────────
 *
 * The set was doing two jobs. One is deduplication inside a burst's own
 * lifetime, which a cache does well. The other is remembering for ever that an
 * event has already played, which no BOUNDED cache can do - and an unbounded
 * one is a leak for the length of a run. So the second job moves to the event
 * itself: a burst is a reaction to something HAPPENING, so it only fires while
 * the event is fresh, and an event's age is a fact that cannot be evicted.
 *
 * The cache then only has to span the freshness window, which is a handful of
 * entries, so it is pruned by age instead of emptied by size and there is
 * nothing left for a clear to resurrect.
 */

/**
 * How long after an event a residue burst may still fire.
 *
 * Long enough that a dropped frame or two does not lose the puff, short enough
 * that it is unmistakably "as it happened". Missing one burst is a particle
 * effect nobody notices; repeating one is what this file is named after.
 */
export const RESIDUE_FRESH_MS = 250;

/**
 * Claim an event's one burst, or refuse it.
 *
 * Mutates `seen`, which is the point: claiming is what stops the next frame
 * from spraying the same event again. Prune with `pruneResidueSeen` on the
 * same tick so the map stays the size of the freshness window.
 */
export function claimResidue(
  seen: Map<string, number>, key: string, startTime: number, now: number,
): boolean {
  if (now - startTime > RESIDUE_FRESH_MS) return false;
  // Not `< 0`: a tiny negative age is an event stamped this very tick, which is
  // exactly the one that should fire.
  if (seen.has(key)) return false;
  seen.set(key, startTime);
  return true;
}

/** Drop claims that can no longer be claimed again anyway. */
export function pruneResidueSeen(seen: Map<string, number>, now: number): void {
  for (const [key, startTime] of seen) {
    if (now - startTime > RESIDUE_FRESH_MS) seen.delete(key);
  }
}
