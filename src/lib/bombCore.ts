/**
 * The bomb inside every destructible box.
 *
 * A slab or chest is a hull round a bomb. Each hit chips the hull, and the
 * wear opens a hole in it through which the bomb shows, a little more each
 * time. Once the bomb is fully showing, the next ball to touch the box hits
 * the bomb, and the whole box goes up.
 *
 * Exposure lands at "all but the last hit" of the box's integrity, so a box
 * still takes the hits it always did (a three-hit slab: two to open it, the
 * third on the bomb). What changes is that the last hit is visible as a
 * target before it is landed, and that no single blow can skip it: a hull hit
 * only ever exposes; it is the bomb that destroys.
 *
 * Not in one-touch brittle shards (nothing to chip), fence-style curtains (a
 * line, not a box), mirrors or movers. A map opts a box out with `bomb: false`.
 */
import type { WallEntity } from "@/types/level";
import type { DestructibleState } from "@/types/game";

/** Does this authored wall get a bomb? Asked once, when the map is built. */
export function entityHasBomb(e: Pick<WallEntity, "breakable" | "chest" | "brittle" | "fence" | "bomb">): boolean {
  if (e.bomb === false) return false;
  if (e.brittle || e.fence) return false;
  return !!(e.breakable || e.chest);
}

/** The hull's share of the integrity: all of it but the last hit. */
export function bombExposeAt(maxHits: number): number {
  return Math.max(0, maxHits - 1);
}

/** How much of the bomb shows, 0..1: the hull's wear against what it takes to open it. */
export function bombReveal(d: Pick<DestructibleState, "hits" | "bombExposeAt" | "bombExposed">): number {
  if (d.bombExposed) return 1;
  const at = d.bombExposeAt ?? 0;
  if (at <= 0) return 1;
  return Math.max(0, Math.min(1, d.hits / at));
}

/**
 * Apply one counted hit to a bomb box, returning the damage the hit really
 * does. A hull hit wears up to the exposure point and no further; a hit on
 * an exposed bomb spends the rest of the box at once.
 */
export function bombHitDamage(d: DestructibleState, amount: number, now: number): number {
  if (d.bombExposed) {
    d.bombDetonated = true;
    return Math.max(0, d.maxHits - d.hits);
  }
  const at = d.bombExposeAt ?? bombExposeAt(d.maxHits);
  const dealt = Math.max(0, Math.min(amount, at - d.hits));
  if (d.hits + dealt >= at) {
    d.bombExposed = true;
    d.bombExposedAt = now;
  }
  return dealt;
}

/** The bomb's colours: a dark iron casing and a fuse light that says "hit me". */
export const BOMB_CASING = 0x1a1d22;
export const BOMB_LIGHT = 0xff3b2a;
/** The fire the box goes up in. */
export const BOMB_BLAST_COLOR = "#ff5a2a";
/** The bomb's radius against the box's smaller half-extent. */
export const BOMB_SIZE = 0.62;
/** The fuse light's blink once exposed, ms per cycle. */
export const BOMB_BLINK_MS = 520;
