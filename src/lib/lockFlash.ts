/**
 * Is a lock flash still playing?
 *
 * One question, asked from three places that must agree: the win check, which
 * defers the push prompt while a flash is mid-pulse; the loop's deferred-prompt
 * hold, which waits for the same flash; and the loop's level-complete hold,
 * which keeps drawing while lock animations finish.
 *
 * The third one was not asking it at all. It tested `assimilations.size > 0`,
 * and nothing ever REMOVES a flash - the map only clears them all when the next
 * one is built - so on any map where a ball locked, a finished level rendered
 * and rescheduled for ever behind the results screen. A phone rendering the
 * same frame at sixty a second until the player reaches the next map is not a
 * freeze, but it is the same mistake in the same family: a hold with no end in
 * it.
 */
import type { LockFlashState } from "@/types/game";
import { LOCK_TOTAL_DURATION } from "@/lib/gameConstants";

/** True while any flash in `flashes` is still within its animation. */
export function anyLockFlashActive(
  flashes: Iterable<LockFlashState> | null | undefined, now: number,
): boolean {
  if (!flashes) return false;
  for (const f of flashes) {
    if (now - f.startTime < LOCK_TOTAL_DURATION) return true;
  }
  return false;
}

/** When the last flash in `flashes` finishes; 0 when there are none. */
export function lockFlashEnd(
  flashes: Iterable<LockFlashState> | null | undefined,
): number {
  let end = 0;
  if (!flashes) return end;
  for (const f of flashes) {
    const at = f.startTime + LOCK_TOTAL_DURATION;
    if (at > end) end = at;
  }
  return end;
}
