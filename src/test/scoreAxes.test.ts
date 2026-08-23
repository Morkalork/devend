/**
 * The Performance Review: does the economy actually offer a CHOICE?
 *
 * The bug this replaced was not that any one bonus was mistuned. It was
 * structural: every map paid into one 80h pot (all 35 have `points: 20`), lock
 * income is a multiplicative stack that routinely earned two to seven times
 * that, and Ship Early was the only bonus paid above the ceiling. So once a
 * run capped - most of the ladder - tempo was the only lever still connected
 * to the score, and rushing sloppily out-earned a flawless precise run 96h to
 * 80h. The careful player was punished for being careful.
 *
 * These tests are about the property that fixes it, not about any constant:
 * several genuinely different ways to play a map must pay about the same, the
 * run that commits to nothing must pay much less, and none of it may drift as
 * the ladder's ball rosters get richer.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  calculateScore, DEFAULT_SCORING_CONFIG, getAxisCeilings, getLockValue, getLockQuality,
} from "@/lib/scoring";
import {
  bankAxes, deliveryRatio, craftRatio, thriftRatio, greedRatio, tempoRatio, AXIS_NAMES,
} from "@/lib/scoreAxes";

const LV = getLockValue();
const SUP = getLockQuality().superiorMultiplier;
const CEIL = getAxisCeilings(DEFAULT_SCORING_CONFIG);

/** A map as the scorer sees it, plus how the run went. */
interface Run {
  par: number; used: number; threshold: number; remaining: number;
  /** lockMultiplier per ball on the roster. */
  roster: number[];
  /** How many of them were sealed in a superior pocket. */
  superior: number;
  /** Extra quality stacking (colored area, simultaneous cut) as a multiplier. */
  stack?: number;
  /** The Ship Early ladder's awarded percent (0 = took its time). */
  shipEarly?: number;
  /** Push-your-luck and demolition hours. */
  greedBonus?: number;
  /** Balls that never got locked at all. */
  lost?: number;
}

function play(r: Run) {
  const stack = r.stack ?? 1;
  const locked = r.roster.slice(0, r.roster.length - (r.lost ?? 0));
  const totalCapacity = r.roster.reduce((a, m) => a + m * LV, 0);
  const lockedCapacity = locked.reduce((a, m) => a + m * LV, 0);
  // What the pass actually paid, quality stack and all.
  const paid = locked.reduce((a, m, i) => a + m * LV * stack * (i < r.superior ? SUP : 1), 0);
  return calculateScore(r.used, r.par, r.remaining, r.threshold, 20, {
    locks: {
      totalCapacity, lockedCapacity,
      premiumEarned: paid - lockedCapacity,
      premiumAvailable: totalCapacity * (SUP - 1),
    },
    shipEarlyPercent: r.shipEarly ?? 0,
    greedBonus: r.greedBonus ?? 0,
  });
}

/** A mid-ladder map: par 7, must clear 88%, three balls. */
const MID: Omit<Run, "used" | "remaining" | "superior"> =
  { par: 7, threshold: 12, roster: [1, 1, 2] };

const TACTICS: Record<string, Run> = {
  // Slow and exact. Pays for it in fences and banks nothing from tempo.
  perfectionist: { ...MID, used: 8, remaining: 5, superior: 3 },
  // Coarse and fast. No craft at all, but every fence and second saved.
  speedrunner: { ...MID, used: 4, remaining: 11, superior: 0, shipEarly: 30 },
  // Neither pole: some craft, some tempo.
  balanced: { ...MID, used: 7, remaining: 8, superior: 2, shipEarly: 20 },
  // Craft by a different route: two balls in one cut inside a const area.
  zonePlay: { ...MID, used: 8, remaining: 6, superior: 2, stack: 6 },
  // Stays on the board for everything that is left on it.
  greedy: { ...MID, used: 6, remaining: 4, superior: 1, greedBonus: 14 },
};

