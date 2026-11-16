/**
 * The draft store's rules (CARDS_PLAN.md): one free card a visit, a build of
 * a fixed number of slots, and a card given up to make room for another.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";
import type { LevelConfig } from "@/types/level";
import {
  draftBuild, draftPriceOf, freePickIdsOf, needsReplacement, nextMapFeatureKeys,
} from "@/ui/screens/draftStoreModel";
import { catalogueFileFor, getActiveRuleSet, preferredRuleSet, setActiveRuleSet, setPreferredRuleSet } from "@/lib/cardRules";
import { LADDER, byLevel } from "./fixtures/maps";
import { contractFor, parseContracts, CONTRACT_MIN_LEVEL } from "@/lib/contracts";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { rollShelf } from "@/ui/screens/shopModel";

const CARDS = (yaml.load(readFileSync(resolve(__dirname, "../../public/cards.yml"), "utf8")) as UpgradeData).upgrades;
const BY_ID = new Map(CARDS.map(c => [c.id, c]));
const card = (id: string): UpgradeConfig => BY_ID.get(id)!;
const ability = { id: "ability:magnet", name: "Magnet", tier: "Junior", description: "", modifiers: {}, grantsAbility: "magnet" } as UpgradeConfig;

describe("the free card", () => {
  const shelf = [card("fast_compile"), card("slow_motion"), card("cold_boot")];

  it("is every card until one is picked, then only that one", () => {
    expect(freePickIdsOf([], shelf)).toEqual([]);
    expect(draftPriceOf(shelf[0], [], 1, 34)).toBe(0);
    expect(draftPriceOf(shelf[1], [], 1, 34)).toBe(0);
    const free = freePickIdsOf(["slow_motion", "fast_compile"], shelf);
    expect(free).toEqual(["slow_motion"]);
    expect(draftPriceOf(shelf[1], free, 1, 34)).toBe(0);
    expect(draftPriceOf(shelf[0], free, 1, 34)).toBe(34);
  });

  it("is never an ability, picked first or not", () => {
    expect(freePickIdsOf(["ability:magnet"], shelf)).toEqual([]);
    expect(draftPriceOf(ability, [], 1, 20)).toBe(20);
    expect(freePickIdsOf(["ability:magnet", "cold_boot"], shelf)).toEqual(["cold_boot"]);
  });

  it("is two cards at the store after a won contract", () => {
    const one = freePickIdsOf(["slow_motion"], shelf, 2);
    // One taken, one still to take: every other card is still free.
    expect(draftPriceOf(shelf[0], one, 2, 34)).toBe(0);
    const two = freePickIdsOf(["slow_motion", "fast_compile", "cold_boot"], shelf, 2);
    expect(two).toEqual(["slow_motion", "fast_compile"]);
    expect(draftPriceOf(shelf[2], two, 2, 34)).toBe(34);
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
    expect(contractFor(byLevel(LADDER, 20) as LevelConfig, 20, contracts)).toBeNull();
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

describe("the next map's line", () => {
  it("names what a card can care about on a boss map", () => {
    const boss = byLevel(LADDER, 20) as LevelConfig;
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
    // A pair and the Daily stay on the classic store.
    expect(session).toMatch(/setActiveRuleSet\(pairRunRef\.current \? 'classic' : preferredRuleSet\(\)\)/);
    setActiveRuleSet("classic");
    expect(getActiveRuleSet()).toBe("classic");
  });
});
