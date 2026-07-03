import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { LoadoutConfig, LoadoutData } from "@/types/loadout";
import { drawOffers } from "@/lib/loadoutDraft";
import { unlockedForStart } from "@/lib/loadoutUnlock";
import {
  mergeBonuses,
  computeGameModifiers,
  MAX_MICRO_MANAGER_PER_LOCK,
  type GameModifiers,
} from "@/hooks/useActiveModifiers";
import type { UpgradeConfig as UpgradeConfigType } from "@/types/upgrade";

// Read the loadout catalogue straight from the YAML source of truth so this
// suite guards the data, not a hand-maintained copy (mirrors upgrades.test.ts).
const loadoutDoc = yaml.load(
  readFileSync(resolve(process.cwd(), "public/loadouts.yml"), "utf8"),
) as LoadoutData;
const loadouts = loadoutDoc.loadouts;

// The valid GameModifier keys are exactly the keys of a computed default set.
const VALID_MODIFIER_KEYS = new Set(Object.keys(computeGameModifiers([], new Map())));

describe("run-start loadout draft", () => {
  it("has exactly two loadouts available from scratch (no uniqueWinsRequired)", () => {
    const fromScratch = loadouts.filter(l => l.uniqueWinsRequired == null);
    expect(fromScratch).toHaveLength(2);
  });

  it("gates every other loadout behind a positive integer uniqueWinsRequired", () => {
    const gated = loadouts.filter(l => l.uniqueWinsRequired != null);
    expect(gated.length).toBeGreaterThan(0);
    for (const l of gated) {
      expect(Number.isInteger(l.uniqueWinsRequired)).toBe(true);
      expect(l.uniqueWinsRequired as number).toBeGreaterThan(0);
    }
  });

  it("every loadout's modifiers use known GameModifier keys", () => {
    for (const l of loadouts) {
      for (const key of Object.keys(l.modifiers)) {
        expect(VALID_MODIFIER_KEYS.has(key), `${l.id}: ${key}`).toBe(true);
      }
    }
  });

  it("unlockedForStart returns only the two starters at zero unique wins", () => {
    const available = unlockedForStart(loadouts, 0);
    expect(available).toHaveLength(2);
    expect(available.every(l => l.uniqueWinsRequired == null)).toBe(true);
  });

  it("unlocks one more loadout per unique win (1 -> +death_march, 2 -> +hiring_freeze)", () => {
    const atOne = unlockedForStart(loadouts, 1).map(l => l.id);
    expect(atOne).toContain("death_march");
    expect(atOne).not.toContain("hiring_freeze");

    const atTwo = unlockedForStart(loadouts, 2).map(l => l.id);
    expect(atTwo).toContain("hiring_freeze");
  });

  it("drawOffers returns the requested count of distinct loadouts", () => {
    const offers = drawOffers(loadouts, [], 3);
    expect(offers).toHaveLength(3);
    expect(new Set(offers.map(o => o.id)).size).toBe(3);
  });

  it("drawOffers is capped by the pool size (two available -> two cards)", () => {
    const twoAvailable = unlockedForStart(loadouts, 0);
    const offers = drawOffers(twoAvailable, [], 3);
    expect(offers).toHaveLength(2);
  });

  it("drawOffers excludes already-drafted ids", () => {
    const first = loadouts[0].id;
    const offers = drawOffers(loadouts, [first], loadouts.length - 1);
    expect(offers.some((o: LoadoutConfig) => o.id === first)).toBe(false);
  });
});

describe("extraContinues modifier", () => {
  it("sums across sources via mergeBonuses", () => {
    const merged = mergeBonuses({ extraContinues: 1 }, { extraContinues: 1 });
    expect(merged?.extraContinues).toBe(2);
  });

  it("aggregates into computed GameModifiers (default 0, additive)", () => {
    const base = computeGameModifiers([], new Map());
    expect(base.extraContinues).toBe(0);

    const withBonus = computeGameModifiers([], new Map(), { extraContinues: 2 });
    expect(withBonus.extraContinues).toBe(2);
  });

  it("is an additive (not multiplicative) key", () => {
    // Two sources of +1 must give 2 (sum), not 1 (product of ones).
    const result: Partial<Record<keyof GameModifiers, number>> | undefined =
      mergeBonuses({ extraContinues: 1 }, { extraContinues: 1 });
    expect(result?.extraContinues).toBe(2);
  });
});

describe("microManagerPerLock 1% cap", () => {
  it("clamps the aggregated per-lock reduction to at most 1% (issue #42 follow-up)", () => {
    // Upgrade (0.01) + certificate (0.01) + loadout (0.01) would sum to 0.03,
    // but a locked ball must never slow the others by more than 1%.
    const upgrade: UpgradeConfigType = {
      id: "micro_manager_principal", name: "MicroManager", tier: "Principal",
      description: "", modifiers: { microManagerPerLock: 0.01 },
    };
    const lookup = new Map([[upgrade.id, upgrade]]);
    const mods = computeGameModifiers([upgrade.id], lookup, { microManagerPerLock: 0.02 });
    expect(mods.microManagerPerLock).toBe(MAX_MICRO_MANAGER_PER_LOCK);
    expect(mods.microManagerPerLock).toBe(0.01);
  });

  it("leaves a sub-cap value untouched", () => {
    const mods = computeGameModifiers([], new Map(), { microManagerPerLock: 0.005 });
    expect(mods.microManagerPerLock).toBe(0.005);
  });
});
