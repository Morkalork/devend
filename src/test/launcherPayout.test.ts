/**
 * What a hard shot actually buys, and what it must not touch.
 *
 * The design this replaced was "a harder shot makes each lock worth more". It
 * would have paid nothing. Lock quality banks into CRAFT, and Craft is capped
 * with several routes to the same ceiling (lockCapacity.ts fixes
 * `premiumAvailable` at `totalCapacity x (superiorMultiplier - 1)` and calls
 * zone and simultaneous locks alternative routes rather than a bigger axis), so
 * on any map where superior locks were already available the launch bonus would
 * have been added to a full axis and clamped straight back off. That exact bug
 * shipped once already, on the colored-area share, where the post-map screen
 * showed "+9h" for a contribution worth zero.
 *
 * So the power multiplies the map's BASE, which no ceiling can swallow, and
 * these tests are mostly about proving it stays there.
 */
import { describe, it, expect } from "vitest";
import { calculateScore, type ScoreOptions } from "@/lib/scoring";
import { LAUNCH_MAX_POWER } from "@/lib/launcher";

const opts = (over: Partial<ScoreOptions> = {}): ScoreOptions => ({
  locks: { lockedCapacity: 2, totalCapacity: 4, premiumEarned: 0, premiumAvailable: 4 },
  ...over,
});

const scoreAt = (launchPower?: number) =>
  calculateScore(2, 4, 0, 30, 20, opts(launchPower === undefined ? {} : { launchPower }));

describe("a hard shot buys a more valuable map", () => {
  it("multiplies the base by the power fired at", () => {
    expect(scoreAt(1).breakdown.multipliedBase).toBe(20);
    expect(scoreAt(2).breakdown.multipliedBase).toBe(40);
    expect(scoreAt(2.5).breakdown.multipliedBase).toBe(50);
  });

  it("raises what the map could pay, so the Score line moves as you pull", () => {
    // The whole point of putting it on the base: `y` in "Score: x / y" is
    // `multipliedBase + every ceiling`, so a harder pull visibly raises the
    // map's value before a single fence is drawn.
    const soft = scoreAt(1).breakdown.mapCeiling!;
    const hard = scoreAt(LAUNCH_MAX_POWER).breakdown.mapCeiling!;
    expect(hard - soft).toBe(20 * LAUNCH_MAX_POWER - 20);
  });

  it("pays more in total for the same play", () => {
    expect(scoreAt(3).levelScore).toBeGreaterThan(scoreAt(1).levelScore);
  });
});

describe("what it must NOT do", () => {
  it("leaves a map without a launcher exactly as it was", () => {
    // The guarantee for the other 34 maps: absent behaves identically to 1.
    const absent = scoreAt(undefined);
    const explicit = scoreAt(1);
    expect(absent.levelScore).toBe(explicit.levelScore);
    expect(absent.breakdown.multipliedBase).toBe(explicit.breakdown.multipliedBase);
    expect(absent.breakdown.mapCeiling).toBe(explicit.breakdown.mapCeiling);
  });

  it("does not touch a single axis, at any power", () => {
    // THE guard against rebuilding the bug this design exists to avoid. If the
    // power ever leaks into Craft it will be clamped by the ceiling and pay
    // nothing on exactly the maps where a player earned it.
    const soft = scoreAt(1).breakdown.axes;
    const hard = scoreAt(LAUNCH_MAX_POWER).breakdown.axes;
    expect(hard.delivery).toBe(soft.delivery);
    expect(hard.craft).toBe(soft.craft);
    expect(hard.tempo).toBe(soft.tempo);
    expect(hard.thrift).toBe(soft.thrift);
    expect(hard.greed).toBe(soft.greed);
    expect(hard.total).toBe(soft.total);
  });

  it("does not move an axis CEILING either", () => {
    // A launcher must not quietly make the tactical lanes bigger: that would
    // change which lanes are reachable, which is a different feature.
    const soft = scoreAt(1).breakdown.axes.ceilings;
    const hard = scoreAt(LAUNCH_MAX_POWER).breakdown.axes.ceilings;
    expect(hard).toEqual(soft);
  });

  it("never pays less than an unfired map, whatever arrives", () => {
    // A save or a config carrying nonsense must not make a launcher map worse
    // than a plain one, and must not print money either.
    const plain = scoreAt(1).breakdown.multipliedBase!;
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 999]) {
      const got = scoreAt(bad).breakdown.multipliedBase!;
      expect(got, `power ${bad}`).toBeGreaterThanOrEqual(plain);
      expect(got, `power ${bad}`).toBeLessThanOrEqual(plain * LAUNCH_MAX_POWER);
    }
  });

  it("still reports a ceiling at or above what it paid", () => {
    for (const p of [1, 1.7, LAUNCH_MAX_POWER]) {
      const r = scoreAt(p);
      expect(r.breakdown.mapCeiling!, `power ${p}`).toBeGreaterThanOrEqual(r.levelScore);
    }
  });
});
