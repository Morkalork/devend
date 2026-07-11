import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";
import type { LevelData } from "@/types/level";
import { buildLevelPoints, mergePricing, computeUpgradeCost } from "@/lib/upgradePricing";

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
    const OVERTIME_CAP_HEADROOM = 2.0; // mirrors scoring-config.yml
    const flatBase = [...levelPoints.values()][0];
    const perMapCap = flatBase * OVERTIME_CAP_HEADROOM;
    const aceFullRunIncome = levelPoints.size * perMapCap;
    const total = upgrades
      .filter(u => !u.ascensionOnly)
      .reduce((sum, u) => sum + (effectiveCost(u) ?? 0), 0);
    expect(total).toBeGreaterThan(aceFullRunIncome);
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
