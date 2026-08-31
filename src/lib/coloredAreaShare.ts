/**
 * What a map's colored areas are worth.
 *
 * A colored area used to pay purely as a MULTIPLIER on the locks made inside
 * it, and the Craft axis treats zone locks as one route to a full axis among
 * several - superior locks, simultaneous cuts, money balls and frozen locks all
 * reach the same ceiling. That is a reasonable economy and it makes an area
 * optional: a player who never goes near one is not behind, so the zones read
 * as decoration for people who like them.
 *
 * They are meant to be the early answer to "why would I lock anywhere in
 * particular", so they need to cost something to skip. A map that has areas now
 * attaches a SHARE of its own points to them - 40% by default - and pays that
 * share in proportion to the areas satisfied. Clear the map and ignore the
 * zones and you bank 60% of what the map was worth, which is a price worth
 * paying only when the clock is about to beat you.
 *
 * ── Out of the map's points, not on top of them ────────────────────────────
 *
 * The share is withheld from the map's existing points rather than added
 * alongside. Adding would make every zone map pay MORE than a zone-free one for
 * the same play, which inflates the ladder and makes the areas a bonus again
 * by another name. Withholding makes them a target.
 *
 * Because basePoints scales both the map's payout and its overtime cap, a
 * player who skips the zones gets a proportionally smaller cap too - which is
 * correct: they attempted less of the map.
 */
import type { LevelConfig } from "@/types/level";

/** The share of a map's points its colored areas carry, unless the map says otherwise. */
export const DEFAULT_COLORED_AREA_SHARE = 0.4;

/**
 * Clamped hard. A share of 1 would make a map pay nothing at all for clearing
 * it, and a negative one would pay a bonus for ignoring the zones.
 */
export const MAX_COLORED_AREA_SHARE = 0.8;

export const clampAreaShare = (v: number): number =>
  Math.max(0, Math.min(MAX_COLORED_AREA_SHARE, v));

/**
 * How much of THIS map's points ride on its areas.
 *
 * Zero when the map has none, which is what keeps every existing zone-free map
 * scoring exactly as it did.
 */
export function areaShareOf(
  level: Pick<LevelConfig, "coloredAreas" | "coloredAreaShare"> | null | undefined,
): number {
  const areas = level?.coloredAreas ?? [];
  if (areas.length === 0) return 0;
  const authored = level?.coloredAreaShare;
  return clampAreaShare(typeof authored === "number" ? authored : DEFAULT_COLORED_AREA_SHARE);
}

/**
 * The share of a map's pay to WITHHOLD, given how many of its areas were taken.
 *
 * This is the number the scorer wants: 0 when every area was satisfied (or the
 * map has none), rising to the full share when none were. The one call the game
 * makes, so the two halves of the rule cannot be combined wrongly at the call
 * site.
 */
export function missedAreaShare(
  level: Pick<LevelConfig, "coloredAreas" | "coloredAreaShare"> | null | undefined,
  liveAreas: ReadonlyArray<{ satisfied?: boolean }> | undefined,
): number {
  const share = areaShareOf(level);
  if (share <= 0) return 0;
  const { satisfied, total } = areaProgress(liveAreas);
  if (total <= 0) return 0;
  const taken = Math.max(0, Math.min(total, satisfied)) / total;
  return share * (1 - taken);
}

/**
 * The points a map actually pays out of, given how many of its areas were used.
 *
 * Proportional rather than all-or-nothing. A map with three zones and two taken
 * should not pay as though the player ignored all of them: partial credit is
 * what makes a third zone worth attempting when the clock is short, and
 * all-or-nothing would make the LAST zone the only one that mattered.
 */
export function effectiveBasePoints(
  basePoints: number,
  share: number,
  satisfiedAreas: number,
  totalAreas: number,
): number {
  if (!Number.isFinite(basePoints) || basePoints <= 0) return 0;
  if (share <= 0 || totalAreas <= 0) return basePoints;
  const taken = Math.max(0, Math.min(totalAreas, satisfiedAreas)) / totalAreas;
  const missed = clampAreaShare(share) * (1 - taken);
  return basePoints * (1 - missed);
}

/** How many of a map's areas have been satisfied, and how many there are. */
export function areaProgress(
  areas: ReadonlyArray<{ satisfied?: boolean }> | undefined,
): { satisfied: number; total: number } {
  const list = areas ?? [];
  return { satisfied: list.filter(a => !!a.satisfied).length, total: list.length };
}

/**
 * Hours to withhold from a map's gross pay for the zones that were skipped.
 *
 * Only ever off a POSITIVE pay, and that guard is the whole reason this is a
 * function rather than a line inside the scorer. Tempo can go negative - a
 * level-3 run showed it at -24h - and if the axes drive the total below zero,
 * multiplying by the missed share would make the number LESS negative. Skipping
 * the zones would soften the penalty, so the worse you played the more ignoring
 * them would help.
 */
export function withheldFromPay(grossMapPay: number, missedShare: number): number {
  if (!Number.isFinite(grossMapPay) || grossMapPay <= 0) return 0;
  const share = Math.max(0, Math.min(1, Number.isFinite(missedShare) ? missedShare : 0));
  return Math.round(grossMapPay * share);
}
