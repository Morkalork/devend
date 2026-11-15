/**
 * The score multiplier pays on the whole map, not on its 5h base.
 *
 * It used to multiply the base alone, and the result was floored. Every map's
 * base is 5h, so Performance Bonus (x1.05, x1.10, x1.15) floored back to 5 and
 * paid nothing at any tier; Technical Debt Senior and Principal kept their
 * faster balls for at most an hour; the x1.6 Sprint Planning offer paid 3h.
 * Found by the upgrade sweep (UPGRADE_SWEEP_REPORT.md).
 */
import { describe, it, expect } from "vitest";
import { calculateScore, getLockValue, DEFAULT_MAP_BASE_POINTS } from "@/lib/scoring";

const LV = getLockValue();

function pay(scoreMultiplier: number, remaining = 10) {
  return calculateScore(4, 5, remaining, 30, DEFAULT_MAP_BASE_POINTS, {
    scoreMultiplier,
    locks: { totalCapacity: 2 * LV, lockedCapacity: 2 * LV, premiumEarned: 0, premiumAvailable: LV },
    engagement: { ratio: 0, offered: false },
  });
}

describe("the score multiplier", () => {
  it("is measuring a real map: the plain pay is well above the base", () => {
    expect(pay(1).levelScore).toBeGreaterThan(DEFAULT_MAP_BASE_POINTS * 2);
  });

  it.each([1.05, 1.1, 1.15, 1.35, 1.6])("x%s pays that share more on the whole map", (m) => {
    const plain = pay(1).levelScore;
    const boosted = pay(m).levelScore;
    expect(boosted - plain).toBe(Math.round(plain * (m - 1)));
    // The bug in one line: every Performance Bonus tier used to add 0h.
    expect(boosted).toBeGreaterThan(plain);
  });

  it("scales the ceiling with the pay, so Score never reads above its maximum", () => {
    const r = pay(1.6, 0);
    expect(r.breakdown.mapCeiling).toBeGreaterThanOrEqual(r.breakdown.multipliedBase! + r.axes.total);
  });

  it("never deepens a negative pay", () => {
    // Far over par with nothing cleared past the need: a pay at or under zero.
    const harsh = (m: number) => calculateScore(12, 3, 30, 30, DEFAULT_MAP_BASE_POINTS, {
      scoreMultiplier: m, shipEarlyPercent: 0,
    });
    expect(harsh(1.6).levelScore).toBeGreaterThanOrEqual(harsh(1).levelScore);
  });
});
