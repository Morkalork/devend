/**
 * Which rules a run plays its store by (CARDS_PLAN.md).
 *
 *  - `classic`: the original store. upgrades.yml, every card bought with hours,
 *    no limit on how many a build holds.
 *  - `draft`: cards.yml, a build of CARD_SLOTS cards (a seventh means dropping
 *    one), and two kinds of store (storeKindAfter):
 *
 *      the PICK, after an ordinary map: PICK_CHOICES cards, take one, free,
 *      as long as the map locked enough balls to open the store at all (the
 *      lock toll in useGameSession). Hours are not spent here; there is
 *      nothing to spend them on. A won contract deals the pick from the
 *      rarer cards.
 *
 *      the SHOP, after a boss: the same free pick, and then the hours banked
 *      since the last boss buy the rest, a shelf of SHOP_CHOICES priced
 *      cards, abilities and rerolls.
 *
 *    So the build grows at one card a map for everyone, and what a run earned
 *    on the board shows at the shop, where the hours go. It opened as "take
 *    one card free a map, or skip it for hours, and buy more", and that read
 *    as too many cards too early; then as "every card bought", which made a
 *    scrappy run fall behind on cards as well as on hours.
 *
 * The rule set is fixed when a run starts and saved with it, because the two
 * read different catalogues: a run resumed under the other set would own ids
 * its catalogue has never heard of.
 */
import type { UpgradeConfig } from "@/types/upgrade";
import type { LevelConfig } from "@/types/level";

export type RuleSet = "classic" | "draft";

const CLASSIC_KEY = "devend:classicStore";

/** How many cards a draft build holds. A card's "+" rides on its card. */
export const CARD_SLOTS = 6;
/** The first reroll of a visit (shop only); each further one costs this much more. */
export const REROLL_HOURS = 6;
/** Cards a pick deals: Slay the Spire's three, enough to be a choice and few enough to read. */
export const PICK_CHOICES = 3;
/** Cards a shop deals, before any extra shop items: the pick's three and two more to buy. */
export const SHOP_CHOICES = 5;
/** Free cards at any open draft store: the pick, one. */
export const FREE_PICKS = 1;

/** The two draft stores: see the header. */
export type StoreKind = "pick" | "shop";

/** Which store opens after `cleared`: the shop after a boss, the pick after anything else. */
export function storeKindAfter(cleared: Pick<LevelConfig, "boss"> | null | undefined): StoreKind {
  return cleared?.boss ? "shop" : "pick";
}

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
