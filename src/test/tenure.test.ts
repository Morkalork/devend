/**
 * Tenure (issue #75), the checkpoint replacement.
 *
 * Two properties carry the whole feature and are easy to break later:
 *
 * 1. SELECTION IS BY TIER, not by graph position. Three upgrades have no
 *    prerequisites yet are not entry-level, the worst being `golden_parachute`
 *    (a 250h Wizard). A "roots of the prerequisite graph" rule reads perfectly
 *    and hands the most expensive upgrade in the game to a player who reached
 *    level 10.
 * 2. THE unlockLevel GATE APPLIES TO EVERY GRANTED UPGRADE, not just the one on
 *    the card. Reaching 20 grants a Senior too, so a chain whose Senior unlocks
 *    at 25 must not be offered at 20 even though its Junior qualifies.
 *
 * The rest pins the reward ladder and the "game picks the fork" rule. Tests run
 * against the REAL public/upgrades.yml, so a content edit that breaks the pools
 * fails here rather than in someone's run.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  TENURE_OFFER_COUNT, TENURE_PATH, TENURE_THRESHOLDS,
  eligibleTenureChains, tenureSteps, levelsToNextTenure, rollTenureOffers,
} from "@/lib/tenure";
import type { UpgradeConfig } from "@/types/upgrade";

const REAL_UPGRADES = (
  yaml.load(readFileSync(resolve(__dirname, "../../public/upgrades.yml"), "utf8")) as {
    upgrades: UpgradeConfig[];
  }
).upgrades;

/** Deterministic "rng": always takes the first candidate. */
const first = () => 0;
/** Deterministic "rng": always takes the last candidate. */
const last = () => 0.999999;

/**
 * `name` identifies the FAMILY (every tier of Fast Compile is named "Fast
 * Compile"), so it defaults to the id's prefix and can be overridden to build a
 * foreign-family branch off a shared prerequisite.
 */
const up = (
  id: string, tier: UpgradeConfig["tier"], unlockLevel: number,
  prerequisites: string[] = [], extra: Partial<UpgradeConfig> = {},
): UpgradeConfig => ({
  id, name: id.split("_")[0], tier, description: "", unlockLevel, prerequisites,
  modifiers: {}, ...extra,
});

describe("the reward ladder", () => {
  it("pays nothing below the first threshold", () => {
    expect(tenureSteps(0)).toBe(0);
    expect(tenureSteps(9)).toBe(0);
  });

  it("pays one step at 10, two at 20, three at 30", () => {
    expect(tenureSteps(10)).toBe(1);
    expect(tenureSteps(19)).toBe(1);
    expect(tenureSteps(20)).toBe(2);
    expect(tenureSteps(29)).toBe(2);
    expect(tenureSteps(30)).toBe(3);
    expect(tenureSteps(99)).toBe(3); // no fourth step to fall off
  });

  it("counts down to the next threshold, then stops", () => {
    expect(levelsToNextTenure(0)).toBe(10);
    expect(levelsToNextTenure(12)).toBe(8);
    expect(levelsToNextTenure(30)).toBeNull();
  });
});

describe("what gets granted", () => {
  const chain = [
    up("a_junior", "Junior", 1),
    up("a_senior", "Senior", 3, ["a_junior"]),
    up("a_principal", "Principal", 5, ["a_senior"]),
  ];

  it("grants the whole chain, not just the top card", () => {
    // Modifiers compound, so the Principal alone would be WEAKER than the
    // Junior+Senior a 20-level run gets.
    const [offer] = eligibleTenureChains(chain, 30, first);
    expect(offer.upgrades.map(u => u.id)).toEqual(["a_junior", "a_senior", "a_principal"]);
  });

  it("grants a prefix of the chain at the lower tiers", () => {
    expect(eligibleTenureChains(chain, 10, first)[0].upgrades.map(u => u.id)).toEqual(["a_junior"]);
    expect(eligibleTenureChains(chain, 20, first)[0].upgrades.map(u => u.id))
      .toEqual(["a_junior", "a_senior"]);
  });

  it("offers nothing at all below the first threshold", () => {
    expect(eligibleTenureChains(chain, 9, first)).toEqual([]);
    expect(rollTenureOffers(chain, 9, first)).toEqual([]);
  });

  it("drops a chain that cannot reach the required depth", () => {
    const stub = [up("b_junior", "Junior", 1), up("b_senior", "Senior", 2, ["b_junior"])];
    expect(eligibleTenureChains(stub, 20, first)).toHaveLength(1); // Junior+Senior: fine
    expect(eligibleTenureChains(stub, 30, first)).toHaveLength(0); // no Principal: excluded
  });
});

