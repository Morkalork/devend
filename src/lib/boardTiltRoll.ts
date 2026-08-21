/**
 * Sporadic board tilts (issue #77): the map turns a quarter, rarely, and you
 * do not know when.
 *
 * The point is what it does to a gravity well. A map is authored so no well
 * pulls into a wall it sits against; a tilt revokes that guarantee, because the
 * pull is SCREEN-absolute and the board turns underneath it. A well that was
 * safely mid-board can end up pulling into an edge. A map that looked easy
 * turns sinister, and the player has to re-read a board they had already
 * solved.
 *
 * Three decisions worth stating, because each has an obvious wrong version.
 *
 * RARE AND UNPREDICTABLE, not rhythmic. A metronome is something you plan
 * around, which would make the board's orientation just another known quantity.
 * The chance is rolled fresh per map so the cadence cannot be learned across
 * runs either.
 *
 * ROLLED ON PROGRESS, not on a clock. Tying it to time means good play never
 * sees one: the Ship Early windows are 6 to 15 seconds per ball, so a
 * well-played map is over before a time-based roll would fire, and the "sinister
 * turn" would only ever punish players already struggling. Progress tiers fire
 * for everyone.
 *
 * ONLY ON MAPS WITH WELLS. On a map with none, a rigid rotation preserves every
 * relationship inside it, so a tilt is pure disorientation with no mechanical
 * meaning. The tilt has to have something to break to be worth anything.
 */
import type { GravityWell } from "@/types/level";

/** Tilts only exist past the teaching band, which is full of other first ideas. */
export const TILT_MIN_LEVEL = 11;

/** Board cleared (percent) at which a roll happens. Progress, never time. */
export const TILT_TIERS = [20, 40, 60, 80] as const;

/** The per-tier chance is drawn from this band at map start. */
export const TILT_CHANCE_MIN = 0.05;
export const TILT_CHANCE_MAX = 0.10;

/**
 * The per-tier tilt chance for one map, drawn once at map start.
 *
 * A fixed number would be learnable across runs ("about one map in four"); a
 * band means a player can never be sure whether this map is a quiet one.
 */
export function rollTiltChance(rng: () => number): number {
  // Number.isFinite first: Math.max(0, NaN) is NaN, which would survive the
  // clamp and make every later `rng() < chance` false, so tilts would silently
  // never fire and the feature would look unimplemented rather than broken.
  const raw = rng();
  const t = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  return TILT_CHANCE_MIN + t * (TILT_CHANCE_MAX - TILT_CHANCE_MIN);
}

/** Does this map tilt at all? */
export function mapCanTilt(
  levelNumber: number, wells: readonly GravityWell[] | undefined,
): boolean {
  return levelNumber >= TILT_MIN_LEVEL && (wells?.length ?? 0) > 0;
}

/**
 * The highest tier reached at this much of the board cleared.
 *
 * Returns the tier VALUE rather than an index so a caller can record which
 * tiers have fired without caring about the table's order or length.
 */
export function tiersReached(clearedPercent: number): number[] {
  return TILT_TIERS.filter(t => clearedPercent >= t);
}

/**
 * Tiers newly crossed since last time, given the ones already recorded.
 *
 * Space can jump several tiers in one cut (a big capture, or a destroy
 * reopening and reclaiming), so this returns every tier crossed rather than
 * assuming one at a time. Each still gets its own roll: crossing two tiers at
 * once should be two chances, not one.
 */
export function newTiers(clearedPercent: number, fired: readonly number[]): number[] {
  const done = new Set(fired);
  return tiersReached(clearedPercent).filter(t => !done.has(t));
}

/** How many of `tiers` come up, at `chance` each. One roll per tier. */
export function rollTilts(tiers: readonly number[], chance: number, rng: () => number): number {
  let hits = 0;
  for (let i = 0; i < tiers.length; i++) if (rng() < chance) hits++;
  return hits;
}

/**
 * Which way to turn. Left or right at random rather than always one way, so a
 * player cannot pre-plan the new orientation the instant a tilt begins.
 */
export function rollTiltDirection(rng: () => number): 1 | -1 {
  return rng() < 0.5 ? 1 : -1;
}
