/**
 * The level-complete screen must add up to the payout (issue #79).
 *
 * Reported as "it says I got 146 score, but I get 137 overtime hours". The
 * exact pair could not be reproduced from the report alone, but reading the
 * screen against the scorer turned up the reason a player cannot reconcile it,
 * and it is not one bug but three of the same shape - hours in the payout that
 * the column does not account for:
 *
 *   NO ROW AT ALL   Bumper hours and power-up hours are paid (postCapBonus),
 *                   and were rendered nowhere. So were Comp Time / Stock
 *                   Options (flatBonus) and Qualified Overtime, which is paid
 *                   above the backstop.
 *   WRONG SIDE      The win premium and the highscore bonus DID have rows, but
 *                   above the "Score" line, whose numerator excludes both. Read
 *                   down the column and the last number before the payout was
 *                   already missing them.
 *   NO CLAMP ROW    When the backstop clipped the total, nothing said so.
 *
 * So this file pins the identity the screen now claims, against the scorer
 * rather than against itself:
 *
 *     Score  +  every "paid on top" row  -  what the cap clipped  ==  payout
 *
 * The arithmetic is duplicated here on purpose. Importing the component would
 * mean rendering it, and what can break is not the render: it is a new income
 * term added to calculateScore and to no row, which is exactly what happened
 * three times over. A test that walks the scorer's own terms notices that.
 */
import { describe, it, expect } from "vitest";
import { calculateScore, getLockValue, getLockQuality, DEFAULT_MAP_BASE_POINTS } from "@/lib/scoring";

const LV = getLockValue(), SUP = getLockQuality().superiorMultiplier;

interface Play {
  cuts: number; par: number; remaining: number; threshold: number; balls: number;
  quality: number; ship: number; zoneMissed: number; scoreMult: number; winPct: number;
  capBonus: number; postCap: number; qualified: number; base: number;
}

function score(p: Play) {
  const cap = p.balls * LV;
  return calculateScore(p.cuts, p.par, p.remaining, p.threshold, p.base, {
    locks: {
      totalCapacity: cap, lockedCapacity: cap,
      premiumEarned: cap * p.quality, premiumAvailable: cap * (SUP - 1),
    },
    engagement: { ratio: 1, offered: true },
    shipEarlyPercent: p.ship,
    scoreMultiplier: p.scoreMult,
    winBonusPercent: p.winPct,
    zoneShareMissed: p.zoneMissed,
    capRaise: p.capBonus,
    postCapBonus: p.postCap,
    qualifiedOvertime: p.qualified,
  });
}

/** The overlay's Score row, and the rows it now renders beneath it. */
function screen(p: Play, highscoreBonus = 0) {
  const r = score(p);
  const b = r.breakdown as unknown as { multipliedBase?: number; zoneShareWithheld?: number };
  const paidBase = Math.round(b.multipliedBase ?? 0);
  const zonesMissedCost = Math.max(0, Math.round(b.zoneShareWithheld ?? 0));
  const scoreRow = Math.max(0, Math.round(paidBase + r.axes.total - zonesMissedCost));
  // Exactly the rows the overlay builds, in the same order. The cap raise is
  // deliberately absent: it is not income, it lifts the ceiling.
  const onTop = [r.winBonus, highscoreBonus, p.postCap, r.qualifiedOvertime]
    .filter(h => h > 0)
    .reduce((sum, h) => sum + h, 0);
  // The payout as the player banks it: the scorer's, plus the highscore bonus
  // that useGameSession adds on top before the overlay is handed it.
  const payout = r.levelScore + highscoreBonus;
  const clipped = Math.max(0, scoreRow + onTop - payout);
  return { scoreRow, onTop, payout, clipped };
}

/** A spread of real plays, including the ones that pay outside the lanes. */
const PLAYS: Play[] = [];
for (const cuts of [1, 4, 8])
for (const remaining of [0, 20, 40])
for (const balls of [1, 3])
for (const quality of [0, 1])
for (const ship of [0, 30])
for (const winPct of [0, 50])
for (const capBonus of [0, 5])
for (const postCap of [0, 7])
for (const qualified of [0, 9])
for (const zoneMissed of [0, 1]) {
  PLAYS.push({
    cuts, par: 5, remaining, threshold: 30, balls, quality, ship, winPct,
    capBonus, postCap, qualified, zoneMissed, scoreMult: 1, base: DEFAULT_MAP_BASE_POINTS,
  });
}

