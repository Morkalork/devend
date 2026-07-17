/**
 * Shared draw logic for the curse+blessing loadout drafts.
 *
 * The same draw backs two screens: the post-final-level Ascension draft
 * (AscensionDraftScreen) and the run-start loadout draft (RunDraftScreen).
 * Unlock filtering for the run-start draft lives in loadoutUnlock.ts.
 */
import { LoadoutConfig } from '@/types/loadout';

/**
 * Pick `count` random loadouts not yet drafted (falls back to the full
 * catalogue when the pool runs dry at extreme depths — duplicates stack).
 * `rng` defaults to Math.random; seeded (daily) runs pass getRunRng(...).
 */
export function drawOffers(
  loadouts: LoadoutConfig[],
  draftedIds: string[],
  count: number,
  rng: () => number = Math.random,
): LoadoutConfig[] {
  let pool = loadouts.filter(l => !draftedIds.includes(l.id));
  if (pool.length === 0) pool = [...loadouts];
  const offers: LoadoutConfig[] = [];
  const candidates = [...pool];
  while (offers.length < count && candidates.length > 0) {
    const i = Math.floor(rng() * candidates.length);
    offers.push(candidates.splice(i, 1)[0]);
  }
  return offers;
}
