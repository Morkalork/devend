import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";
import type { LevelData } from "@/types/level";
import { buildLevelPoints, mergePricing, computeUpgradeCost, inflationForLevel } from "@/lib/upgradePricing";

// Read the upgrade catalogue straight from the YAML source of truth so this
// suite guards the data, not a hand-maintained copy.
const upgradeDoc = yaml.load(
  readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
) as UpgradeData;
const upgrades = upgradeDoc.upgrades;

// Pricing is derived from level points + tier factors (see upgradePricing.ts),
// so recompute effective costs the same way the loader does to guard them.
const pricing = mergePricing(upgradeDoc.pricing);
const levelPoints = buildLevelPoints(
  (yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData).levels,
);
const effectiveCost = (u: UpgradeConfig): number | null =>
  typeof u.cost === "number"
    ? u.cost
    : computeUpgradeCost(u.unlockLevel ?? 1, u.tier, levelPoints, pricing);

const byId = new Map(upgrades.map(u => [u.id, u] as const));
const prereqsOf = (id: string): string[] => byId.get(id)?.prerequisites ?? [];

// The intended track heads — the only non-ascension upgrades with no prereqs.
// One head per archetype line: the synergy rework promoted Fault Tolerance,
// Technical Debt, Feature Freeze and Severance Package to roots (their old
// cross-family prereqs were whimsical, not tactical).
const EXPECTED_ROOTS = [
  "runtime_optimisation_junior",
  "memory_footprint_junior",
  "fast_compile_junior",
  "performance_bonus_junior",
  "system_architect",
  "scrum_master_1",
  "defensive_programming_junior",
  "fault_tolerance_junior",
  "technical_debt_senior",
  "feature_freeze_junior",
  "severance_package_junior",
  "deadline_extension_junior",
  "code_review",
  "cold_boot",
  "moonshot",
  "benefits_package_junior",
  "golden_parachute",
].sort();

// Build archetypes — must mirror UpgradeTag in src/types/upgrade.ts.
const VALID_TAGS = ["lock", "freeze", "bank", "tempo", "risk", "safety"];