describe("no route dominates", () => {
  it("pays every committed tactic within a tenth of the others", () => {
    const scores = Object.entries(TACTICS)
      .map(([name, r]) => [name, play(r).levelScore] as const);
    const totals = scores.map(([, v]) => v);
    const lo = Math.min(...totals), hi = Math.max(...totals);
    expect(hi / lo, `spread across ${JSON.stringify(Object.fromEntries(scores))}`)
      .toBeLessThan(1.12);
  });

  /**
   * The specific inversion that started this: a flawless precise run used to
   * lose to a sloppy fast one, 80h to 96h, because the cap ate the precision
   * and Ship Early was paid over the top of it.
   */
  it("no longer pays the sloppy sprint more than the flawless run", () => {
    const precise = play(TACTICS.perfectionist).levelScore;
    const sprint = play(TACTICS.speedrunner).levelScore;
    expect(Math.abs(precise - sprint), `precise ${precise}h vs sprint ${sprint}h`)
      .toBeLessThanOrEqual(Math.round(precise * 0.08));
  });

  /**
   * The stated loss condition: took too long AND never sealed anything tight.
   * It must not merely pay a little less, it must clearly be the bad outcome.
   */
  it("pays the run that committed to nothing far less", () => {
    const drifter = play({ ...MID, used: 9, remaining: 11, superior: 0 }).levelScore;
    const best = Math.max(...Object.values(TACTICS).map(r => play(r).levelScore));
    expect(drifter).toBeLessThan(best * 0.6);
  });

  /**
   * The economy's founding rule, which the style axes could otherwise have
   * quietly repealed: Tempo, Thrift and Greed all measure HOW you cleared and
   * none of them needs a ball sealed, so a fast frugal greedy run that locked
   * nothing would have banked three full axes. Delivery gates them.
   */
  /**
   * The spread test above is necessary but not sufficient, and the gap between
   * them is exactly the bug being fixed: a binding ceiling makes every tactic
   * EQUAL by clipping them all to the same number, which reads as flawless
   * balance right up until you notice nobody is being paid for anything. So
   * check that each tactic actually banks what it earned.
   */
  it("pays every tactic what it earned, clipping none of it", () => {
    for (const [name, r] of Object.entries(TACTICS)) {
      const out = play(r);
      const base = Math.floor(20 * out.breakdown.performanceMultiplier);
      expect(out.levelScore, `${name} lost hours to a ceiling`).toBe(base + out.axes.total);
    }
  });

  /** Under a binding cap, improving an already-capped run pays nothing. */
  it("still pays more for a strictly better run at the top end", () => {
    const good = play({ ...MID, used: 7, remaining: 6, superior: 2, shipEarly: 20 });
    const better = play({ ...MID, used: 6, remaining: 4, superior: 3, shipEarly: 20 });
    expect(better.levelScore).toBeGreaterThan(good.levelScore);
  });

  it("pays a clear-only run its flat base and nothing else", () => {
    const bare = play({ ...MID, roster: [1, 1, 2], lost: 3, used: 3, remaining: 2, superior: 0, shipEarly: 30 });
    expect(bare.axes.total).toBe(0);
    expect(bare.levelScore).toBeLessThan(25);
  });

  it("does not gate a map that has no lock capacity to deliver", () => {
    // A missing denominator means the map does not offer the axis, not that the
    // run failed at it. Gating here would zero the style axes on any map with
    // no balls and, more practically, on every scoring preview.
    const r = play({ ...MID, roster: [], used: 4, remaining: 4, superior: 0, shipEarly: 30 });
    expect(r.axes.tempo).toBeGreaterThan(0);
  });

  it("docks the style axes in proportion to the balls left loose", () => {
    const run = { ...MID, used: 4, remaining: 4, superior: 0, shipEarly: 30 };
    const all = play(run);
    // The x2 ball is the one dropped: 24h of 48h capacity, so half the roster.
    const half = play({ ...run, lost: 1 });
    expect(half.axes.tempo).toBe(Math.round(all.axes.tempo / 2));
    expect(half.axes.thrift).toBe(Math.round(all.axes.thrift / 2));
  });
});