describe("selection is by tier, not by graph position", () => {
  /**
   * The bug this feature would otherwise have shipped with. All three of these
   * are prerequisite-graph roots, and none is a legitimate first-tier reward.
   */
  it("never offers a non-Junior, however few prerequisites it has", () => {
    const trap = [
      up("golden_parachute", "Wizard", 5, [], { cost: 250 }),
      up("system_architect", "Architect", 4),
      up("technical_debt_senior", "Senior", 4),
      up("ok_junior", "Junior", 1),
    ];
    const offers = eligibleTenureChains(trap, 30, first);
    expect(offers).toHaveLength(0); // ok_junior has no chain; the rest aren't Juniors
    expect(eligibleTenureChains(trap, 10, first).map(o => o.headId)).toEqual(["ok_junior"]);
  });

  it("does not offer a Junior that sits mid-chain", () => {
    // benefits_package-style: a Junior hanging off a Principal is a continuation,
    // not an entry point.
    const mid = [
      up("x_junior", "Junior", 1),
      up("x_senior", "Senior", 2, ["x_junior"]),
      up("y_junior", "Junior", 4, ["x_senior"]),
    ];
    expect(eligibleTenureChains(mid, 10, first).map(o => o.headId)).toEqual(["x_junior"]);
  });

  it("never offers ascension-only upgrades", () => {
    const asc = [
      up("asc_junior", "Junior", 1, [], { ascensionOnly: true }),
      up("asc_senior", "Senior", 2, ["asc_junior"], { ascensionOnly: true }),
    ];
    expect(eligibleTenureChains(asc, 20, first)).toEqual([]);
  });
});

describe("the unlockLevel gate covers every granted upgrade", () => {
  const lateSenior = [
    up("c_junior", "Junior", 1),
    up("c_senior", "Senior", 25, ["c_junior"]),
    up("c_principal", "Principal", 28, ["c_senior"]),
  ];

  it("offers the chain at 10, where only the Junior is granted", () => {
    expect(eligibleTenureChains(lateSenior, 10, first)).toHaveLength(1);
  });

  /**
   * The whole point of the gate: at 20 the reward INCLUDES the Senior, which
   * level 20 had no access to. Gating only the card on display would leak it.
   */
  it("withholds the chain at 20, because its Senior unlocks at 25", () => {
    expect(eligibleTenureChains(lateSenior, 20, first)).toEqual([]);
  });

  it("offers it again once the player has been deep enough to see it", () => {
    expect(eligibleTenureChains(lateSenior, 30, first)).toHaveLength(1);
  });
});

describe("the game picks the fork", () => {
  const forked = [
    up("d_junior", "Junior", 1),
    up("d_senior", "Senior", 3, ["d_junior"]),
    up("d_principal_a", "Principal", 5, ["d_senior"], { choiceGroup: "d_principal" }),
    up("d_principal_b", "Principal", 5, ["d_senior"], { choiceGroup: "d_principal" }),
  ];

  it("resolves a choiceGroup to exactly one option", () => {
    const picked = eligibleTenureChains(forked, 30, first)[0].upgrades;
    expect(picked).toHaveLength(3);
    expect(picked[2].choiceGroup).toBe("d_principal");
  });

  it("can pick either side, so it is a real roll and not a fixed answer", () => {
    expect(eligibleTenureChains(forked, 30, first)[0].upgrades[2].id).toBe("d_principal_a");
    expect(eligibleTenureChains(forked, 30, last)[0].upgrades[2].id).toBe("d_principal_b");
  });

  // A branch that leads to a different tier is not part of the Junior/Senior/
  // Principal path and must not be walked into.
  it("ignores branches that do not match the next tier", () => {
    const sidetrack = [
      up("e_junior", "Junior", 1),
      up("e_senior", "Senior", 3, ["e_junior"]),
      up("e_senior_2", "Senior", 4, ["e_senior"]),   // deeper Senior: not the path
      up("e_principal", "Principal", 5, ["e_senior"]),
    ];
    const picked = eligibleTenureChains(sidetrack, 30, first)[0].upgrades;
    expect(picked.map(u => u.id)).toEqual(["e_junior", "e_senior", "e_principal"]);
  });
});

