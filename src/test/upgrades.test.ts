import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeData } from "@/types/upgrade";

// Read the upgrade catalogue straight from the YAML source of truth so this
// suite guards the data, not a hand-maintained copy.
const upgrades = (
  yaml.load(readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8")) as UpgradeData
).upgrades;

const byId = new Map(upgrades.map(u => [u.id, u] as const));
const prereqsOf = (id: string): string[] => byId.get(id)?.prerequisites ?? [];

// The intended track heads — the only non-ascension upgrades with no prereqs.
const EXPECTED_ROOTS = [
  "runtime_optimisation_junior",
  "memory_footprint_junior",
  "fast_compile_junior",
  "performance_bonus_junior",
  "system_architect",
  "scrum_master_1",
  "defensive_programming_junior",
].sort();

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