describe("upgrade catalogue integrity", () => {
  it("has unique ids", () => {
    const ids = upgrades.map(u => u.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it("references only prerequisites that exist", () => {
    const missing: string[] = [];
    for (const u of upgrades)
      for (const p of u.prerequisites ?? []) if (!byId.has(p)) missing.push(`${u.id} -> ${p}`);
    expect(missing).toEqual([]);
  });

  it("never prints an unlock level below a prerequisite's (the real gate)", () => {
    // A printed unlockLevel lower than a prereq's lies to the player: the shop
    // can't offer the upgrade until the prereq itself is unlockable.
    const offenders: string[] = [];
    for (const u of upgrades) {
      for (const p of u.prerequisites ?? []) {
        const prereq = byId.get(p);
        if (prereq && (u.unlockLevel ?? 1) < (prereq.unlockLevel ?? 1)) {
          offenders.push(`${u.id} (L${u.unlockLevel ?? 1}) -> ${p} (L${prereq.unlockLevel ?? 1})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("tags every upgrade with 1-2 valid archetypes", () => {
    const offenders = upgrades
      .filter(u => {
        const tags = u.tags ?? [];
        return tags.length < 1 || tags.length > 2 || tags.some(t => !VALID_TAGS.includes(t));
      })
      .map(u => u.id);
    expect(offenders).toEqual([]);
  });

  it("has an acyclic prerequisite graph", () => {
    const WHITE = 0, GREY = 1, BLACK = 2;
    const colour = new Map<string, number>();
    let cycle: string | null = null;
    const visit = (id: string, stack: string[]): void => {
      colour.set(id, GREY);
      for (const p of prereqsOf(id)) {
        const c = colour.get(p) ?? WHITE;
        if (c === GREY) { cycle = [...stack, id, p].join(" -> "); return; }
        if (c === WHITE) { visit(p, [...stack, id]); if (cycle) return; }
      }
      colour.set(id, BLACK);
    };
    for (const u of upgrades) {
      if ((colour.get(u.id) ?? WHITE) === WHITE) visit(u.id, []);
      if (cycle) break;
    }
    expect(cycle).toBeNull();
  });
});

describe("track structure", () => {
  it("has exactly the intended non-ascension roots", () => {
    const roots = upgrades
      .filter(u => !u.ascensionOnly && (u.prerequisites?.length ?? 0) === 0)
      .map(u => u.id)
      .sort();
    expect(roots).toEqual(EXPECTED_ROOTS);
  });

  it("offers at least 3 upgrades at the first shop (level 1)", () => {
    const firstShop = upgrades.filter(
      u => (u.prerequisites?.length ?? 0) === 0 && (u.unlockLevel ?? 1) <= 1,
    );
    expect(firstShop.length).toBeGreaterThanOrEqual(3);
  });

  it("never gates a normal-run upgrade directly behind an ascension-only one", () => {
    const offenders: string[] = [];
    for (const u of upgrades) {
      if (u.ascensionOnly) continue;
      for (const p of u.prerequisites ?? [])
        if (byId.get(p)?.ascensionOnly) offenders.push(`${u.id} -> ${p}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no normal-run upgrade transitively depends on an ascension-only upgrade", () => {
    const ancestors = (id: string, acc = new Set<string>()): Set<string> => {
      for (const p of prereqsOf(id)) if (!acc.has(p)) { acc.add(p); ancestors(p, acc); }
      return acc;
    };
    const offenders = upgrades
      .filter(u => !u.ascensionOnly)
      .filter(u => [...ancestors(u.id)].some(a => byId.get(a)?.ascensionOnly))
      .map(u => u.id);
    expect(offenders).toEqual([]);
  });
});

describe("pricing", () => {
  it("prices every upgrade (explicit cost or resolvable formula)", () => {
    const unpriced = upgrades.filter(u => effectiveCost(u) === null).map(u => u.id);
    expect(unpriced).toEqual([]);
  });

  it("keeps the catalogue scarce: total cost exceeds a perfect run's income", () => {
    // Issue #43: per-map overtime is flat and hard-capped at basePoints ×
    // overtimeCapHeadroom (lock/push bonuses fold in under that cap). So the
    // most a flawless ace can earn is levels × cap. The catalogue must cost more
    // than that, so no one can ever buy it all. This auto-scales with the level
    // count and the flat base, so it never needs a manual bump.
    const OVERTIME_CAP_HEADROOM = 4.0; // mirrors scoring-config.yml
    const flatBase = [...levelPoints.values()][0];
    const perMapCap = flatBase * OVERTIME_CAP_HEADROOM;
    const aceFullRunIncome = levelPoints.size * perMapCap;
    const total = upgrades
      .filter(u => !u.ascensionOnly)
      .reduce((sum, u) => sum + (effectiveCost(u) ?? 0), 0);
    expect(total).toBeGreaterThan(aceFullRunIncome);
  });

  it("keeps Golden Parachute the single most expensive upgrade", () => {
    // Runs start with no free Continue; the buyable one must stay the priciest
    // offer in the catalogue (design decision, not formula-derived).
    const parachute = effectiveCost(byId.get("golden_parachute")!)!;
    const pricier = upgrades
      .filter(u => u.id !== "golden_parachute" && !u.ascensionOnly)
      .filter(u => (effectiveCost(u) ?? 0) >= parachute)
      .map(u => u.id);
    expect(pricier).toEqual([]);
  });

  it("is monotonic within each family: later tiers never cost less", () => {
    const families = new Map<string, UpgradeConfig[]>();
    for (const u of upgrades) {
      if (u.ascensionOnly) continue;
      if (!families.has(u.name)) families.set(u.name, []);
      families.get(u.name)!.push(u);
    }
    const offenders: string[] = [];
    for (const tiers of families.values()) {
      const sorted = [...tiers].sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1));
      for (let i = 1; i < sorted.length; i++) {
        if ((effectiveCost(sorted[i]) ?? 0) < (effectiveCost(sorted[i - 1]) ?? 0)) {
          offenders.push(`${sorted[i - 1].id} -> ${sorted[i].id}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("lock-centric economy", () => {
  // The economy's core rule: locking balls is the income. A clear that locks
  // nothing must not fund even the cheapest shop offer that round (unless the
  // player had hours saved), while lockValue makes locking close that gap.
  const scoringDoc = yaml.load(
    readFileSync(resolve(process.cwd(), "public/scoring-config.yml"), "utf8"),
  ) as { scoring: { lockValue: number; lockQuality: { superiorThresholdFraction: number; superiorMultiplier: number }; spaceOptimization: { maxBonus: number }; shipEarly: { maxBonus: number } } };
  const scoring = scoringDoc.scoring;

  it("a flawless no-lock clear cannot afford the cheapest upgrade", () => {
    const flatBase = [...levelPoints.values()][0];
    // Every non-lock hour a perfect clear can scrape together: flat base,
    // under-par (+1), the full space ladder, the full Ship Early ladder, and
    // a generous push-your-luck allowance (chunks pay ~1h each).
    const PUSH_ALLOWANCE = 4;
    const bestNoLockIncome =
      flatBase + 1 + scoring.spaceOptimization.maxBonus + scoring.shipEarly.maxBonus + PUSH_ALLOWANCE;
    const cheapest = Math.min(
      ...upgrades.filter(u => !u.ascensionOnly).map(u => effectiveCost(u) ?? Infinity),
    );
    expect(bestNoLockIncome).toBeLessThan(cheapest);
  });

  it("locking pays enough to matter: one plain lock covers most of the base", () => {
    const flatBase = [...levelPoints.values()][0];
    expect(scoring.lockValue).toBeGreaterThanOrEqual(flatBase / 2);
  });

  // The map-1 teaching beat: your first great play buys your first hire. A
  // sloppy (roomy-pocket) x1 lock plus the flat base must stay short of the
  // cheapest upgrade, while a SUPERIOR (tight-pocket) lock closes the gap.
  it("map 1: a sloppy lock cannot buy the cheapest upgrade, a superior lock can", () => {
    const flatBase = [...levelPoints.values()][0];
    const cheapest = Math.min(
      ...upgrades.filter(u => !u.ascensionOnly).map(u => effectiveCost(u) ?? Infinity),
    );
    const sloppyClear = flatBase + scoring.lockValue;
    const superiorClear = flatBase + Math.round(scoring.lockValue * scoring.lockQuality.superiorMultiplier);
    expect(sloppyClear).toBeLessThan(cheapest);
    expect(superiorClear).toBeGreaterThanOrEqual(cheapest);
  });

  it("superior-lock tuning is sane: a real bar and a real payoff", () => {
    expect(scoring.lockQuality.superiorThresholdFraction).toBeGreaterThan(0);
    expect(scoring.lockQuality.superiorThresholdFraction).toBeLessThan(1);
    expect(scoring.lockQuality.superiorMultiplier).toBeGreaterThanOrEqual(1.5);
  });
});

describe("market-rate inflation", () => {
  it("is configured in upgrades.yml and steps per 5-level assignment block", () => {
    expect(pricing.blockInflation).toBeGreaterThan(1);
    const rate = pricing.blockInflation!;
    expect(inflationForLevel(1, pricing)).toBe(1);
    expect(inflationForLevel(4, pricing)).toBe(1);
    expect(inflationForLevel(6, pricing)).toBeCloseTo(rate);
    expect(inflationForLevel(9, pricing)).toBeCloseTo(rate);
    expect(inflationForLevel(11, pricing)).toBeCloseTo(rate ** 2);
    expect(inflationForLevel(16, pricing)).toBeCloseTo(rate ** 3);
  });

  it("disables cleanly at rate 1 and guards garbage input", () => {
    const flat = { ...pricing, blockInflation: 1 };
    expect(inflationForLevel(23, flat)).toBe(1);
    expect(inflationForLevel(NaN, pricing)).toBe(1);
  });
});
