/**
 * Contracts (CARDS_PLAN.md, phase 5): the draft's elite maps.
 *
 * A store visit may offer a contract on the NEXT map: one hard rule for that
 * map only (faster balls, bigger balls, slower fences). Take it and win the
 * map, and the store after it deals two free cards from the uncommon and rare
 * ones. Each contract asks a different question, so a build answers some
 * better than others: slow or freeze for the fast balls, shields or
 * Compression for the big ones, tempo cards for the slow fences.
 *
 * Which contract is offered turns with the map number rather than a roll, so
 * every kind comes round and none needs forcing to be seen.
 */
import type { LevelConfig } from "@/types/level";

export interface Contract {
  id: string;
  name: string;
  description: string;
  /** GameModifiers applied to the contracted map only. */
  modifiers: Record<string, number>;
}

/** The first map a contract may be offered ON: the early maps are still teaching. */
export const CONTRACT_MIN_LEVEL = 4;
/**
 * Free cards at the store after a contracted map is won: the one free card a
 * store ever deals. It was two while an ordinary store also dealt one free;
 * now every ordinary card is bought, the contract is how a card is earned
 * on the board rather than with hours, and one is the whole point.
 */
export const CONTRACT_FREE_PICKS = 1;

/**
 * The contract offered for the map about to be played, or null: none before
 * CONTRACT_MIN_LEVEL, none on a boss (it is its own test), none on the last
 * store of a run.
 */
export function contractFor(
  nextLevel: LevelConfig | null | undefined, nextLevelNumber: number, contracts: readonly Contract[],
): Contract | null {
  if (!nextLevel || contracts.length === 0) {
    return null;
  }
  if (nextLevelNumber < CONTRACT_MIN_LEVEL || nextLevel.boss) {
    return null;
  }
  return contracts[nextLevelNumber % contracts.length];
}

/** Read the `contracts:` block of cards.yml; a malformed entry is dropped. */
export function parseContracts(raw: unknown): Contract[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Contract[] = [];
  for (const entry of raw) {
    const c = entry as Partial<Contract>;
    if (c && typeof c.id === "string" && typeof c.name === "string" && typeof c.description === "string"
        && c.modifiers && typeof c.modifiers === "object" && Object.keys(c.modifiers).length > 0) {
      out.push({ id: c.id, name: c.name, description: c.description, modifiers: c.modifiers });
    }
  }
  return out;
}
