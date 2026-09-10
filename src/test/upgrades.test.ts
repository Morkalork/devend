import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateScore } from "@/lib/scoring";
import yaml from "js-yaml";
import type { UpgradeConfig, UpgradeData } from "@/types/upgrade";
import type { LevelData } from "@/types/level";
import { mergePricing, computeUpgradeCost, inflationForLevel } from "@/lib/upgradePricing";

// Read the upgrade catalogue straight from the YAML source of truth so this
// suite guards the data, not a hand-maintained copy.
const upgradeDoc = yaml.load(
  readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
) as UpgradeData;
const upgrades = upgradeDoc.upgrades;

// A price is a fraction of what one good map pays (see upgradePricing.ts), so
// recompute effective costs the same way the loader does to guard them.
const pricing = mergePricing(upgradeDoc.pricing);
const effectiveCost = (u: UpgradeConfig): number | null =>
  typeof u.cost === "number" ? u.cost : computeUpgradeCost(u.tier, pricing);

const byId = new Map(upgrades.map(u => [u.id, u] as const));
const prereqsOf = (id: string): string[] => byId.get(id)?.prerequisites ?? [];

// The intended track heads — the only non-ascension upgrades with no prereqs.
// One head per archetype line: the synergy rework promoted Fault Tolerance,
// Technical Debt, Feature Freeze and Severance Package to roots (their old
// cross-family prereqs were whimsical, not tactical).
//
// Three of those roots have since been gated again, deliberately and against
// that earlier judgement: the shop had 22 always-available heads and wanted
// fewer, so the doors were re-cut where the NAMES carry the logic rather than
// where they used to be. Technical Debt now needs Performance Bonus (you take
// on the debt to hit the bonus), Deadline Extension needs Padded Estimate (the
// same move, escalated), and Golden Parachute needs Severance Package (a golden
// parachute IS one). Each was checked for the unlock inversion that got the old
// ones removed; Golden Parachute moved 5 -> 7 to clear it.
const EXPECTED_ROOTS = [
  "runtime_optimisation_junior",
  "memory_footprint_junior",
  "fast_compile_junior",
  "performance_bonus_junior",
  "system_architect",
  "scrum_master_1",
  "defensive_programming_junior",
  "fault_tolerance_junior",
  "feature_freeze_junior",
  // ghost_protocol_junior is deliberately NOT here any more. It was a level-1
  // root, and the chain it opens is total fence invulnerability - a player had
  // all of it before act II and could not lose a fence. It now sits at 18
  // behind Defensive Programming's Senior, so committing to a safety build is
  // the price of reaching it.
  "severance_package_junior",
  "code_review",
  "cold_boot",
  "moonshot",
  "benefits_package_junior",
  "free_fall_junior",
  "breaking_change_junior",
  // Replaced the three Garbage Collector roots, whose modifier keys were never
  // read by any game logic (see the Padded Estimate block in upgrades.yml).
  "padded_estimate_junior",
  // The first shop had four upgrades and they all answered one question:
  // do not let the ball hit my growing fence. Onboarding shortens the map
  // instead, so the opening choice has a second direction in it.
  "onboarding_junior",
  // The two ways to relate to the store's ability slot. Roots, and deliberately
  // NOT a chain: Open Source Contribution removes the slot that Talent Scout
  // widens, so gating one behind the other would sell a player an upgrade and
  // then sell them its own deletion.
  "talent_scout",
  "open_source_contribution",
  // THE OPEN SHELF. Every other fence type is the crown of a maxed family
  // (unlockAfterChoice), which is what makes staying the course with a build
  // worth something - and would leave a player who spreads their buys finishing
  // a run with a bar of empty slots and no idea what fills them. This is the
  // one that needs no commitment, so it has to be a root: a root is exactly
  // "can turn up in any shop for any build", which is what open means here.
  "set_a_breakpoint",
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

  it("never prints one below its family GATE's either", () => {
    // Same lie through the other door. `unlockAfterChoice` waits on a whole
    // family's top tier, so an upgrade printing a level below where that tier
    // even becomes buyable is advertising itself as available years early.
    const offenders: string[] = [];
    for (const u of upgrades) {
      if (!u.unlockAfterChoice) continue;
      const members = upgrades.filter(m => m.choiceGroup === u.unlockAfterChoice);
      const earliest = Math.min(...members.map(m => m.unlockLevel ?? 1));
      if ((u.unlockLevel ?? 1) < earliest) {
        offenders.push(`${u.id} (L${u.unlockLevel ?? 1}) -> ${u.unlockAfterChoice} (L${earliest})`);
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
    // A root is what a player can be offered from a standing start, and
    // `prerequisites` is no longer the only thing that stops that: the four
    // crown-of-a-maxed-family fences carry no prerequisites at all and are
    // gated by `unlockAfterChoice` instead. Counting them here would have
    // called four of the most-gated upgrades in the catalogue roots.
    const roots = upgrades
      .filter(u => !u.ascensionOnly
        && (u.prerequisites?.length ?? 0) === 0
        && !u.unlockAfterChoice)
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

/**
 * What a map pays, against what the shop charges.
 *
 * Reported as "I could afford way too much during the first maps", and the
 * cause was a whole block of tests below this line agreeing with the wrong
 * model. They priced a map as `flatBase + lockValue` - the flat base plus a
 * lock bonus - which is what income WAS before the Performance Review. Income
 * is now six axes paid in absolute hours, `points: 20` is a rounding error
 * beside them, and prices were still derived from it. Every assertion passed
 * the whole time, because they were checking the formula against itself.
 *
 * So income here is measured by running calculateScore, the function the game
 * actually pays out with. If the scoring model changes again, these numbers
 * move with it and the pricing has to follow - which is the property the old
 * block did not have.
 */
describe("what a map pays against what the shop charges", () => {
  const scoringDoc = yaml.load(
    readFileSync(resolve(process.cwd(), "public/scoring-config.yml"), "utf8"),
  ) as { scoring: { lockValue: number; lockQuality: { superiorThresholdFraction: number; superiorMultiplier: number }; shipEarly: { maxPercent: number } } };
  const scoring = scoringDoc.scoring;

  /** A map's payout at a given play quality, through the real scoring path. */
  const income = (o: {
    cuts: number; par: number; remaining: number; threshold: number;
    capacity: number; locked: number; premium: number;
    engagement: number; shipEarly: number;
  }): number => calculateScore(o.cuts, o.par, o.remaining, o.threshold, 20, {
    locks: {
      totalCapacity: o.capacity, lockedCapacity: o.locked,
      premiumEarned: o.premium, premiumAvailable: o.capacity,
    },
    engagement: { ratio: o.engagement, offered: o.engagement > 0 },
    shipEarlyPercent: o.shipEarly,
  }).levelScore;

  // Four runs of the same map, from flawless to hopeless. Level 1's shape (par
  // 3, clear to 40%, one x1 ball) but the numbers barely move across the
  // ladder: the axes are absolute, so every map's ceiling is the same.
  const FLAWLESS = income({ cuts: 1, par: 3, remaining: 0, threshold: 40, capacity: 12, locked: 12, premium: 12, engagement: 1, shipEarly: 30 });
  const GOOD     = income({ cuts: 2, par: 3, remaining: 30, threshold: 40, capacity: 12, locked: 12, premium: 7, engagement: 0.7, shipEarly: 20 });
  const ORDINARY = income({ cuts: 3, par: 3, remaining: 40, threshold: 40, capacity: 12, locked: 12, premium: 0, engagement: 0.3, shipEarly: 0 });
  const SCRAPPY  = income({ cuts: 5, par: 3, remaining: 40, threshold: 40, capacity: 12, locked: 6, premium: 0, engagement: 0, shipEarly: 0 });

  const cheapestFormula = Math.min(
    ...upgrades
      .filter(u => !u.ascensionOnly && typeof u.cost !== "number")
      .map(u => effectiveCost(u) ?? Infinity),
  );

  it("has the four play qualities in the order they should be", () => {
    // The guard on the guard: if these ever collapse together, every threshold
    // below becomes vacuous and would keep passing.
    expect(FLAWLESS).toBeGreaterThan(GOOD);
    expect(GOOD).toBeGreaterThan(ORDINARY);
    expect(ORDINARY).toBeGreaterThan(SCRAPPY);
  });

  it("prices the cheapest formula tier at about one good map", () => {
    // THE ratio the complaint was about. It was 40h against a 124h flawless
    // map: three cards a map, so the shop was a formality rather than a choice.
    // A band rather than a number, because the anchor is a design dial and this
    // should fail when it drifts, not when it is tuned.
    expect(cheapestFormula / GOOD).toBeGreaterThan(0.8);
    expect(cheapestFormula / GOOD).toBeLessThan(1.4);
  });

  it("makes a scrappy map buy nothing and a flawless one buy one thing", () => {
    expect(SCRAPPY, "a bad map still opens the shop").toBeLessThan(cheapestFormula);
    expect(ORDINARY, "an ordinary clear buys a formula card outright").toBeLessThan(cheapestFormula);
    expect(FLAWLESS, "a flawless map cannot afford anything").toBeGreaterThan(cheapestFormula);
    // One thing and change toward the next, not two things. This is the line
    // the complaint was about: at the old prices a flawless map bought four.
    expect(FLAWLESS, "a flawless map buys two of the cheapest").toBeLessThan(cheapestFormula * 2);
  });

  it("discounts the level-1 first hires by a RATIO, not by a number", () => {
    // The on-ramp exists so the opening shop is not a shelf you cannot afford,
    // and it reopened the whole problem once already. They were 30h against a
    // 40h Junior - a 25% discount on one tier - and survived an anchor change
    // as 35h against a 133h Junior, which is 74% off. Every level-1 upgrade is
    // a first hire, so that was not an exception, it was the entire opening
    // shelf at a quarter price: 125h bought all three cards it shows.
    //
    // The ratio is the claim, so the ratio is what is pinned. A future anchor
    // change fails here rather than quietly making the first shop free again.
    const firstHires = upgrades.filter(u =>
      !u.ascensionOnly && typeof u.cost === "number" && (u.unlockLevel ?? 1) === 1);
    expect(firstHires.length, "the level-1 on-ramp is gone").toBeGreaterThan(0);
    const cheapestHire = Math.min(...firstHires.map(u => u.cost as number));
    const ratio = cheapestHire / cheapestFormula;
    expect(ratio, "the on-ramp is discounted to the point of being free").toBeGreaterThan(0.6);
    expect(ratio, "the on-ramp is not a discount at all").toBeLessThan(0.9);
  });

  it("lets a good first map buy one thing from the opening shelf, not three", () => {
    // The complaint, stated as a test. Every upgrade the first shop can offer
    // unlocks at level 1, so this IS the opening shelf rather than a sample of
    // it, and the shop shows three of them.
    const openingShelf = upgrades
      .filter(u => !u.ascensionOnly && (u.unlockLevel ?? 1) === 1 && !(u.prerequisites ?? []).length)
      .map(u => effectiveCost(u) ?? Infinity)
      .sort((a, b) => a - b);
    expect(openingShelf.length, "nothing is offerable at level 1").toBeGreaterThanOrEqual(3);
    expect(GOOD, "a good first map cannot open the store at all")
      .toBeGreaterThanOrEqual(openingShelf[0]);
    expect(GOOD, "a good first map buys two of the opening shelf")
      .toBeLessThan(openingShelf[0] + openingShelf[1]);
    expect(FLAWLESS, "even a flawless first map buys two")
      .toBeLessThan(openingShelf[0] + openingShelf[1]);
  });

  it("keeps the catalogue unaffordable in full, even for an ace", () => {
    // No run may buy everything. Measured against a flawless run on every map
    // rather than against the old cap, which no longer binds anything.
    const maps = (yaml.load(
      readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
    ) as LevelData).levels.length;
    const total = upgrades
      .filter(u => !u.ascensionOnly)
      .reduce((sum, u) => sum + (effectiveCost(u) ?? 0), 0);
    expect(total).toBeGreaterThan(FLAWLESS * maps);
  });

  it("keeps Golden Parachute the single most expensive upgrade", () => {
    // Runs start with no free Continue; the buyable one must stay the priciest
    // offer in the catalogue (design decision, not formula-derived). It is an
    // explicit cost, so it does NOT move with the anchor and has to be re-set
    // by hand whenever the anchor is - which is what this catches.
    const parachute = effectiveCost(byId.get("golden_parachute")!)!;
    const pricier = upgrades
      .filter(u => u.id !== "golden_parachute" && !u.ascensionOnly)
      .filter(u => (effectiveCost(u) ?? 0) >= parachute)
      .map(u => u.id);
    expect(pricier).toEqual([]);
  });

  it("superior-lock tuning is sane: a real bar and a real payoff", () => {
    expect(scoring.lockQuality.superiorThresholdFraction).toBeGreaterThan(0);
    expect(scoring.lockQuality.superiorThresholdFraction).toBeLessThan(1);
    expect(scoring.lockQuality.superiorMultiplier).toBeGreaterThanOrEqual(1.5);
  });

  it("still pays enough per lock for locking to be the income", () => {
    expect(scoring.lockValue).toBeGreaterThanOrEqual(10);
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

describe("choice-group forks (mutually-exclusive tiers)", () => {
  const groups = new Map<string, UpgradeConfig[]>();
  for (const u of upgrades) {
    if (!u.choiceGroup) continue;
    (groups.get(u.choiceGroup) ?? groups.set(u.choiceGroup, []).get(u.choiceGroup)!).push(u);
  }

  it("every group has 2+ options that share a name, tier and unlock level", () => {
    expect(groups.size).toBeGreaterThan(0);
    for (const [group, opts] of groups) {
      expect(opts.length, group).toBeGreaterThanOrEqual(2);
      const [first] = opts;
      for (const o of opts) {
        expect(o.name, group).toBe(first.name);
        expect(o.tier, group).toBe(first.tier);
        expect(o.unlockLevel, group).toBe(first.unlockLevel);
        // Same prerequisite, so the choice appears as one card.
        expect(o.prerequisites, group).toEqual(first.prerequisites);
      }
    }
  });

  /**
   * Padded Estimate's fork is an opposition, not two flavours: Sandbagging
   * MOVES the over-par cliff by buying another fence of par, Blameless SOFTENS
   * it by forgiving the first fence over. Four fences over par, Sandbagging
   * changes nothing (still the 3-or-more bracket) while Blameless lifts you a
   * whole bracket, so one rewards near-par play and the other rescues a
   * disaster.
   */
  it("Padded Estimate's Principal fork splits slack vs reward", () => {
    const opts = groups.get("padded_estimate_principal");
    expect(opts).toBeDefined();
    const sandbag = opts!.find(o => o.id.endsWith("_principal"))!;
    const overdeliver = opts!.find(o => o.id.endsWith("_b"))!;
    // Sandbagging buys SLACK: another fence of par, no change to the payout.
    expect(sandbag.modifiers.parBonus).toBeGreaterThan(0);
    expect(sandbag.modifiers.underParBonusMultiplier ?? 1).toBe(1);
    // Overdelivery buys REWARD: beating par pays double, par itself unchanged.
    expect(overdeliver.modifiers.underParBonusMultiplier).toBeGreaterThan(1);
    expect(overdeliver.modifiers.parBonus ?? 0).toBe(0);
    // Overdelivery carries the extra safety tag; Sandbagging is pure tempo.
    expect(overdeliver.tags).toContain("safety");
    expect(sandbag.tags).not.toContain("safety");
  });

  it("Defensive Programming's Architect fork splits survival vs evasion", () => {
    const opts = groups.get("defensive_programming_architect");
    expect(opts).toBeDefined();
    const bunker = opts!.find(o => o.id.endsWith("_a"))!;
    const nanobots = opts!.find(o => o.id.endsWith("_b"))!;
    // Bunker soaks a hit each map (a per-map shield), leaves ball size alone.
    // Lives were decoupled from this line: Fault Tolerance is the one life line.
    expect(bunker.modifiers.wallShieldsPerMap).toBeGreaterThan(0);
    expect(bunker.modifiers.ballSizeMultiplier ?? 1).toBe(1);
    expect(bunker.modifiers.extraLives ?? 0).toBe(0);
    // Nanobots buys shrink, no shield.
    expect(nanobots.modifiers.ballSizeMultiplier).toBeLessThan(1);
    expect(nanobots.modifiers.wallShieldsPerMap ?? 0).toBe(0);
  });
});
