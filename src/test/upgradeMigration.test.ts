/**
 * Merging two upgrades must not cost a player what they already bought.
 *
 * SCRUM Master carried its effect twice at the same tier: `_2` and `_3` were
 * both Senior granting one more tracked ball, `_4` and `_5` both Principal
 * granting one more traced bounce. Every other family puts one rung per tier,
 * so this was the only one charging twice for the same step, and at seven
 * upgrades it was the second-largest family in the game - crowding the shop
 * shelf with repeats of a single utility, which is the opposite of what a
 * varied build needs.
 *
 * The merge is safe in the catalogue and dangerous in the SAVE. A run
 * checkpoint stores ownedUpgradeIds and the lifetime maxTierCounts gates
 * certificate unlocks, and both outlive the catalogue. A deleted id is not a
 * content edit: it strands whatever the player already had.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  UPGRADE_ALIASES, liveUpgradeId, liveUpgradeIds, migrateTierCounts,
} from "@/lib/upgradeMigration";

interface Upgrade {
  id: string; name: string; tier: string;
  prerequisites?: string[];
  modifiers?: Record<string, number>;
}
const UPGRADES = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
) as { upgrades: Upgrade[] }).upgrades;
const IDS = new Set(UPGRADES.map(u => u.id));

describe("a saved run that predates the merge", () => {
  it("keeps the upgrade under its new name", () => {
    expect(liveUpgradeId("scrum_master_3")).toBe("scrum_master_2");
    expect(liveUpgradeId("scrum_master_5")).toBe("scrum_master_4");
  });

  it("collapses a player who owned both halves into one", () => {
    // The owned list is a set in everything but type, and the tag-synergy
    // scaling pays PER owned upgrade. A duplicate would silently inflate every
    // conditional bonus in that build.
    const owned = ["fast_compile_junior", "scrum_master_2", "scrum_master_3"];
    expect(liveUpgradeIds(owned)).toEqual(["fast_compile_junior", "scrum_master_2"]);
  });

  it("leaves everything else exactly as it was, in order", () => {
    const owned = ["a", "b", "c"];
    expect(liveUpgradeIds(owned)).toEqual(owned);
  });

  it("passes through an id it has never heard of", () => {
    // Far more likely a newer save than a deleted upgrade. Dropping it would
    // turn a version mismatch into lost progress.
    expect(liveUpgradeId("something_from_a_later_build")).toBe("something_from_a_later_build");
  });

  it("sums lifetime tier counts rather than picking one", () => {
    // These mean "how many runs reached this upgrade's top tier", and a player
    // who reached both halves did the work twice. Certificates are gated on the
    // count, so taking the larger would walk back one they had earned.
    expect(migrateTierCounts({ scrum_master_2: 2, scrum_master_3: 3 }))
      .toEqual({ scrum_master_2: 5 });
  });
});

describe("the catalogue after the merge", () => {
  it("no longer contains the retired ids", () => {
    for (const dead of Object.keys(UPGRADE_ALIASES)) {
      expect(IDS.has(dead), `${dead} is still in the catalogue`).toBe(false);
    }
  });

  it("points every alias at an upgrade that exists", () => {
    // An alias to a missing id is worse than no alias: it converts a stranded
    // upgrade into a stranded upgrade that looks handled.
    for (const [dead, live] of Object.entries(UPGRADE_ALIASES)) {
      expect(IDS.has(live), `${dead} aliases to missing ${live}`).toBe(true);
    }
  });

  it("leaves no prerequisite pointing at a retired id", () => {
    // The merge broke three of these when it was first applied: scrum_master_4,
    // _6 and _6_b all required a rung that no longer existed, which would have
    // made the whole top of the family unbuyable.
    const dangling: string[] = [];
    for (const u of UPGRADES) {
      for (const p of u.prerequisites ?? []) {
        if (!IDS.has(p)) dangling.push(`${u.id} -> ${p}`);
      }
    }
    expect(dangling, "prerequisites pointing nowhere").toEqual([]);
  });

  it("keeps the merged pair's whole value on the survivor", () => {
    // The merge must be free. Two rungs of one each become one rung of two.
    const byId = new Map(UPGRADES.map(u => [u.id, u]));
    expect(byId.get("scrum_master_2")!.modifiers!.ballPathPredictionBalls).toBe(2);
    expect(byId.get("scrum_master_4")!.modifiers!.ballPathPredictionBounces).toBe(2);
  });

  it("stops charging twice for one step of a tier", () => {
    // The defect itself: no family may hold two rungs of the same tier granting
    // the identical modifier. That is a second price for one upgrade, and it is
    // what made SCRUM Master seven entries long.
    const seen = new Map<string, string[]>();
    for (const u of UPGRADES) {
      const key = `${u.name}|${u.tier}|${JSON.stringify(u.modifiers ?? {})}`;
      seen.set(key, [...(seen.get(key) ?? []), u.id]);
    }
    const doubled = [...seen.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => `${key.split("|")[0]} ${key.split("|")[1]}: ${ids.join(", ")}`);
    expect(doubled, "a tier charging twice for the same effect").toEqual([]);
  });
});

describe("Defensive Programming means one thing", () => {
  const family = UPGRADES.filter(u => u.name === "Defensive Programming");

  it("has stopped being a second Memory Footprint on its LADDER", () => {
    // Its Junior, Senior AND Principal were all ballSizeMultiplier 0.92 - the
    // same number three times - and shrinking balls is Memory Footprint's whole
    // identity. Eight upgrades expressing two effects, one of them borrowed.
    //
    // Scoped to the ladder on purpose. The Architect fork still shrinks, and
    // must: see below.
    const ladder = family.filter(u => ["Junior", "Senior", "Principal"].includes(u.tier));
    const shrinkers = ladder.filter(u => u.modifiers?.ballSizeMultiplier !== undefined);
    expect(shrinkers.map(u => u.id), "the ladder still shrinks balls").toEqual([]);
  });

  it("still forks into survival OR evasion at Architect", () => {
    // Caught by upgrades.test.ts when the reshape first went too far and made
    // both halves shields. That fork is the family's one real decision - absorb
    // the hit, or be too small to take it - and turning it into shields-vs-
    // shields recreated the exact duplication the reshape was removing, at the
    // tier where it matters most.
    const bunker = family.find(u => u.id.endsWith("architect_a"))!;
    const nanobots = family.find(u => u.id.endsWith("architect_b"))!;
    expect(bunker.modifiers?.wallShieldsPerMap ?? 0).toBeGreaterThan(0);
    expect(bunker.modifiers?.ballSizeMultiplier ?? 1).toBe(1);
    expect(nanobots.modifiers?.ballSizeMultiplier ?? 1).toBeLessThan(1);
    expect(nanobots.modifiers?.wallShieldsPerMap ?? 0).toBe(0);
  });

  it("protects fences at every tier a normal run can reach", () => {
    // The trap this walked into once: fenceDurabilityBonus only applies when
    // ascension makes fences wear out, so building the ladder on it would have
    // made Junior and Senior do NOTHING in an ordinary run. wallShields is the
    // expression that works before ascension.
    for (const tier of ["Junior", "Senior", "Principal"]) {
      const rung = family.find(u => u.tier === tier && !u.id.includes("ascension"));
      expect(rung, `no ${tier} rung`).toBeTruthy();
      expect(rung!.modifiers?.wallShieldsPerMap, `${rung!.id} does nothing before ascension`)
        .toBeGreaterThan(0);
    }
  });

  it("keeps durability as its ascension form, which is where fences wear out", () => {
    // Not a leftover: ascension is the mode that makes fences crumble, so
    // durability is the same idea expressed where it can apply.
    const asc = family.filter(u => u.id.includes("ascension"));
    expect(asc.length).toBeGreaterThan(0);
    for (const u of asc) expect(u.modifiers?.fenceDurabilityBonus).toBeGreaterThan(0);
  });
});