describe("the walk stays inside the head's family", () => {
  /**
   * The bug this replaced. Several Seniors in the real catalogue are the
   * prerequisite for Principals of a DIFFERENT family, so an unconstrained walk
   * grants "Multithreading" under a card headed "Fast Compile".
   */
  const foreign = [
    up("fc_junior", "Junior", 1),
    up("fc_senior", "Senior", 3, ["fc_junior"]),
    up("fc_principal", "Principal", 5, ["fc_senior"]),
    // Legal prerequisite edge, entirely different family.
    up("mt_principal", "Principal", 5, ["fc_senior"], { name: "Multithreading" }),
  ];

  it("never grants a foreign family off a shared prerequisite", () => {
    for (const rng of [first, last, Math.random]) {
      const granted = eligibleTenureChains(foreign, 30, rng)[0].upgrades;
      expect(granted.map(u => u.id)).toEqual(["fc_junior", "fc_senior", "fc_principal"]);
    }
  });

  it("picks the same-family Senior when the head branches into another family", () => {
    const twoSeniors = [
      up("ff_junior", "Junior", 1),
      up("ff_senior", "Senior", 3, ["ff_junior"]),
      up("ff_principal", "Principal", 5, ["ff_senior"]),
      // "Frozen Assets"-style sibling branch hanging off the same Junior.
      up("fa_senior", "Senior", 3, ["ff_junior"], { name: "FrozenAssets" }),
      up("fa_principal", "Principal", 5, ["fa_senior"], { name: "FrozenAssets" }),
    ];
    for (const rng of [first, last]) {
      expect(eligibleTenureChains(twoSeniors, 30, rng)[0].upgrades.map(u => u.id))
        .toEqual(["ff_junior", "ff_senior", "ff_principal"]);
    }
  });

  // The constraint must not swallow the randomisation the issue asked for:
  // same-family choiceGroup alternatives are still rolled.
  it("still rolls between same-family choiceGroup options", () => {
    const both = [
      up("ro_junior", "Junior", 1),
      up("ro_senior", "Senior", 3, ["ro_junior"]),
      up("ro_principalA", "Principal", 5, ["ro_senior"], { choiceGroup: "ro_p" }),
      up("ro_principalB", "Principal", 5, ["ro_senior"], { choiceGroup: "ro_p" }),
      up("mm_principal", "Principal", 5, ["ro_senior"], { name: "MicroManager" }),
    ];
    expect(eligibleTenureChains(both, 30, first)[0].upgrades[2].id).toBe("ro_principalA");
    expect(eligibleTenureChains(both, 30, last)[0].upgrades[2].id).toBe("ro_principalB");
  });

  it("drops a chain whose only continuation is a foreign family", () => {
    const orphan = [
      up("op_junior", "Junior", 1),
      up("op_senior", "Senior", 3, ["op_junior"]),
      up("zz_principal", "Principal", 5, ["op_senior"], { name: "Something Else" }),
    ];
    // It can still pay two steps, but not three: substituting would be a lie.
    expect(eligibleTenureChains(orphan, 20, first)).toHaveLength(1);
    expect(eligibleTenureChains(orphan, 30, first)).toHaveLength(0);
  });
});

