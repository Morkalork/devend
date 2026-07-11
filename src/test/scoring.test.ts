import { describe, it, expect } from "vitest";
import {
  calculateScore,
  calculateSpaceBonus,
  calculateShipEarlyBonus,
  getOvertimeCap,
  DEFAULT_SCORING_CONFIG,
} from "@/lib/scoring";

// A representative range of base-point values used to exercise the scoring
// FUNCTION (its cap and monotonicity in basePoints). This is independent of
// map.yml, which since issue #43 declares a FLAT per-map base (every map pays
// in the same band); these values just probe calculateScore across inputs.
const CURVE = [
  5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 59,
  66, 72, 78, 84, 90, 96, 102, 108, 114, 120, 126,
];

const HEADROOM = DEFAULT_SCORING_CONFIG.scoring.overtimeCapHeadroom;

// Helper: overtime earned at par (no fence penalty), clearing well past the
// threshold so the +1 space bonus applies.
function earnedAtPar(basePoints: number, par = 5, scoreMultiplier = 1) {
  // threshold 30 -> required removal 0.70; remaining 10 -> actual 0.90 (+28% extra => space bonus)
  return calculateScore(par, par, 10, 30, basePoints, { scoreMultiplier }).levelScore;
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

  it("folds lock/push bonuses in UNDER the cap so one map can't exceed it (#43)", () => {
    const base = 40; // the flat per-map base
    const cap = getOvertimeCap(base, HEADROOM); // 80
    // A huge lock/push stack passed as extraBonus is clamped to the cap, not
    // added on top of it (the old hyperinflation path).
    const huge = calculateScore(5, 5, 10, 30, base, { extraBonus: 10_000 }).levelScore;
    expect(huge).toBe(cap);
    // A modest bonus still lands under the cap and is counted.
    const modest = calculateScore(5, 5, 10, 30, base, { extraBonus: 10 }).levelScore;
    expect(modest).toBe(Math.min(cap, base + 1 + 10));
    // Stock Options capstone: the cap itself can be raised, so the same huge
    // stack clamps to the raised ceiling instead.
    const raised = calculateScore(5, 5, 10, 30, base, { extraBonus: 10_000, overtimeCapBonus: 20 }).levelScore;
    expect(raised).toBe(cap + 20);
  });
});

describe("pay scales with base points (scoring function, not the flat map)", () => {
  // The map is flat since #43, but the scoring function must still respond
  // monotonically to basePoints so a higher flat base (or a future tweak)
  // always pays more, never less.
  it("effective overtime is strictly increasing in base points", () => {
    let prev = -Infinity;
    for (const base of CURVE) {
      const earned = earnedAtPar(base);
      expect(earned).toBeGreaterThan(prev);
      prev = earned;
    }
  });

  it("a higher base always out-earns a lower one", () => {
    expect(earnedAtPar(CURVE[29])).toBeGreaterThan(earnedAtPar(CURVE[15]));
  });
});