/**
 * Every axis is a fraction of what THIS map could give, which is what lets one
 * set of ceilings cover a 1-ball map holding 12h of lock capacity and a 4-ball
 * act-III map holding 240h.
 */
describe("the same play is worth the same on every rung", () => {
  const RUNGS: Array<[number, Run]> = [
    [3, { par: 4, threshold: 30, roster: [1, 1], used: 0, remaining: 0, superior: 0 }],
    [9, { par: 6, threshold: 16, roster: [1, 1, 2], used: 0, remaining: 0, superior: 0 }],
    [22, { par: 7, threshold: 12, roster: [1, 2, 3], used: 0, remaining: 0, superior: 0 }],
    [29, { par: 9, threshold: 7, roster: [2, 3, 3, 4], used: 0, remaining: 0, superior: 0 }],
  ];
  const precise = (m: Run) =>
    play({ ...m, used: m.par + 1, remaining: Math.round(m.threshold * 0.35), superior: m.roster.length });
  const sprint = (m: Run) =>
    play({ ...m, used: Math.max(1, m.par - 3), remaining: m.threshold - 1, superior: 0, shipEarly: 30 });

  it("pays a perfect precision run the same at level 3 and level 29", () => {
    const vals = RUNGS.map(([, m]) => precise(m).levelScore);
    expect(Math.max(...vals) - Math.min(...vals), `got ${vals}`).toBeLessThanOrEqual(3);
  });

  it("keeps the two poles level on every rung, not just the mid-ladder one", () => {
    for (const [lv, m] of RUNGS) {
      const a = precise(m).levelScore, b = sprint(m).levelScore;
      expect(Math.abs(a - b), `level ${lv}: precise ${a}h vs sprint ${b}h`).toBeLessThanOrEqual(12);
    }
  });

  /**
   * The old ceiling was flat at 80h while lock capacity ran from 12h to 240h,
   * so a richer roster made a map pay LESS of what it earned, not more.
   */
  it("does not quietly pay a 4-ball map less of what it earned", () => {
    const kept = (m: Run) => {
      const r = precise(m);
      return r.axes.delivery / Math.max(1, r.axes.ceilings.delivery);
    };
    for (const [lv, m] of RUNGS) expect(kept(m), `level ${lv}`).toBeCloseTo(1, 5);
  });
});

describe("each axis is banked against its own ceiling", () => {
  it("never lets one axis spend another's headroom", () => {
    // Craft stacked six ways over still cannot take a single hour from Tempo.
    const modest = play({ ...MID, used: 7, remaining: 8, superior: 1, shipEarly: 30 });
    const stacked = play({ ...MID, used: 7, remaining: 8, superior: 3, stack: 6, shipEarly: 30 });
    expect(stacked.axes.craft).toBeGreaterThan(modest.axes.craft);
    expect(stacked.axes.tempo).toBe(modest.axes.tempo);
    expect(stacked.axes.thrift).toBe(modest.axes.thrift);
  });

  it("caps every axis at its ceiling however hard the stack is pushed", () => {
    const r = play({ ...MID, used: 1, remaining: 0, superior: 3, stack: 50, shipEarly: 30, greedBonus: 500 });
    for (const axis of AXIS_NAMES) {
      expect(r.axes[axis], axis).toBeLessThanOrEqual(r.axes.ceilings[axis]);
    }
  });

  it("reports a total that is exactly the five axes", () => {
    const r = play(TACTICS.balanced);
    const sum = AXIS_NAMES.reduce((a, k) => a + r.axes[k], 0);
    expect(r.axes.total).toBe(sum);
  });
});

/**
 * Both replaced ladders were unreachable at the far end of the ladder, in
 * opposite ways. These pin the fixes.
 */