describe("the column reaches the payout", () => {
  it("is measuring a real spread, not three tidy cases", () => {
    expect(PLAYS.length).toBeGreaterThan(500);
  });

  it("Score plus the rows beneath it equals what the run banks", () => {
    const broken: string[] = [];
    for (const p of PLAYS) {
      for (const highscore of [0, 11]) {
        const s = screen(p, highscore);
        if (s.scoreRow + s.onTop - s.clipped !== s.payout) {
          broken.push(`${JSON.stringify(p)} hs=${highscore} -> ${JSON.stringify(s)}`);
        }
      }
    }
    expect(broken.slice(0, 3), `${broken.length} plays do not reconcile`).toEqual([]);
  });

  it("leaves the backstop clear of any map that actually ships", () => {
    // `clipped` is only honest if the backstop really did it, so this pins
    // where the backstop sits. No shipped map authors a win premium
    // (winBonusPercent is 0 on all of them), and on every play without one -
    // including a flawless, blazing, fully-engaged clear with pickups and a
    // multi-lock - the cap must not bite. It is a runaway guard, not a budget.
    //
    // Worth pinning after the economy was deflated by four: the backstop moved
    // with it, and a backstop that scaled slightly wrong would quietly start
    // eating hours off good runs, which is exactly the complaint in #79.
    const shipped = PLAYS.filter(p => p.winPct === 0);
    expect(shipped.length).toBeGreaterThan(200);
    const bitten = shipped.filter(p => screen(p, 11).clipped > 0);
    expect(bitten.length, `the backstop clipped ${bitten.length} ordinary plays`).toBe(0);
  });

  it("still catches a genuinely runaway payout", () => {
    // The other direction: a backstop nothing can reach is not a backstop.
    const runaway = screen({
      ...PLAYS[0], cuts: 1, remaining: 0, balls: 3, quality: 1, ship: 30, winPct: 200,
    });
    expect(runaway.clipped).toBeGreaterThan(0);
  });
});

describe("each unaccounted term was really unaccounted", () => {
  // Guards against the fix rotting: if someone removes a row, the term it
  // showed becomes invisible again, and these say which one.
  const base: Play = {
    cuts: 4, par: 5, remaining: 20, threshold: 30, balls: 3, quality: 1, ship: 0,
    zoneMissed: 0, scoreMult: 1, winPct: 0, capBonus: 0, postCap: 0, qualified: 0,
    base: DEFAULT_MAP_BASE_POINTS,
  };

  it("spends Comp Time on the ceiling, which is what its card promises", () => {
    // It used to be paid as flat hours, which both overpaid a map that was
    // nowhere near its ceiling and did nothing at all on a map that was - the
    // exact opposite of "raises the per-map overtime cap" on every card that
    // grants it.
    const without = screen(base), with_ = screen({ ...base, capBonus: 5 });
    expect(with_.payout, "an uncapped map must not be paid for a cap raise").toBe(without.payout);
    expect(with_.scoreRow).toBe(without.scoreRow);
    expect(with_.onTop, "a cap raise is not an on-top payment").toBe(without.onTop);
  });

  it("lets the raised ceiling through on a map that IS capped", () => {
    // The other half: a raise that never pays anything anywhere would be a
    // different bug wearing this fix's clothes. Loaded until the backstop bites.
    const loaded: Play = {
      ...base, cuts: 1, remaining: 0, balls: 3, quality: 1, ship: 30, winPct: 90,
    };
    const capped = screen(loaded);
    expect(capped.clipped, "this play was meant to hit the backstop").toBeGreaterThan(0);
    const raised = screen({ ...loaded, capBonus: 5 });
    expect(raised.payout - capped.payout).toBe(Math.min(5, capped.clipped));
  });

  it("pays bumper and power-up hours on top", () => {
    const with_ = screen({ ...base, postCap: 7 });
    expect(with_.payout - screen(base).payout).toBe(7);
    expect(with_.onTop).toBe(7);
  });

  it("pays qualified overtime above the backstop", () => {
    const with_ = screen({ ...base, qualified: 9 });
    expect(with_.payout - screen(base).payout).toBe(9);
    expect(with_.onTop).toBe(9);
  });

  it("counts the win premium and the highscore bonus below the Score line", () => {
    // Both used to render ABOVE a Score row that excludes them.
    const premium = screen({ ...base, winPct: 50 });
    expect(premium.onTop).toBeGreaterThan(0);
    expect(premium.scoreRow, "the premium must not be inside the Score row").toBe(screen(base).scoreRow);
    const record = screen(base, 11);
    expect(record.onTop).toBe(11);
    expect(record.payout - screen(base).payout).toBe(11);
  });
});
