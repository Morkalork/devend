import { describe, it, expect } from "vitest";
import { calculateScore, getOvertimeCap, DEFAULT_SCORING_CONFIG } from "@/lib/scoring";

// Base-points curve currently produced by the map.yml ramp (Act 1 +3/level
// from 5; Act 2 mover world +6/level from L19's 59). Kept in sync as a guard:
// the economics below must hold for whatever curve map.yml declares.
const CURVE = [
  5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 59,
  66, 72, 78, 84, 90, 96, 102, 108, 114, 120, 126,
];

const HEADROOM = DEFAULT_SCORING_CONFIG.scoring.overtimeCapHeadroom;

// Helper: overtime earned at par (no fence penalty), clearing well past the
// threshold so the +1 space bonus applies. levelNumber no longer affects the cap.
function earnedAtPar(basePoints: number, par = 5, scoreMultiplier = 1) {
  // threshold 30 -> required removal 0.70; remaining 10 -> actual 0.90 (+28% extra => space bonus)
  return calculateScore(par, par, 10, 30, basePoints, scoreMultiplier, 1).levelScore;
}

describe("overtime cap", () => {
  it("scales from the level's own base points, not its number", () => {
    expect(getOvertimeCap(50, HEADROOM)).toBe(100);
    expect(getOvertimeCap(126, HEADROOM)).toBe(252);
  });

  it("never clips the at-par payout of any level on the curve (the old flat-44 bug)", () => {
    for (const base of CURVE) {
      const earned = earnedAtPar(base);
      // at par + space bonus = base + 1, comfortably under the base*headroom cap
      expect(earned).toBe(base + 1);
    }
  });
});

describe("pay grows steadily across the curve", () => {
  it("effective overtime is strictly increasing level to level", () => {
    let prev = -Infinity;
    for (const base of CURVE) {
      const earned = earnedAtPar(base);
      expect(earned).toBeGreaterThan(prev);
      prev = earned;
    }
  });

  it("late levels now out-earn mid levels (regression vs the flat cap)", () => {
    expect(earnedAtPar(CURVE[29])).toBeGreaterThan(earnedAtPar(CURVE[15]));
  });
});

describe("risk pays off within the cap headroom", () => {
  it("a Performance x Technical Debt stack (1.725x) beats the safe payout on a mid level", () => {
    const base = 56; // L18
    const safe = earnedAtPar(base, 5, 1.0);
    const risky = earnedAtPar(base, 5, 1.15 * 1.5);
    expect(risky).toBeGreaterThan(safe);
    // and the full base-game stack still pays out un-clipped (cap = base*2 = 112)
    expect(risky).toBeLessThanOrEqual(getOvertimeCap(base, HEADROOM));
  });
});
