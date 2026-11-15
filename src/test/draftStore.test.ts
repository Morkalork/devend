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
  draftBuild, draftPriceOf, freePickIdOf, needsReplacement, nextMapFeatureKeys,
} from "@/ui/screens/draftStoreModel";
import { catalogueFileFor, getActiveRuleSet, preferredRuleSet, setActiveRuleSet, setPreferredRuleSet } from "@/lib/cardRules";
import { LADDER, byLevel } from "./fixtures/maps";

const CARDS = (yaml.load(readFileSync(resolve(__dirname, "../../public/cards.yml"), "utf8")) as UpgradeData).upgrades;
const BY_ID = new Map(CARDS.map(c => [c.id, c]));
const card = (id: string): UpgradeConfig => BY_ID.get(id)!;
const ability = { id: "ability:magnet", name: "Magnet", tier: "Junior", description: "", modifiers: {}, grantsAbility: "magnet" } as UpgradeConfig;

describe("the free card", () => {
  const shelf = [card("fast_compile"), card("slow_motion"), card("cold_boot")];

  it("is every card until one is picked, then only that one", () => {
    expect(freePickIdOf([], shelf)).toBeNull();
    expect(draftPriceOf(shelf[0], null, 34)).toBe(0);
    expect(draftPriceOf(shelf[1], null, 34)).toBe(0);
    const free = freePickIdOf(["slow_motion", "fast_compile"], shelf);
    expect(free).toBe("slow_motion");
    expect(draftPriceOf(shelf[1], free, 34)).toBe(0);
    expect(draftPriceOf(shelf[0], free, 34)).toBe(34);
  });

  it("is never an ability, picked first or not", () => {
    expect(freePickIdOf(["ability:magnet"], shelf)).toBeNull();
    expect(draftPriceOf(ability, null, 20)).toBe(20);
    expect(freePickIdOf(["ability:magnet", "cold_boot"], shelf)).toBe("cold_boot");
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
