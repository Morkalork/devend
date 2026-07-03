/**
 * Shared helpers for the curse+blessing mutator drafts.
 *
 * The same draw logic backs two screens: the post-final-level Ascension draft
 * (AscensionDraftScreen) and the run-start loadout draft (RunDraftScreen).
 */
import { MutatorConfig } from '@/types/mutator';

/**
 * Pick `count` random mutators not yet drafted (falls back to the full
 * catalogue when the pool runs dry at extreme depths — duplicates stack).
 */
export function drawOffers(
  mutators: MutatorConfig[],
  draftedIds: string[],
  count: number,
): MutatorConfig[] {
  let pool = mutators.filter(m => !draftedIds.includes(m.id));
  if (pool.length === 0) pool = [...mutators];
  const offers: MutatorConfig[] = [];
  const candidates = [...pool];
  while (offers.length < count && candidates.length > 0) {
    const i = Math.floor(Math.random() * candidates.length);
    offers.push(candidates.splice(i, 1)[0]);
  }
  return offers;
}

/**
 * Mutators eligible to be offered at the start of a run (the loadout draft).
 * `startEligible` defaults to true; only an explicit `false` opts a mutator out.
 */
export const eligibleForStart = (mutators: MutatorConfig[]): MutatorConfig[] =>
  mutators.filter(m => m.startEligible !== false);