describe("the ratios are reachable on every map", () => {
  it("lets Greed be earned at level 29's 93% requirement", () => {
    // The old ladder measured overshoot against the REQUIREMENT: at 93% the
    // whole remaining slack is 7%, so its 30% and 55% rungs were impossible.
    const required = 0.93;
    expect(greedRatio(required + 0.05, required)).toBeGreaterThan(0.9);
    expect(greedRatio(0.99, required)).toBe(1);
  });

  it("lets Thrift be earned on a par-3 map as well as a par-10 one", () => {
    // The old ladder's top rung wanted four fences under par, which on a par-3
    // map means finishing in minus one cut.
    expect(thriftRatio(1, 3)).toBeGreaterThan(0.9);
    expect(thriftRatio(6, 10)).toBeGreaterThan(0.9);
  });

  it("scores Tempo on its own ladder, not as a slice of the rest", () => {
    // Paying a percent of total earnings penalised the speedrunner twice: they
    // bank little Craft, so a percentage of their total was small.
    expect(tempoRatio(30, 30)).toBe(1);
    expect(tempoRatio(10, 30)).toBeCloseTo(1 / 3, 5);
  });
});

describe("the ratio helpers hold at their edges", () => {
  it("treats a map that cannot offer an axis as neutral, not failed", () => {
    expect(deliveryRatio(0, 0)).toBe(0);
    expect(craftRatio(10, 0)).toBe(0);
    expect(thriftRatio(3, 0)).toBe(0);
    expect(greedRatio(0.9, 1)).toBe(0);
  });

  it("never returns a ratio outside 0..1", () => {
    for (const v of [deliveryRatio(999, 10), craftRatio(999, 10), thriftRatio(-50, 4),
                     greedRatio(2, 0.5), tempoRatio(999, 30)]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("survives NaN leaking in from a bad config", () => {
    const r = bankAxes({
      lockedCapacity: NaN, totalCapacity: NaN, premiumEarned: NaN, premiumAvailable: NaN,
      usedFences: NaN, parFences: NaN, actualRemovedRatio: NaN, requiredRemovedRatio: NaN,
      shipEarlyPercent: NaN, shipEarlyMaxPercent: NaN,
    }, CEIL);
    for (const axis of AXIS_NAMES) expect(Number.isFinite(r[axis]), axis).toBe(true);
    expect(r.total).toBe(0);
  });

  it("switches Greed off at 3+ over par, as the space bonus always did", () => {
    const on = play({ ...MID, used: 9, remaining: 4, superior: 1 });
    const off = play({ ...MID, used: 10, remaining: 4, superior: 1 });
    expect(on.axes.greed).toBeGreaterThan(0);
    expect(off.axes.greed).toBe(0);
  });
});

describe("upgrades buy a lane, not a payout", () => {
  const thriftWith = (r: Run, mult: number) => {
    const totalCapacity = r.roster.reduce((a, m) => a + m * LV, 0);
    const paid = r.roster.reduce((a, m, i) => a + m * LV * (i < r.superior ? SUP : 1), 0);
    return calculateScore(r.used, r.par, r.remaining, r.threshold, 20, {
      locks: {
        totalCapacity, lockedCapacity: totalCapacity,
        premiumEarned: paid - totalCapacity, premiumAvailable: totalCapacity * (SUP - 1),
      },
      underParBonusMultiplier: mult,
    }).axes.thrift;
  };

  /**
   * The point of moving upgrade multipliers onto CEILINGS: Overdelivery on a
   * run you never took under par is dead weight, and that is the trade a build
   * is supposed to be making. Under the old additive pot it just added hours
   * that the cap then ate anyway.
   */
  it("does nothing for a run that never went under par", () => {
    const atPar: Run = { ...MID, used: 7, remaining: 8, superior: 1 };
    expect(thriftWith(atPar, 1)).toBe(0);
    expect(thriftWith(atPar, 2)).toBe(0);
  });

  it("pays a lane you actually played", () => {
    const under: Run = { ...MID, used: 5, remaining: 8, superior: 1 };
    expect(thriftWith(under, 2)).toBeGreaterThan(thriftWith(under, 1));
  });
});

/**
 * Every axis label and hold-card the results screen asks for must exist in all
 * three locales, or a player sees a raw key where the tactic's name should be.
 */
describe("the axes are named in every locale", () => {
  const LOCALES = ["en", "es", "sv"] as const;
  const load = (loc: string) => JSON.parse(
    readFileSync(resolve(__dirname, `../i18n/locales/${loc}.json`), "utf8"),
  ) as { levelComplete: Record<string, Record<string, unknown>> };

  it.each(LOCALES)("%s names all five axes", (loc) => {
    const axes = load(loc).levelComplete.axes as Record<string, string>;
    expect(axes?.title, "block heading").toBeTruthy();
    for (const name of AXIS_NAMES) expect(axes?.[name], name).toBeTruthy();
  });

  it.each(LOCALES)("%s explains all five axes on hold", (loc) => {
    const info = load(loc).levelComplete.info as Record<string, Record<string, string>>;
    for (const name of AXIS_NAMES) {
      const card = info?.[`axis_${name}`];
      expect(card, `axis_${name}`).toBeTruthy();
      for (const part of ["title", "body", "tip"]) expect(card?.[part], `${name}.${part}`).toBeTruthy();
    }
  });

  /** The project rule: no em-dashes anywhere a player can read them. */
  it.each(LOCALES)("%s keeps em-dashes out of the new strings", (loc) => {
    const lc = load(loc).levelComplete;
    const text = JSON.stringify([lc.axes, (lc.info as Record<string, unknown>)]);
    expect(text.includes("—"), "em-dash in a user-facing axis string").toBe(false);
  });
});

/**
 * Hard Deadline advertises a doubled tempo reward. Under the axis model it has
 * to raise the CEILING: inflating the ladder percent instead would clamp
 * against the top rung and the upgrade would do nothing at the very window a
 * player buys it for.
 */
describe("Hard Deadline", () => {
  const fast = (mult: number) => calculateScore(7, 7, 8, 12, 20, {
    locks: { totalCapacity: 48, lockedCapacity: 48, premiumEarned: 0, premiumAvailable: 48 },
    shipEarlyPercent: 30, tempoCeilingMultiplier: mult,
  }).axes.tempo;

  it("doubles the tempo payout at the very top rung", () => {
    expect(fast(2)).toBe(fast(1) * 2);
  });

  it("pays the plain ceiling without it", () => {
    expect(fast(1)).toBe(CEIL.tempo);
  });
});

/**
 * The YAML is what ships; DEFAULT_SCORING_CONFIG is only the fallback for a
 * failed fetch. If they drift, every test in this file is measuring a balance
 * the game does not actually run.
 */
describe("the shipped config is the config these tests measure", () => {
  const YAML = yaml.load(
    readFileSync(resolve(__dirname, "../../public/scoring-config.yml"), "utf8"),
  ) as { scoring: { axes: Record<string, number> } };

  it("declares the same axis ceilings as the fallback", () => {
    const shipped = YAML.scoring.axes;
    for (const name of AXIS_NAMES) expect(shipped[name], name).toBe(CEIL[name]);
    expect(shipped.thriftFullAtParFraction).toBe(CEIL.thriftFullAtParFraction);
    expect(shipped.greedFullAtSlackFraction).toBe(CEIL.greedFullAtSlackFraction);
  });

  it("keeps the backstop clear of a full set of axes on every shipped map", () => {
    const maps = yaml.load(
      readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
    ) as { levels: { level?: number; points: number }[] };
    const headroom = (yaml.load(
      readFileSync(resolve(__dirname, "../../public/scoring-config.yml"), "utf8"),
    ) as { scoring: { overtimeCapHeadroom: number } }).scoring.overtimeCapHeadroom;
    const axisTotal = AXIS_NAMES.reduce((a, k) => a + CEIL[k], 0);
    for (const m of maps.levels) {
      const backstop = Math.round(m.points * headroom) + axisTotal;
      expect(m.points + axisTotal, `level ${m.level}`).toBeLessThan(backstop);
    }
  });
});
