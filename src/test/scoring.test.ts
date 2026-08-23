import { describe, it, expect } from "vitest";
import {
  calculateScore,
  calculateShipEarlyPercent,
  getPerformanceMultiplier,
  getOvertimeCap,
  getAxisCeilings,
  axisCeilingTotal,
  DEFAULT_SCORING_CONFIG,
} from "@/lib/scoring";

// The Thrift and Greed ladders live in scoreAxes.test.ts now; this file covers
// the scoring FUNCTION around them - the backstop, the base curve, the Ship
// Early ladder and the performance multiplier.

// A representative range of base-point values used to exercise the scoring
// FUNCTION (its cap and monotonicity in basePoints). This is independent of
// map.yml, which since issue #43 declares a FLAT per-map base (every map pays
// in the same band); these values just probe calculateScore across inputs.
const CURVE = [
  5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41, 44, 47, 50, 53, 56, 59,
  66, 72, 78, 84, 90, 96, 102, 108, 114, 120, 126,
];

const HEADROOM = DEFAULT_SCORING_CONFIG.scoring.overtimeCapHeadroom;

const GREED_CEILING = getAxisCeilings(DEFAULT_SCORING_CONFIG).greed;

// Overtime earned at par (no fence penalty), clearing well past the threshold.
// threshold 30 -> required 0.70, remaining 10 -> actual 0.90: two thirds of the
// leftover slack, which fills the Greed axis. No balls, so no lock axes.
function earnedAtPar(basePoints: number, par = 5, scoreMultiplier = 1) {
  return calculateScore(par, par, 10, 30, basePoints, { scoreMultiplier }).levelScore;
}

/**
 * The backstop, which is all the old per-map cap is now.
 *
 * At 4.0 headroom it was the binding ceiling on every map (80h, since all 35
 * have `points: 20`), and lock income is a multiplicative stack that routinely
 * earned two to seven times that. Everything over the brim was discarded, and
 * because Ship Early was the only bonus paid ABOVE it, tempo was the only lever
 * still connected to a capped run's score. The five axes bound the payout now;
 * this only catches a runaway config or upgrade stack.
 */
