import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { MutatorConfig, MutatorData } from "@/types/mutator";
import { drawOffers, eligibleForStart } from "@/lib/mutatorDraft";
import {
  mergeBonuses,
  computeGameModifiers,
  type GameModifiers,
} from "@/hooks/useActiveModifiers";

// Read the mutator catalogue straight from the YAML source of truth so this
// suite guards the data, not a hand-maintained copy (mirrors upgrades.test.ts).
const mutatorDoc = yaml.load(
  readFileSync(resolve(process.cwd(), "public/mutators.yml"), "utf8"),
) as MutatorData;
const mutators = mutatorDoc.mutators;

describe("run-start loadout draft", () => {
  it("keeps at least 3 mutators eligible so the draft can fill its slots", () => {
    const eligible = eligibleForStart(mutators);
    expect(eligible.length).toBeGreaterThanOrEqual(3);
  });

  it("eligibleForStart only drops mutators explicitly flagged startEligible: false", () => {
    const excluded = mutators.filter(m => !eligibleForStart(mutators).includes(m));
    expect(excluded.every(m => m.startEligible === false)).toBe(true);
  });

  it("drawOffers returns the requested count of distinct, eligible mutators", () => {
    const eligible = eligibleForStart(mutators);
    const offers = drawOffers(eligible, [], 3);
    expect(offers).toHaveLength(3);
    // distinct
    expect(new Set(offers.map(o => o.id)).size).toBe(3);
    // all drawn from the eligible pool (none opted out)
    expect(offers.every((o: MutatorConfig) => o.startEligible !== false)).toBe(true);
  });

  it("drawOffers excludes already-drafted ids", () => {
    const eligible = eligibleForStart(mutators);
    const first = eligible[0].id;
    const offers = drawOffers(eligible, [first], eligible.length - 1);
    expect(offers.some(o => o.id === first)).toBe(false);
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
