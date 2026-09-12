/**
 * Qualified overtime: the pay that goes PAST the per-map limit.
 *
 * Everything else a map pays is bounded. `backstop = round(basePoints x
 * overtimeCapHeadroom) + every axis ceiling`, and lock income in particular
 * banks through delivery (30h) and craft (30h) - so sixty hours is all the
 * locks on a map can ever be worth, whatever you did to earn them.
 *
 * ── The number that makes this necessary ───────────────────────────────────
 *
 * The simultaneous-lock multiplier is `newlyLocked`, applied to the SUM of the
 * balls locked in the pass, so the curve is already N-squared. For plain balls
 * at lockValue 3:
 *
 *      1 ball     3h nominal          2 balls    12h nominal
 *      3 balls   27h nominal          4 balls    48h nominal
 *
 * against a 16h ceiling. A four-ball pass - herding every ball on the map into
 * one pocket and closing it with a single cut - earns 48 and banks at most 16,
 * and only that much if nothing else had already filled those two lanes, which
 * on a map where you just did that is unlikely. In practice the fourth ball is
 * frequently worth NOTHING. The hardest play in the game pays like an ordinary
 * one, and nothing on screen says why.
 *
 * So this channel exists to let that curve be felt. It is added AFTER the
 * backstop clamp - the only income in the game that is - and it is reported on
 * its own line, because an uncapped number nobody can see is a score nobody
 * understands.
 *
 * ── Three rules, and they are what keep it safe ────────────────────────────
 *
 *   A FLAT TABLE      nothing multiplies it. Not the money ball, not Golden
 *                     Handshake, not the run's score multiplier, not the
 *                     launch power. Every other bonus in the game is bounded by
 *                     something; this one is bounded only by being a constant,
 *                     so a stacked build cannot turn "uncapped" into "infinite".
 *   THE REAL COUNT    keyed to balls actually locked, never to the simultaneous
 *                     MULTIPLIER. Chain Reaction adds to the multiplier, so
 *                     reading that would let a set bonus push a three-ball pass
 *                     into the four-ball bracket for free.
 *   CLAMPED AT FOUR   `maxBalls` across all forty maps is four. A pass of five
 *                     means something upstream is broken, so the table's last
 *                     entry is held rather than extrapolated: a bug should cost
 *                     a wrong number, not an unbounded one.
 */
import type { FenceTypeDef } from "@/lib/fences";

/**
 * The most balls one pass can lock, as far as the pay table is concerned.
 *
 * Checked against the ladder rather than assumed: every map's `maxBalls` is 1,
 * 2, 3 or 4. Above this the table holds its last value - see the header.
 */
export const MAX_SIMULTANEOUS_LOCK = 4;

/**
 * Lock-value units of qualified overtime for a pass of `ballCount` balls sealed
 * by a cut of this type. Zero for every type without a table.
 *
 * Units rather than hours so the figure follows `lockValue` in
 * scoring-config.yml: this is lock income that escapes the lock ceiling, not a
 * separate currency, and retuning the lock economy should retune it too.
 */
export function qualifiedUnitsFor(
  type: Pick<FenceTypeDef, "qualifiedByCount">, ballCount: number,
): number {
  const table = type.qualifiedByCount;
  if (table.length === 0 || ballCount < 1) return 0;
  const n = Math.min(Math.round(ballCount), MAX_SIMULTANEOUS_LOCK);
  // Held rather than extrapolated past the end of the table, for the same
  // reason it is clamped at four.
  return table[Math.min(n, table.length) - 1] ?? 0;
}

/** Hours of qualified overtime, at the run's lock value. */
export function qualifiedHoursFor(
  type: Pick<FenceTypeDef, "qualifiedByCount">, ballCount: number, lockValue: number,
): number {
  return Math.round(qualifiedUnitsFor(type, ballCount) * Math.max(0, lockValue));
}