describe("space bonus ladder rewards clearing more", () => {
  const cfg = DEFAULT_SCORING_CONFIG;
  // extraPercent = (actual - required) / required. Keep required = 0.50 so the
  // arithmetic is easy to read: actual = required * (1 + extraPercent).
  const REQ = 0.5;
  const atExtra = (extraPercent: number) =>
    calculateSpaceBonus(REQ * (1 + extraPercent), REQ, 0, cfg);

  it("pays nothing below the first rung", () => {
    expect(atExtra(0.05).bonus).toBe(0);
  });

  it("climbs through each configured rung as overcut grows", () => {
    expect(atExtra(0.10).bonus).toBe(1); // +10% over required
    expect(atExtra(0.30).bonus).toBe(2); // +30%
    expect(atExtra(0.55).bonus).toBe(3); // +55%
  });

  it("is monotonic: more space removed never pays less", () => {
    let prev = -Infinity;
    for (const e of [0, 0.05, 0.1, 0.2, 0.3, 0.45, 0.55, 0.9]) {
      const b = atExtra(e).bonus;
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it("never exceeds maxBonus even for near-total clears", () => {
    expect(atExtra(2.0).bonus).toBe(cfg.scoring.spaceOptimization.maxBonus);
  });

  it("is disabled when 3+ fences over par, but still reports the raw rung", () => {
    const big = calculateSpaceBonus(REQ * 1.55, REQ, 3, cfg);
    expect(big.bonus).toBe(0);
    expect(big.bonusRaw).toBe(3);
  });
});

describe("ship early bonus ladder rewards fast clears", () => {
  const cfg = DEFAULT_SCORING_CONFIG;
  // Default per-ball ladder: 6s -> +3, 10s -> +2, 15s -> +1 (per ball).
  const at = (seconds: number | null | undefined, balls = 1) => calculateShipEarlyBonus(seconds, balls, cfg);

  it("pays the best rung whose per-ball window was met (1 ball)", () => {
    expect(at(3)).toBe(3);
    expect(at(6)).toBe(3);     // boundary is inclusive
    expect(at(6.01)).toBe(2);
    expect(at(10)).toBe(2);
    expect(at(10.5)).toBe(1);
    expect(at(15)).toBe(1);
  });

  it("scales the windows with the map's ball count (15s per ball)", () => {
    // A 4-ball map: 24s -> +3, 40s -> +2, 60s -> +1.
    expect(at(24, 4)).toBe(3);
    expect(at(24.01, 4)).toBe(2);
    expect(at(40, 4)).toBe(2);
    expect(at(60, 4)).toBe(1);
    expect(at(60.1, 4)).toBe(0);
    // A 2-ball map halves that: 30s is the last window.
    expect(at(30, 2)).toBe(1);
    expect(at(30.1, 2)).toBe(0);
  });

  it("pays nothing past the last window or without a recorded clear time", () => {
    expect(at(15.1)).toBe(0);
    expect(at(300)).toBe(0);
    expect(at(null)).toBe(0);
    expect(at(undefined)).toBe(0);
    expect(at(-5)).toBe(0);
    expect(at(NaN)).toBe(0);
  });

  it("Deadline Extension widens every window by its per-ball seconds", () => {
    // +2s/ball: 1-ball windows become 8/12/17.
    expect(calculateShipEarlyBonus(8, 1, cfg, 2)).toBe(3);
    expect(calculateShipEarlyBonus(8.01, 1, cfg, 2)).toBe(2);
    expect(calculateShipEarlyBonus(17, 1, cfg, 2)).toBe(1);
    expect(calculateShipEarlyBonus(17.1, 1, cfg, 2)).toBe(0);
    // Scales with ball count: 4 balls at +6s/ball -> last window 84s.
    expect(calculateShipEarlyBonus(84, 4, cfg, 6)).toBe(1);
    expect(calculateShipEarlyBonus(84.1, 4, cfg, 6)).toBe(0);
    // Garbage extension is ignored.
    expect(calculateShipEarlyBonus(15, 1, cfg, NaN)).toBe(1);
    expect(calculateShipEarlyBonus(15.1, 1, cfg, -3)).toBe(0);
  });

  it("guards against a bad ball count (treated as 1 ball)", () => {
    expect(at(6, 0)).toBe(3);
    expect(at(6, NaN)).toBe(3);
    expect(at(15.1, 0)).toBe(0);
  });

  it("is monotonic non-increasing in time (slower never pays more)", () => {
    let prev = Infinity;
    for (const s of [0, 3, 6, 7, 10, 11, 15, 16, 60]) {
      const b = at(s);
      expect(b).toBeLessThanOrEqual(prev);
      prev = b;
    }
  });

  it("clamps to maxBonus with a hot config", () => {
    const hot = {
      scoring: {
        ...cfg.scoring,
        shipEarly: { maxBonus: 2, thresholds: [{ withinSecondsPerBall: 30, bonus: 99 }] },
      },
    };
    expect(calculateShipEarlyBonus(10, 1, hot)).toBe(2);
  });

  it("folds under the per-map cap like lock/push bonuses (#43)", () => {
    const base = 40;
    const cap = getOvertimeCap(base, HEADROOM); // 80
    const shipEarly = calculateShipEarlyBonus(5, 1, cfg); // 3
    // Even riding a huge lock stack, the total clamps at the cap.
    const capped = calculateScore(5, 5, 10, 30, base, { extraBonus: 10_000 + shipEarly }).levelScore;
    expect(capped).toBe(cap);
    // A normal run counts it in full under the cap.
    const normal = calculateScore(5, 5, 10, 30, base, { extraBonus: shipEarly }).levelScore;
    expect(normal).toBe(base + 1 + shipEarly);
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