describe("the backstop", () => {
  it("scales from the level's own base points, not its number", () => {
    expect(getOvertimeCap(50, HEADROOM)).toBe(Math.round(50 * HEADROOM));
    expect(getOvertimeCap(126, HEADROOM)).toBe(Math.round(126 * HEADROOM));
  });

  /**
   * The axes are absolute hours and the base is per-map, so the backstop has to
   * clear them both. Clamping the sum against a multiple of basePoints alone
   * would clip axis income on any low-`points:` map, which is the exact bug the
   * rework exists to remove.
   */
  it("never clips a full set of axes, at any base value", () => {
    for (const base of CURVE) {
      const full = calculateScore(1, 20, 0, 30, base, {
        locks: { totalCapacity: 240, lockedCapacity: 240, premiumEarned: 240, premiumAvailable: 240 },
        shipEarlyPercent: 30, greedBonus: 100,
      });
      expect(full.levelScore, `base ${base}`)
        .toBeGreaterThanOrEqual(axisCeilingTotal(DEFAULT_SCORING_CONFIG));
    }
  });

  it("still clamps a runaway flat stack", () => {
    const base = 40;
    const ceiling = getOvertimeCap(base, HEADROOM) + axisCeilingTotal(DEFAULT_SCORING_CONFIG);
    expect(calculateScore(5, 5, 10, 30, base, { flatBonus: 10_000 }).levelScore).toBe(ceiling);
  });

  it("never clips the at-par payout of any level on the curve", () => {
    for (const base of CURVE) {
      expect(earnedAtPar(base)).toBe(base + GREED_CEILING);
    }
  });

  /**
   * Demolition scales DELIVERY and CRAFT rather than the whole payout: the time
   * spent smashing things came out of Tempo, so the offset belongs on the axes
   * it was traded for.
   */
  it("demolition multiplier lifts the lock axes and nothing else (#38)", () => {
    const base = 40;
    const locks = { totalCapacity: 48, lockedCapacity: 48, premiumEarned: 24, premiumAvailable: 48 };
    const plain = calculateScore(5, 5, 10, 30, base, { locks, shipEarlyPercent: 20 });
    const boosted = calculateScore(5, 5, 10, 30, base, { locks, shipEarlyPercent: 20, payoutMultiplier: 1.15 });
    expect(boosted.axes.craft).toBeGreaterThan(plain.axes.craft);
    expect(boosted.axes.tempo).toBe(plain.axes.tempo);
    expect(boosted.axes.greed).toBe(plain.axes.greed);
    // Default is byte-identical to omitting the option.
    expect(calculateScore(5, 5, 10, 30, base, { locks, payoutMultiplier: 1 }).levelScore)
      .toBe(calculateScore(5, 5, 10, 30, base, { locks }).levelScore);
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

describe("par bites: the over-par penalty", () => {
  const cfg = DEFAULT_SCORING_CONFIG;

  it("penalises the base harder for each fence over par", () => {
    const mult = (used: number) => getPerformanceMultiplier(used, 5, cfg).multiplier;
    expect(mult(5)).toBe(1.0); // at par
    expect(mult(4)).toBe(1.0); // under par: full base (the bonus, not the multiplier, rewards it)
    expect(mult(6)).toBe(0.6); // 1 over
    expect(mult(7)).toBe(0.4); // 2 over
    expect(mult(9)).toBe(0.2); // 3+ over
  });
});

describe("ship early percent ladder rewards fast clears", () => {
  const cfg = DEFAULT_SCORING_CONFIG;
  // Default per-ball ladder: 6s -> 30%, 10s -> 20%, 15s -> 10% (per ball).
  const at = (seconds: number | null | undefined, balls = 1) => calculateShipEarlyPercent(seconds, balls, cfg);

  it("pays the best rung whose per-ball window was met (1 ball)", () => {
    expect(at(3)).toBe(30);
    expect(at(6)).toBe(30);     // boundary is inclusive
    expect(at(6.01)).toBe(20);
    expect(at(10)).toBe(20);
    expect(at(10.5)).toBe(10);
    expect(at(15)).toBe(10);
  });

  it("scales the windows with the map's ball count (15s per ball)", () => {
    // A 4-ball map: 24s -> 30%, 40s -> 20%, 60s -> 10%.
    expect(at(24, 4)).toBe(30);
    expect(at(24.01, 4)).toBe(20);
    expect(at(40, 4)).toBe(20);
    expect(at(60, 4)).toBe(10);
    expect(at(60.1, 4)).toBe(0);
    // A 2-ball map halves that: 30s is the last window.
    expect(at(30, 2)).toBe(10);
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
    expect(calculateShipEarlyPercent(8, 1, cfg, 2)).toBe(30);
    expect(calculateShipEarlyPercent(8.01, 1, cfg, 2)).toBe(20);
    expect(calculateShipEarlyPercent(17, 1, cfg, 2)).toBe(10);
    expect(calculateShipEarlyPercent(17.1, 1, cfg, 2)).toBe(0);
    // Scales with ball count: 4 balls at +6s/ball -> last window 84s.
    expect(calculateShipEarlyPercent(84, 4, cfg, 6)).toBe(10);
    expect(calculateShipEarlyPercent(84.1, 4, cfg, 6)).toBe(0);
    // Garbage extension is ignored.
    expect(calculateShipEarlyPercent(15, 1, cfg, NaN)).toBe(10);
    expect(calculateShipEarlyPercent(15.1, 1, cfg, -3)).toBe(0);
  });

  it("Hard Deadline scales the percent without unlocking higher rungs", () => {
    // x2 applies AFTER the maxPercent clamp: 30 -> 60, 20 -> 40, 10 -> 20, 0 stays 0.
    expect(calculateShipEarlyPercent(6, 1, cfg, 0, 2)).toBe(60);
    expect(calculateShipEarlyPercent(10, 1, cfg, 0, 2)).toBe(40);
    expect(calculateShipEarlyPercent(15, 1, cfg, 0, 2)).toBe(20);
    expect(calculateShipEarlyPercent(15.1, 1, cfg, 0, 2)).toBe(0);
    // Stacks with Deadline Extension: widened window, then scaled percent.
    expect(calculateShipEarlyPercent(8, 1, cfg, 2, 2)).toBe(60);
    // Garbage multipliers are ignored.
    expect(calculateShipEarlyPercent(6, 1, cfg, 0, NaN)).toBe(30);
    expect(calculateShipEarlyPercent(6, 1, cfg, 0, -2)).toBe(30);
    expect(calculateShipEarlyPercent(6, 1, cfg, 0, 0)).toBe(30);
  });

  it("guards against a bad ball count (treated as 1 ball)", () => {
    expect(at(6, 0)).toBe(30);
    expect(at(6, NaN)).toBe(30);
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

  it("clamps to maxPercent with a hot config", () => {
    const hot = {
      scoring: {
        ...cfg.scoring,
        shipEarly: { maxPercent: 20, thresholds: [{ withinSecondsPerBall: 30, percent: 99 }] },
      },
    };
    expect(calculateShipEarlyPercent(10, 1, hot)).toBe(20);
  });

  /**
   * Tempo is its own axis now, scored against the ladder's top rung. It used to
   * pay a percent of the whole earned payout ABOVE the per-map cap, which is
   * what made speed dominant: once a run capped it was the only bonus still
   * connected to the score. It also double-penalised the player it rewards, a
   * speedrunner banking little Craft getting a percentage of a small total.
   */
  it("banks Tempo on its own ladder, not as a slice of the rest", () => {
    const base = 40;
    const ceiling = getAxisCeilings(DEFAULT_SCORING_CONFIG).tempo;
    const top = calculateScore(5, 5, 10, 30, base, { shipEarlyPercent: 30 });
    expect(top.axes.tempo).toBe(ceiling);
    expect(top.shipEarlyBonus).toBe(ceiling);
    // A third of the ladder pays a third of the axis.
    expect(calculateScore(5, 5, 10, 30, base, { shipEarlyPercent: 10 }).axes.tempo)
      .toBe(Math.round(ceiling / 3));
    // And a rich lock haul does not change what being fast was worth.
    const withLocks = calculateScore(5, 5, 10, 30, base, {
      shipEarlyPercent: 30,
      locks: { totalCapacity: 240, lockedCapacity: 240, premiumEarned: 240, premiumAvailable: 240 },
    });
    expect(withLocks.axes.tempo).toBe(ceiling);
  });
});

describe("risk pays off within the cap headroom", () => {
  it("a Performance x Technical Debt stack (1.725x) beats the safe payout on a mid level", () => {
    const base = 56; // L18
    const safe = earnedAtPar(base, 5, 1.0);
    const risky = earnedAtPar(base, 5, 1.15 * 1.5);
    expect(risky).toBeGreaterThan(safe);
    // and the full base-game stack still pays out un-clipped.
    expect(risky).toBeLessThanOrEqual(getOvertimeCap(base, HEADROOM));
  });
});