describe("the offer roll", () => {
  const many = Array.from({ length: 8 }, (_, i) => [
    up(`m${i}_junior`, "Junior", 1),
    up(`m${i}_senior`, "Senior", 2, [`m${i}_junior`]),
    up(`m${i}_principal`, "Principal", 3, [`m${i}_senior`]),
  ]).flat();

  it("shows three distinct chains", () => {
    const offers = rollTenureOffers(many, 30, Math.random);
    expect(offers).toHaveLength(TENURE_OFFER_COUNT);
    expect(new Set(offers.map(o => o.headId)).size).toBe(TENURE_OFFER_COUNT);
  });

  it("never invents offers when the pool is smaller than the count", () => {
    const two = many.slice(0, 6);
    expect(rollTenureOffers(two, 30, Math.random).length).toBe(2);
  });
});

/**
 * Against the shipped catalogue. If a content edit shrinks a pool below the
 * offer count, the draft screen would silently show fewer than three cards.
 */
describe("the real upgrades.yml", () => {
  it("has the path tiers it is walked with", () => {
    expect(TENURE_PATH).toEqual(["Junior", "Senior", "Principal"]);
  });

  it.each(TENURE_THRESHOLDS)("can fill three offers at depth %i", (reached) => {
    const offers = eligibleTenureChains(REAL_UPGRADES, reached, Math.random);
    expect(offers.length).toBeGreaterThanOrEqual(TENURE_OFFER_COUNT);
  });

  it("never lets golden_parachute into a real offer", () => {
    for (const reached of [10, 15, 20, 25, 30, 99]) {
      const granted = eligibleTenureChains(REAL_UPGRADES, reached, Math.random)
        .flatMap(o => o.upgrades.map(u => u.id));
      expect(granted).not.toContain("golden_parachute");
    }
  });

  it("only ever grants upgrades the player's depth had unlocked", () => {
    for (const reached of [10, 20, 30]) {
      for (const offer of eligibleTenureChains(REAL_UPGRADES, reached, Math.random)) {
        for (const u of offer.upgrades) {
          expect(u.unlockLevel ?? 1).toBeLessThanOrEqual(reached);
        }
      }
    }
  });

  it("only ever grants upgrades from the chain the card is named after", () => {
    for (const reached of [10, 20, 30]) {
      for (const offer of eligibleTenureChains(REAL_UPGRADES, reached, Math.random)) {
        for (const u of offer.upgrades) {
          expect(u.name).toBe(offer.name);
        }
      }
    }
  });

  it("grants exactly as many upgrades as the depth pays for", () => {
    for (const reached of [10, 20, 30]) {
      for (const offer of eligibleTenureChains(REAL_UPGRADES, reached, Math.random)) {
        expect(offer.upgrades).toHaveLength(tenureSteps(reached));
      }
    }
  });
});

/**
 * Tenure identifies a family by its `name`, so every tier of a chain MUST share
 * one. That is a real assumption about content, not about code: the catalogue
 * already contains "Garbage Collector" / "Garbage Collector 2" / "Garbage
 * Collector 3" as three separate names, and if that style ever reached a
 * Tenure-eligible chain the walk would find no same-name continuation and the
 * chain would vanish from the offer pool silently, with no error anywhere.
 * This makes that failure loud at build time instead.
 */
describe("the family-name assumption Tenure is built on", () => {
  it("every Tenure-eligible chain names all of its tiers identically", () => {
    for (const reached of [10, 20, 30]) {
      for (const offer of eligibleTenureChains(REAL_UPGRADES, reached, Math.random)) {
        const names = new Set(offer.upgrades.map(u => u.name));
        expect([...names]).toEqual([offer.name]);
      }
    }
  });

  /**
   * The pool must not quietly shrink. If a rename drops a chain, the count
   * changes here rather than a player seeing two cards instead of three.
   */
  it("offers the expected number of chains at each threshold", () => {
    const counts = TENURE_THRESHOLDS.map(
      r => eligibleTenureChains(REAL_UPGRADES, r, Math.random).length,
    );
    expect(counts).toEqual([14, 11, 9]);
  });
});

