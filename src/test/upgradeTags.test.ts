import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";
import {
  ownedTagCounts,
  tagWeight,
  unlockRecencyWeight,
  computeActiveTagSets,
  DEFAULT_TAG_SET_THRESHOLD,
} from "@/lib/upgradeTags";

const mk = (id: string, tags: string[]): UpgradeConfig =>
  ({ id, name: id, tier: "Junior", description: id, tags, modifiers: {} }) as UpgradeConfig;

const CATALOGUE: UpgradeConfig[] = [
  mk("l1", ["lock"]),
  mk("l2", ["lock"]),
  mk("l3", ["lock", "freeze"]),
  mk("f1", ["freeze"]),
  mk("b1", ["bank"]),
];

const TAG_SETS = {
  threshold: 3,
  bonuses: [
    { tag: "lock" as const, name: "Lock Set", description: "d", modifiers: { simultaneousLockBonus: 1 } },
    { tag: "freeze" as const, name: "Freeze Set", description: "d", modifiers: { freezeNoCooldown: 1 } },
  ],
};

describe("ownedTagCounts", () => {
  it("tallies tags across owned upgrades, counting multi-tag upgrades once per tag", () => {
    const counts = ownedTagCounts(["l1", "l3", "f1"], CATALOGUE);
    expect(counts.get("lock")).toBe(2);
    expect(counts.get("freeze")).toBe(2);
    expect(counts.get("bank")).toBeUndefined();
  });

  it("ignores unknown ids", () => {
    const counts = ownedTagCounts(["nope", "l1"], CATALOGUE);
    expect(counts.get("lock")).toBe(1);
  });
});

describe("tagWeight", () => {
  it("is 1 with nothing owned (uniform shuffle baseline)", () => {
    expect(tagWeight(CATALOGUE[0], new Map())).toBe(1);
  });

  it("adds the owned count of every tag the candidate carries", () => {
    const counts = ownedTagCounts(["l1", "l2", "f1"], CATALOGUE);
    // l3 carries lock (2 owned) + freeze (1 owned) -> 1 + 2 + 1
    expect(tagWeight(CATALOGUE[2], counts)).toBe(4);
  });
});

describe("computeActiveTagSets", () => {
  it("activates a set only at the threshold", () => {
    expect(computeActiveTagSets(["l1", "l2"], CATALOGUE, TAG_SETS)).toEqual([]);
    const active = computeActiveTagSets(["l1", "l2", "l3"], CATALOGUE, TAG_SETS);
    expect(active.map(s => s.tag)).toEqual(["lock"]);
  });

  it("can activate multiple sets at once", () => {
    const active = computeActiveTagSets(["l1", "l2", "l3", "f1", "f1"], CATALOGUE, TAG_SETS);
    // f1 duplicated in owned list still counts twice: owned ids are a list of
    // purchases and the shop never sells duplicates, but the util must not crash.
    expect(active.map(s => s.tag)).toContain("lock");
  });

  it("returns nothing without a tagSets config", () => {
    expect(computeActiveTagSets(["l1", "l2", "l3"], CATALOGUE, undefined)).toEqual([]);
  });

  it("falls back to the default threshold when the configured one is invalid", () => {
    const active = computeActiveTagSets(
      ["l1", "l2", "l3"],
      CATALOGUE,
      { ...TAG_SETS, threshold: 0 },
    );
    expect(DEFAULT_TAG_SET_THRESHOLD).toBe(3);
    expect(active.map(s => s.tag)).toEqual(["lock"]);
  });
});

describe("tagSets catalogue config", () => {
  const doc = yaml.load(
    readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
  ) as UpgradeData;

  it("defines one valid set bonus per archetype", () => {
    const VALID_TAGS = ["lock", "freeze", "bank", "tempo", "risk", "safety"];
    expect(doc.tagSets).toBeDefined();
    const tags = (doc.tagSets!.bonuses ?? []).map(b => b.tag).sort();
    expect(tags).toEqual([...VALID_TAGS].sort());
    for (const b of doc.tagSets!.bonuses) {
      expect(b.name).toBeTruthy();
      expect(b.description).toBeTruthy();
      expect(Object.keys(b.modifiers).length).toBeGreaterThan(0);
    }
  });

  it("keeps every set reachable: at least `threshold` upgrades carry each tag", () => {
    const threshold = doc.tagSets!.threshold;
    const counts = new Map<string, number>();
    for (const u of doc.upgrades) {
      if (u.ascensionOnly) continue; // not purchasable in a normal run
      for (const tag of u.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    for (const b of doc.tagSets!.bonuses) {
      expect(counts.get(b.tag) ?? 0, `tag "${b.tag}" needs >= ${threshold} purchasable upgrades`).toBeGreaterThanOrEqual(threshold);
    }
  });
});

describe("unlockRecencyWeight", () => {
  const at = (unlockLevel: number): UpgradeConfig =>
    ({ ...mk("u", ["lock"]), unlockLevel }) as UpgradeConfig;

  it("gives full weight to recently unlocked upgrades", () => {
    expect(unlockRecencyWeight(at(10), 10)).toBe(1);
    expect(unlockRecencyWeight(at(10), 14)).toBe(1);
    // Not-yet-relevant future unlocks are never boosted above 1.
    expect(unlockRecencyWeight(at(12), 10)).toBe(1);
  });

  it("decays with age down to the floor", () => {
    expect(unlockRecencyWeight(at(2), 8)).toBeCloseTo(0.7);   // age 6
    expect(unlockRecencyWeight(at(2), 10)).toBeCloseTo(0.4);  // age 8
    expect(unlockRecencyWeight(at(2), 14)).toBe(0.25);        // floored
    expect(unlockRecencyWeight(at(2), 40)).toBe(0.25);
  });
});
