/**
 * Map highscore helpers (#45). Pure functions shared by the persistence hook
 * (useMetaProgression) and the run session (useGameSession), so the "did we beat
 * the record, and what does that pay" logic lives in one tested place.
 *
 * A map's highscore is its best-ever base level score. `previous === null` means
 * the map has never been completed - the first completion just sets the baseline
 * and is NOT treated as beating a record (so no bonus), matching the ticket's
 * "if it has been played before".
 */

/** The best score to store, given the previous best (null = first play). */
export function bestHighscore(previous: number | null, score: number): number {
  return previous === null ? score : Math.max(previous, score);
}

/** True only when `score` beats an EXISTING highscore (first play is not a record). */
export function isHighscoreRecord(previous: number | null, score: number): boolean {
  return previous !== null && score > previous;
}

/**
 * Bonus score credited for beating the highscore: `round(score * (mult - 1))`,
 * or 0 when it isn't a genuine record. Applied on top of the (already capped)
 * base score, so beating a record always pays.
 */
export function highscoreBonus(previous: number | null, score: number, multiplier: number): number {
  if (!isHighscoreRecord(previous, score)) return 0;
  const m = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.max(0, Math.round(score * (m - 1)));
}
