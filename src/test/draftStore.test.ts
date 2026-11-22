/**
 * The draft store's rules (CARDS_PLAN.md): every card bought with hours, a
 * won contract's store dealing one free, a build of a fixed number of slots,
 * and a card given up to make room for another.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";
import type { LevelConfig } from "@/types/level";
import {
  draftBarLine, draftBuild, draftPriceOf, freePickIdsOf, needsReplacement, nextMapFeatureKeys,
} from "@/ui/screens/draftStoreModel";
import { FREE_PICKS, PICK_CHOICES, SHOP_CHOICES, catalogueFileFor, getActiveRuleSet, preferredRuleSet, setActiveRuleSet, setPreferredRuleSet, storeKindAfter } from "@/lib/cardRules";
import { ARCHIVE, byLevel } from "./fixtures/maps";
import { contractFor, parseContracts, CONTRACT_MIN_LEVEL } from "@/lib/contracts";
import { inflationForLevel, mergePricing, resolveUpgradeCost } from "@/lib/upgradePricing";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { rollShelf, payoffWeight, paysOffHeld, PAYOFF_WEIGHT } from "@/ui/screens/shopModel";
import { setRunSeedText } from "@/lib/runRng";

const CARDS = (yaml.load(readFileSync(resolve(__dirname, "../../public/cards.yml"), "utf8")) as UpgradeData).upgrades;
const BY_ID = new Map(CARDS.map(c => [c.id, c]));
const card = (id: string): UpgradeConfig => BY_ID.get(id)!;
const ability = { id: "ability:magnet", name: "Magnet", tier: "Junior", description: "", modifiers: {}, grantsAbility: "magnet" } as UpgradeConfig;

describe("the pick and the shop", () => {
  const shelf = [card("fast_compile"), card("slow_motion"), card("cold_boot")];

  it("opens the pick after an ordinary map and the shop after a boss", () => {
    // Slay the Spire's shape: a card reward after every fight, and the gold
    // spent at a shop. Here the pick is one of three, free, and the hours
    // wait for the shop after the boss.
    expect(storeKindAfter(byLevel(ARCHIVE, 3))).toBe("pick");
    expect(storeKindAfter(byLevel(ARCHIVE, 10))).toBe("shop");
    expect(storeKindAfter(byLevel(ARCHIVE, 20))).toBe("shop");
    expect(storeKindAfter(null)).toBe("pick");
    expect(PICK_CHOICES).toBe(3);
    expect(SHOP_CHOICES).toBeGreaterThan(PICK_CHOICES);
  });

  it("deals one card free at every open store, and prices the rest", () => {
    expect(FREE_PICKS).toBe(1);
    expect(freePickIdsOf([], shelf)).toEqual([]);
    // Nothing picked yet: every card on the shelf is the free one.
    expect(draftPriceOf(shelf[0], [], FREE_PICKS, 34)).toBe(0);
    const one = freePickIdsOf(["slow_motion", "fast_compile"], shelf);
    expect(one).toEqual(["slow_motion"]);
    expect(draftPriceOf(shelf[1], one, FREE_PICKS, 34)).toBe(0);
    // At a shop the second card is bought; at a pick there is no second card.
    expect(draftPriceOf(shelf[0], one, FREE_PICKS, 34)).toBe(34);
  });

  it("prices a common card at an ordinary map's pay, so a normal run affords one a map", () => {
    // upgradePricing.ts measured an ordinary clear at 16h, a good one at 34h
    // and a flawless one at 47h through calculateScore. A common at the
    // ordinary figure is one card a map; a good map buys two, a flawless one
    // three. That is where "more cards" comes from: the board, not the shelf.
    const pricing = mergePricing((yaml.load(readFileSync(resolve(__dirname, "../../public/cards.yml"), "utf8")) as UpgradeData).pricing);
    const common = resolveUpgradeCost(card("fast_compile"), pricing);
    expect(common).toBeGreaterThanOrEqual(14);
    expect(common).toBeLessThanOrEqual(18);
    expect(Math.floor(34 / common)).toBe(2);
    expect(Math.floor(47 / common)).toBeGreaterThanOrEqual(2);
  });

  it("keeps a common card under a good map's pay to the end of the ladder", () => {
    // The scoring axes are absolute, so an ordinary map pays about the same
    // at map 30 as at map 3; the classic 1.15 per five maps tripled a common
    // against that flat pay (the pay sweep in CARDS_PLAN.md phase 7: 0 of 14
    // wins afforded one at map 29). The draft's own inflation is softer, so
    // one card an ordinary map holds for the whole run and a good map still
    // buys two at map 40.
    const pricing = mergePricing((yaml.load(readFileSync(resolve(__dirname, "../../public/cards.yml"), "utf8")) as UpgradeData).pricing);
    const common = resolveUpgradeCost(card("fast_compile"), pricing);
    const late = Math.round(common * inflationForLevel(40, pricing));
    expect(late).toBeGreaterThan(common);
    expect(late).toBeLessThanOrEqual(34);
    expect(Math.floor(47 / late)).toBeGreaterThanOrEqual(1);
  });

  it("says what the visit deals, in the bar's first line", () => {
    expect(draftBarLine("pick", false, false)).toBe("cardDraft.pick");
    expect(draftBarLine("pick", true, false)).toBe("cardDraft.pickTaken");
    expect(draftBarLine("shop", false, false)).toBe("cardDraft.shop");
    expect(draftBarLine("shop", true, false)).toBe("cardDraft.shopTaken");
    // A won contract's rarer shelf is said until the card is taken.
    expect(draftBarLine("pick", false, true)).toBe("cardDraft.contractFree");
    expect(draftBarLine("pick", true, true)).toBe("cardDraft.pickTaken");
  });

  it("never deals an ability free", () => {
    expect(freePickIdsOf(["ability:magnet", "cold_boot"], shelf)).toEqual(["cold_boot"]);
    expect(draftPriceOf(ability, [], FREE_PICKS, 20)).toBe(20);
  });

  it("keeps the pick to one card and the shop's reroll off the pick", () => {
    // The shop component: a pick's tap replaces the card picked before it,
    // and the reroll is the shop's alone. Pinned on the source, as the
    // store board tests are, because the component is Pixi.
    const shop = readFileSync(resolve(__dirname, "../ui/screens/UpgradeShop.tsx"), "utf8");
    expect(shop).toContain('const picking = draft?.kind === "pick";');
    expect(shop).toContain("selectedIds: picking && !alreadySelected ? [] : selectedIds");
    expect(shop).toContain("const canReroll = !!draft && !picking && !closed");
    expect(shop).toContain("shopSlots = picking ? PICK_CHOICES : (draft ? SHOP_CHOICES : 3) + extraShopItems");
    expect(shop).toContain("picking ? 0 : abilityOfferCount");
    expect(shop).toContain("reroll={picking ? null : {");
  });
});

describe("contracts", () => {
  const contracts = parseContracts((yaml.load(readFileSync(resolve(__dirname, "../../public/cards.yml"), "utf8")) as UpgradeData).contracts);
  const plain = { id: "m", name: "m" } as LevelConfig;

  it("are read from the catalogue, each one hard rule the engine knows", () => {
    expect(contracts.length).toBeGreaterThanOrEqual(3);
    for (const c of contracts) {
      for (const key of Object.keys(c.modifiers)) {
        expect(key in DEFAULT_MODIFIERS, `${c.id}: ${key}`).toBe(true);
      }
      expect(c.description).not.toContain("\u2014");
    }
    expect(parseContracts([{ id: "x" }, null, "y"])).toEqual([]);
  });

  it("are offered in turn, never early, never on a boss or after the last map", () => {
    expect(contractFor(plain, CONTRACT_MIN_LEVEL - 1, contracts)).toBeNull();
    expect(contractFor(null, 12, contracts)).toBeNull();
    expect(contractFor(byLevel(ARCHIVE, 20) as LevelConfig, 20, contracts)).toBeNull();
    const seen = new Set([5, 6, 7, 8, 9].map(n => contractFor(plain, n, contracts)!.id));
    expect(seen.size).toBe(contracts.length);
  });

  it("make the map harder, for that map only, and pay out at the next store", () => {
    const session = readFileSync(resolve(__dirname, "../hooks/useGameSession.ts"), "utf8");
    expect(session).toMatch(/const contract = activeContractId \? contracts\.find\(c => c\.id === activeContractId\) : undefined;/);
    expect(session).toMatch(/if \(activeContractId\) \{\s*setContractReward\(true\);\s*setActiveContractId\(null\);/);
    expect(session).toMatch(/contractId: activeContractId,\s*contractReward,/);
  });

  it("deal the payout from the uncommon and rare cards", () => {
    const withPrereqs = CARDS.map(c => (c.upgradeOf ? { ...c, prerequisites: [c.upgradeOf] } : c));
    const shelf = rollShelf({
      upgrades: withPrereqs, ownedUpgradeIds: [], completedLevel: 12, heldFenceTypeIds: [], shopSlots: 3, noTeaser: true, rareOnly: true,
    });
    expect(shelf).toHaveLength(3);
    expect(shelf.every(c => c.tier !== "Junior")).toBe(true);
    // Too few rarer cards to fill the shelf (level 1): the ordinary shelf, never a short one.
    const early = rollShelf({
      upgrades: withPrereqs, ownedUpgradeIds: [], completedLevel: 1, heldFenceTypeIds: [], shopSlots: 3, noTeaser: true, rareOnly: true,
    });
    expect(early).toHaveLength(3);
  });
});

describe("the build's slots", () => {
  const owned = ["fast_compile", "fast_compile_plus", "slow_motion"];
  const shelf = [card("cold_boot"), card("slow_motion_plus"), card("hot_start")];

  it("counts slot cards held and picked, never a +", () => {
    expect(draftBuild(owned, BY_ID, [], shelf, {}).count).toBe(2);
    expect(draftBuild(owned, BY_ID, ["slow_motion_plus"], shelf, {}).count).toBe(2);
    expect(draftBuild(owned, BY_ID, ["cold_boot"], shelf, {}).count).toBe(3);
  });

  it("asks for a card to give up only when a slot card would not fit", () => {
    const full = draftBuild(owned, BY_ID, [], shelf, {});
    expect(needsReplacement(card("cold_boot"), full, 2)).toBe(true);
    expect(needsReplacement(card("cold_boot"), full, 3)).toBe(false);
    // A + rides on its card, an ability has its own slots.
    expect(needsReplacement(card("slow_motion_plus"), full, 2)).toBe(false);
    expect(needsReplacement(ability, full, 2)).toBe(false);
  });

  it("gives the card back when the pick it made room for is undone", () => {
    const drops = { cold_boot: "slow_motion" };
    const replaced = draftBuild(owned, BY_ID, ["cold_boot"], shelf, drops);
    expect(replaced.dropped).toEqual(["slow_motion"]);
    expect(replaced.held.map(c => c.id)).toEqual(["fast_compile"]);
    expect(replaced.count).toBe(2);
    const undone = draftBuild(owned, BY_ID, [], shelf, drops);
    expect(undone.dropped).toEqual([]);
    expect(undone.held.map(c => c.id)).toEqual(["fast_compile", "slow_motion"]);
  });
});

describe("the shelf points at payoffs", () => {
  const withPrereqs = CARDS.map(c => (c.upgradeOf ? { ...c, prerequisites: [c.upgradeOf] } : c));
  const shelfWith = (owned: string[], key: string) => rollShelf({
    upgrades: withPrereqs, ownedUpgradeIds: owned, completedLevel: 12, heldFenceTypeIds: [], shopSlots: 3, noTeaser: true, rollKey: key,
  });

  it("weighs a payoff card up once the build holds what it pays off", () => {
    expect(paysOffHeld(card("afterburner"), [])).toEqual([]);
    expect(paysOffHeld(card("afterburner"), ["incident_flare"])).toEqual(["incident_flare"]);
    expect(payoffWeight(card("afterburner"), [])).toBe(1);
    expect(payoffWeight(card("afterburner"), ["incident_flare"])).toBe(PAYOFF_WEIGHT);
    // A card that is nobody's payoff is never leaned on.
    expect(payoffWeight(card("fast_compile"), ["incident_flare", "feature_freeze"])).toBe(1);
  });

  it("deals the payoff more often to the build that set it up", () => {
    setRunSeedText("payoff-lean");
    let withFlare = 0, without = 0;
    for (let i = 0; i < 120; i++) {
      if (shelfWith(["incident_flare"], `k${i}`).some(c => c.id === "afterburner")) withFlare++;
      if (shelfWith([], `k${i}`).some(c => c.id === "afterburner")) without++;
    }
    setRunSeedText(null);
    expect(withFlare).toBeGreaterThan(without);
  });
});

describe("the next map's line", () => {
  it("names what a card can care about on a boss map", () => {
    const boss = byLevel(ARCHIVE, 20) as LevelConfig;
    expect(nextMapFeatureKeys(boss)).toContain("boss");
  });

  it("is empty on a plain map", () => {
    expect(nextMapFeatureKeys({ id: "x", name: "x" } as LevelConfig)).toEqual([]);
  });
});

describe("the rule set", () => {
  it("picks the catalogue file", () => {
    expect(catalogueFileFor("draft")).toBe("/cards.yml");
    expect(catalogueFileFor("classic")).toBe("/upgrades.yml");
  });

  it("is the draft for a new run unless Admin asked for the classic store", () => {
    setPreferredRuleSet("draft");
    expect(preferredRuleSet()).toBe("draft");
    setPreferredRuleSet("classic");
    expect(preferredRuleSet()).toBe("classic");
    setPreferredRuleSet("draft");
  });

  it("is saved with the run, so a resumed run reads its own catalogue", () => {
    const session = readFileSync(resolve(__dirname, "../hooks/useGameSession.ts"), "utf8");
    expect(session).toMatch(/ruleSet: getActiveRuleSet\(\),/);
    expect(session).toMatch(/setActiveRuleSet\(save\.ruleSet \?\? 'classic'\)/);
    // A pair and the Daily play the draft on every phone, never the Admin
    // preference, so everyone in one run reads one catalogue.
    expect(session).toMatch(/setActiveRuleSet\(pairRunRef\.current \? 'tree' : preferredRuleSet\(\)\)/);
    const daily = session.slice(session.indexOf("const handleStartDaily"));
    expect(daily.slice(0, 2000)).toMatch(/setActiveRuleSet\('tree'\)/);
    setActiveRuleSet("classic");
    expect(getActiveRuleSet()).toBe("classic");
  });
});
