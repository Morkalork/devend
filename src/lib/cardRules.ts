/**
 * Which rules a run plays its store by (CARDS_PLAN.md).
 *
 *  - `classic`: the original store. upgrades.yml, every card bought with hours,
 *    no limit on how many a build holds.
 *  - `draft`: cards.yml, a build of CARD_SLOTS cards (a seventh means dropping
 *    one), and EVERY card bought with hours. A common card costs about what an
 *    ordinary map pays, so a normal run affords one card a map and a strong map
 *    affords two or three: more cards are earned on the board, never dealt.
 *    The run's one free card is the Sprint Planning offer before map 1, and a
 *    won contract deals one more. Hours also buy a reroll and abilities.
 *
 *    It opened as "take one card free a map, or skip it for hours", and that
 *    read as too many cards too early: with the free card and a second bought
 *    the build of six was full by map 4, and every store after was a swap.
 *
 * The rule set is fixed when a run starts and saved with it, because the two
 * read different catalogues: a run resumed under the other set would own ids
 * its catalogue has never heard of.
 */
import type { UpgradeConfig } from "@/types/upgrade";

export type RuleSet = "classic" | "draft";

const CLASSIC_KEY = "devend:classicStore";

/** How many cards a draft build holds. A card's "+" rides on its card. */
export const CARD_SLOTS = 6;
/** The first reroll of a visit; each further one costs this much more. */
export const REROLL_HOURS = 6;

/**
 * What a new run plays when nothing has been chosen: the draft, except under
 * the test runner. Hundreds of session tests start a run and read the classic
 * catalogue's own ladders by id; they are about the classic store, and a test
 * of the draft asks for it by name (setPreferredRuleSet).
 */
const DEFAULT_RULES: RuleSet = import.meta.env.MODE === "test" ? "classic" : "draft";

/** The rule set a NEW solo run starts with: the draft, unless Admin asked for the classic store. */
export function preferredRuleSet(): RuleSet {
  try {
    const stored = localStorage.getItem(CLASSIC_KEY);
    if (stored === "1") {
      return "classic";
    }
    if (stored === "0") {
      return "draft";
    }
    return DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES; // storage blocked (private mode, embedded webview)
  }
}

export function setPreferredRuleSet(rules: RuleSet): void {
  try {
    localStorage.setItem(CLASSIC_KEY, rules === "classic" ? "1" : "0");
  } catch {
    /* storage blocked: stays on the default */
  }
}

/**
 * The rule set of the run being played. Module state, like the live pricing,
 * because the catalogue loader and the store both read it outside React.
 */
let active: RuleSet = "classic";

export function getActiveRuleSet(): RuleSet {
  return active;
}

export function setActiveRuleSet(rules: RuleSet): void {
  active = rules;
}

/** The catalogue file a rule set reads. */
export function catalogueFileFor(rules: RuleSet): string {
  return rules === "draft" ? "/cards.yml" : "/upgrades.yml";
}

/** A card's "+": the upgraded version, which rides on its card and takes no slot. */
export function isPlusCard(u: Pick<UpgradeConfig, "upgradeOf"> | undefined): boolean {
  return !!u?.upgradeOf;
}

/** The owned cards that each take a slot, in the order they were taken. */
export function slotCards(ownedIds: readonly string[], lookup: Map<string, UpgradeConfig>): UpgradeConfig[] {
  const out: UpgradeConfig[] = [];
  for (const id of ownedIds) {
    const u = lookup.get(id);
    if (u && !isPlusCard(u)) {
      out.push(u);
    }
  }
  return out;
}

/** `id` and its "+", if owned: what leaves the build when a card is dropped. */
export function withPlus(id: string, ownedIds: readonly string[], lookup: Map<string, UpgradeConfig>): string[] {
  return ownedIds.filter(o => o === id || lookup.get(o)?.upgradeOf === id);
}

/** The price of the next reroll this visit. */
export function rerollPrice(rerollsUsed: number, discount = 1): number {
  return Math.max(1, Math.round(REROLL_HOURS * (rerollsUsed + 1) * discount));
}
