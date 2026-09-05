/**
 * The two numbers the post-map screen is not allowed to work out for itself.
 *
 * The score overview shows "Score: x / y" over a list of what the map offered.
 * Both ends have to be the scorer's, and there is a specific reason to insist
 * on it: the base row used to print `floor(basePoints x performanceMultiplier)`
 * while the scorer paid `floor(basePoints x performanceMultiplier x
 * scoreMultiplier)`. On a level-3 run with a 1.25 run multiplier that is 20h on
 * screen against 25h banked, and the screen's own rows summed to 5h less than
 * the total printed directly beneath them.
 *
 * The overlay reads `multipliedBase` and `mapCeiling` off the breakdown and
 * falls back to its own arithmetic when they are missing. That fallback is
 * exactly the old bug, so it must never be the live path: if the scorer stops
 * reporting either field the screen goes quietly wrong again, with no test
 * failing anywhere near it. Hence a scorer-side guard.
 */
import { describe, it, expect } from "vitest";
import { calculateScore, type ScoreOptions } from "@/lib/scoring";

const opts = (over: Partial<ScoreOptions> = {}): ScoreOptions => ({
  locks: { lockedCapacity: 2, totalCapacity: 4, premiumEarned: 0, premiumAvailable: 4 },
  ...over,
});

describe("what the scorer hands the overview", () => {
  it("reports the base it actually paid, run multiplier included", () => {
    // THE 5h gap. The base is the one term the screen was recomputing, and the
    // run multiplier is the term it was dropping.
    const plain = calculateScore(2, 4, 0, 30, 20, opts());
    const boosted = calculateScore(2, 4, 0, 30, 20, opts({ scoreMultiplier: 1.25 }));

    expect(plain.breakdown.multipliedBase).toBe(20);
    expect(boosted.breakdown.multipliedBase).toBe(25);
    // What the overlay would have printed on its own: the same 20h in both.
    const overlayGuess = Math.floor(20 * boosted.breakdown.performanceMultiplier);
    expect(boosted.breakdown.multipliedBase).not.toBe(overlayGuess);
  });

  it("always reports both fields, so the overlay never falls back", () => {
    for (const mult of [1, 1.25, 2]) {
      const r = calculateScore(3, 5, 10, 40, 30, opts({ scoreMultiplier: mult }));
      expect(r.breakdown.multipliedBase, `no base at x${mult}`).toBeTypeOf("number");
      expect(r.breakdown.mapCeiling, `no ceiling at x${mult}`).toBeTypeOf("number");
    }
  });

  it("offers a ceiling that is the base plus every axis at full", () => {
    const r = calculateScore(2, 4, 0, 30, 20, opts());
    const c = r.breakdown.axes.ceilings;
    expect(r.breakdown.mapCeiling).toBe(
      r.breakdown.multipliedBase!
        + c.delivery + c.craft + c.tempo + c.thrift + c.greed + c.engagement,
    );
  });

  it("counts the Engagement lane in the ceiling on a map that offers it", () => {
    // The lane pays into axes.total, which is the NUMERATOR of "Score: x / y".
    // Left out of mapCeiling it produced the one thing that line exists to
    // prevent - "130 / 110h" - and only on maps carrying a feature, which is
    // most of them and none of the fixtures that predate the axis.
    const bare = calculateScore(2, 4, 0, 30, 20, opts());
    const feature = calculateScore(2, 4, 0, 30, 20, opts({
      engagement: { ratio: 1, offered: true },
    }));

    expect(bare.breakdown.axes.ceilings.engagement, "an unoffered lane has a ceiling").toBe(0);
    expect(feature.breakdown.axes.ceilings.engagement).toBeGreaterThan(0);
    expect(feature.breakdown.mapCeiling!).toBe(
      bare.breakdown.mapCeiling! + feature.breakdown.axes.ceilings.engagement,
    );
    // The guard proper: a run that maxed the lane is still inside its ceiling.
    expect(feature.breakdown.mapCeiling!).toBeGreaterThanOrEqual(feature.levelScore);
  });

  it("never offers a ceiling below what the same run was paid", () => {
    // "56 / 40h" reads as a bug in the player's favour and costs the line its
    // credibility. The overlay floors the denominator as a backstop; the
    // scorer should not be leaning on that backstop in ordinary play.
    for (const [used, par, remaining] of [[1, 4, 0], [2, 4, 5], [4, 4, 20], [7, 4, 30]]) {
      const r = calculateScore(used, par, remaining, 30, 20, opts());
      expect(r.breakdown.mapCeiling, `par ${used}/${par}`).toBeGreaterThanOrEqual(r.levelScore);
    }
  });

  it("grows the ceiling when a build raises an axis ceiling", () => {
    // The denominator is build-dependent on purpose: a player who bought Greed
    // headroom is playing for a bigger map. A fixed y would shrink their run.
    const plain = calculateScore(2, 4, 0, 30, 20, opts());
    const greedy = calculateScore(2, 4, 0, 30, 20, opts({ spaceBonusMultiplier: 2 }));
    expect(greedy.breakdown.mapCeiling!).toBeGreaterThan(plain.breakdown.mapCeiling!);
  });
});
