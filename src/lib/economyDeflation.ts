/**
 * The overtime economy's scale, and the one-shot migration off the old one.
 *
 * Overtime hours were deflated by DEFLATION_FACTOR: a good map paid ~136h and
 * now pays ~34h, because five-figure-adjacent payouts stopped reading as a
 * number and started reading as noise. Every price, ceiling and threshold moved
 * with it, so the economy's RATIOS are unchanged - what a map pays against what
 * a hire costs is exactly what it was.
 *
 * WHY 4 AND NOT 10. The Performance Review banks each axis as
 * `Math.round(ceiling x ratio)`, so a ceiling is also a resolution: it sets how
 * many outcomes an axis can tell apart. Measured over 3600 play qualities
 * through bankAxes itself, the whole review distinguishes 137 outcomes today.
 * At /4 it still distinguishes 38, and 3.5% of runs that differ now would tie.
 * At /10 it distinguishes 15, 10.9% of runs tie, and per-map rounding drift
 * averages 7.7% (worst 54%) - the six bars stop measuring and start grading.
 * /4 also happens to land every authored value on a clean integer (lockValue
 * 12 -> 3, chunk 60 -> 15, the 10/18/30 chain -> 3/5/8); /10 turns three of
 * those into 1s.
 *
 * ── The migration ──────────────────────────────────────────────────────────
 *
 * Banked scores OUTLIVE the economy that produced them: per-map highscores,
 * per-archetype bests and the Hall of Fame are all in localStorage in old
 * hours. Left alone they would sit 4x above anything the new economy can pay,
 * so every record becomes permanently unbeatable and the beat-your-highscore
 * bonus (highscoreBonusMultiplier) never fires again. That is a silent,
 * permanent loss of a whole progression system, which is why this is not
 * optional cleanup.
 *
 * Each store carries an `economyScale` stamp. A blob written before the
 * deflation has no stamp, so it is divided once and re-stamped; a stamped blob
 * is passed through untouched. The stamp is what makes it idempotent - without
 * it a player who opened the game twice would have their records quartered
 * twice.
 */

/** Hours in the OLD economy per hour in the new one. */
export const DEFLATION_FACTOR = 4;

/**
 * Bumped whenever hour-denominated saves need rescaling again. 1 is the
 * implicit scale of every save written before this existed.
 */
export const ECONOMY_SCALE_VERSION = 2;

/**
 * Convert one old-economy hour figure to the new scale.
 *
 * Rounds rather than floors so a record does not drift downward every time the
 * scale changes, and keeps any positive value at 1 or more: a 2h record
 * quartering to 0 would read as "never played this map" to every caller that
 * treats 0 as absent, and would drop the map off the highscore board entirely.
 */
export function deflateHours(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(1, Math.round(value / DEFLATION_FACTOR));
}

/** True when a loaded blob predates the current scale and needs converting. */
export function needsDeflation(stamp: unknown): boolean {
  const seen = typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : 1;
  return seen < ECONOMY_SCALE_VERSION;
}

/** Rescale a map-id -> hours record (map highscores, archetype bests). */
export function deflateRecord(values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) out[key] = deflateHours(value);
  return out;
}
