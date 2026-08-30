/**
 * Some upgrades cost more than their tier says, on purpose.
 *
 * Costs derive from unlock level x tier, which is what keeps the shelf coherent
 * as levels are re-tuned. The formula cannot see two things: that an upgrade is
 * the best opening buy in the game, and that it is a DOOR - that buying it also
 * buys access to a line behind it.
 *
 * Runtime Optimisation is both. It was picked first every run, and it is now
 * the prerequisite for Load Balancer, so the player is buying a line as well as
 * a 5% speed cut. costMultiplier is how that is said in the catalogue rather
 * than by hardcoding a number that stops tracking the formula the moment level
 * points move.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { computeUpgradeCost, resolveUpgradeCost, DEFAULT_UPGRADE_PRICING } from "@/lib/upgradePricing";

interface Upgrade {
  id: string; name: string; tier: string; unlockLevel?: number;
  cost?: number; costMultiplier?: number; choiceGroup?: string;
  prerequisites?: string[];
}
const UPGRADES = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/upgrades.yml"), "utf8"),
) as { upgrades: Upgrade[] }).upgrades;
const byId = new Map(UPGRADES.map(u => [u.id, u]));

/**
 * What the shop will charge, through the SAME function the shop uses.
 *
 * This recomputed the arithmetic itself at first, and proved nothing: deleting
 * the multiplier from useUpgradeManager left every assertion green, because the
 * test was agreeing with itself rather than with the game. resolveUpgradeCost
 * is now the one reading and both sides call it.
 */
const LEVEL_POINTS = new Map(
  UPGRADES.map(u => [u.unlockLevel ?? 1, 20] as const),
);
const effective = (u: Upgrade) =>
  resolveUpgradeCost(u as never, LEVEL_POINTS, DEFAULT_UPGRADE_PRICING)!;

describe("the surcharge on the opening pick", () => {
  it("charges 20% more for Runtime Optimisation", () => {
    const ro = byId.get("runtime_optimisation_junior")!;
    expect(ro.costMultiplier).toBe(1.2);
    expect(effective(ro)).toBe(36);
  });

  it("leaves the rest of the opening shelf alone", () => {
    // The surcharge only means something against an unsurcharged shelf. If
    // everything at level 1 cost more, nothing would.
    const shelf = UPGRADES.filter(u => (u.unlockLevel ?? 1) === 1 && !(u.prerequisites ?? []).length);
    const others = shelf.filter(u => u.id !== "runtime_optimisation_junior");
    expect(others.length, "the opening shelf has no alternatives").toBeGreaterThanOrEqual(3);
    for (const u of others) {
      expect(u.costMultiplier ?? 1, `${u.id} also carries a surcharge`).toBe(1);
    }
  });

  it("prices the whole opening shelf together apart from that one", () => {
    // The four original level-1 upgrades set an explicit 30 against a derived
    // 40, so the first shop is affordable at all. A new arrival on that shelf
    // has to join them or it is quietly the expensive one for no stated reason,
    // which is exactly what Onboarding was until this caught it.
    const shelf = UPGRADES.filter(u => (u.unlockLevel ?? 1) === 1 && !(u.prerequisites ?? []).length);
    const base = shelf.map(u => u.cost);
    expect(new Set(base).size, `level-1 base costs disagree: ${base.join(", ")}`).toBe(1);
  });

  it("still sits below what the formula would have charged", () => {
    // The surcharge is a nudge, not a repricing: 36 against the 40 the level x
    // tier formula gives a level-1 Junior. It should read as "this one is
    // dearer", not as an outlier from a different economy.
    const levelPoints = new Map([[1, 20]]);
    const formula = computeUpgradeCost(1, "Junior" as never, levelPoints, DEFAULT_UPGRADE_PRICING)!;
    expect(effective(byId.get("runtime_optimisation_junior")!)).toBeLessThan(formula);
  });
});

describe("costMultiplier as a mechanism", () => {
  it("is used deliberately and sparingly", () => {
    // A price lever on every card is a second pricing system competing with the
    // formula. It is for the handful the formula genuinely cannot see.
    const marked = UPGRADES.filter(u => u.costMultiplier !== undefined);
    expect(marked.length, `${marked.map(u => u.id).join(", ")}`).toBeLessThanOrEqual(4);
  });

  it("never discounts, only surcharges", () => {
    // A multiplier under 1 would be a sale, which the shop already has its own
    // machinery for (shopDiscountMultiplier, freeCheapestOffer). Two systems
    // quietly discounting the same card is how a price becomes unexplainable.
    for (const u of UPGRADES) {
      if (u.costMultiplier === undefined) continue;
      expect(u.costMultiplier, `${u.id} discounts via costMultiplier`).toBeGreaterThan(1);
    }
  });

  it("is only put on upgrades that actually open something", () => {
    // The stated justification is that a door is worth more than its effect.
    // If it drifts onto an upgrade nothing depends on, that reasoning is gone
    // and the number is just a number.
    for (const u of UPGRADES) {
      if (u.costMultiplier === undefined) continue;
      const opens = UPGRADES.filter(o => (o.prerequisites ?? []).includes(u.id));
      expect(opens.length, `${u.id} is surcharged but opens nothing`).toBeGreaterThan(0);
    }
  });
});
