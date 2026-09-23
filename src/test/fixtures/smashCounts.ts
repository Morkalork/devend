/**
 * Smashed counts for a snapshot fixture.
 *
 * `WinSnapshot.smashed` became a per-class record when shards and monoliths
 * were told apart (lib/destructibleClass), and the dozen fixtures that used to
 * write `smashed: 0` or `smashed: 9` all meant something the record can say
 * exactly: nothing broken, or a board where every class is well past whatever
 * the clause asks for.
 *
 * Kept here rather than in the library because neither shape is something the
 * game ever builds - the real one comes from `smashCounts(destructibles)` over
 * an actual board. A fixture wants a number it chose; production wants the
 * board's own truth, and the two should not share a constructor.
 */
import type { SmashCounts } from "@/types/winSpec";

/** The same count in every class, for a fixture that only cares "enough". */
export const everySmashed = (n: number): SmashCounts =>
  ({ any: n, shards: n, monoliths: n });
