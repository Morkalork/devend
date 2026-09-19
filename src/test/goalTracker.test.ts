/**
 * The goal tracker, and the one property it must never break.
 *
 * Asked for as "some kind of tracker for the various map goals... it should say
 * 0/3 or 2/3... I would also keep those two [par and space] with the rest of the
 * goals so it's cohesive". This replaces winHud, whose rule was the opposite:
 * space and locks were deliberately EXCLUDED because the row was full. The row
 * scrolls now, so the reason is gone and the whole win spec is on the bar.
 *
 * What carries over unchanged, because it is the thing that matters: the
 * readouts cannot disagree with the gate. A chip that says a requirement is met
 * on a map that then refuses to finish is worse than no chip - it turns a rule
 * the player could have learned into a bug they work around. So every goal runs
 * the same evaluator the win check runs, and the tests below check against
 * isWinMet rather than against their own arithmetic.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mapGoals, extraGoals, outstandingGoals, goalAtRisk, everyRequirementMet,
} from "@/lib/goalTracker";
import { isWinMet, resolveWinSpec, NO_RUN_RULES } from "@/lib/winSpec";
import { LADDER, byLevel } from "./fixtures/maps";
import type { WinSnapshot, WinSpec } from "@/types/winSpec";

const snap = (over: Partial<WinSnapshot> = {}): WinSnapshot => ({
  remainingPercent: 40, lockedBalls: 0, superiorLocks: 0, areaTargets: 0,
  lockedByType: {}, lockPoints: [], mapRotation: 0, delivered: 0, smashed: 0, terminals: 0, harvested: 0,
  bossDefeated: false, allLocked: false, cuts: 0, par: 6, activeSeconds: 0, ...over,
});

/** Level 32's shape: clear the board AND land a superior lock. */
const L32: WinSpec = {
  require: [{ kind: "space", threshold: 7 }, { kind: "superiorLocks", count: 1 }],
  alsoWinIf: [{ kind: "allLocked" }],
  authored: true,
};

/** An ordinary map: clear, and lock a couple. */
const PLAIN: WinSpec = {
  require: [{ kind: "space", threshold: 10 }, { kind: "locks", count: 2 }],
  alsoWinIf: [{ kind: "allLocked" }], authored: false,
};

const kinds = (spec: WinSpec, s = snap()) => mapGoals(spec, s).map(g => g.kind);
const find = (spec: WinSpec, kind: string, s = snap()) =>
  mapGoals(spec, s).find(g => g.kind === kind)!;

describe("what lands in the row", () => {
  it("shows every requirement the map states, in the order it states them", () => {
    // Authored order, so a player who just read "clear 85%, smash 1" in the
    // Acceptance Criteria finds them in that order on the bar.
    expect(kinds(L32)).toEqual(["space", "superiorLocks", "locks", "par"]);
    expect(kinds(PLAIN)).toEqual(["space", "locks", "par"]);
  });

  it("shows space and locks even when the map does not require them", () => {
    // The pair every map has. Space is what the board is FOR; locks pay
    // overtime and are worth seeing whether or not they are demanded.
    const bare: WinSpec = {
      require: [{ kind: "smashed", count: 2 }], alsoWinIf: [], authored: true,
    };
    expect(kinds(bare)).toEqual(["space", "smashed", "locks", "par"]);
  });

  it("gives an unrequired lock count no target, rather than a target of zero", () => {
    // "2/0" would invent a requirement this map does not have. A tally is a
    // number, not a fraction.
    const bare: WinSpec = {
      require: [{ kind: "smashed", count: 2 }], alsoWinIf: [], authored: true,
    };
    const locks = find(bare, "locks", snap({ lockedBalls: 2 }));
    expect(locks.tier).toBe("tally");
    expect(locks.target).toBeNull();
    expect(locks.current).toBe(2);
  });

  it("never shows an alternative as a requirement", () => {
    // alsoWinIf is a way OUT of the map, not a demand. Rendering "all balls
    // locked" as an unmet requirement would tell the player they must lock
    // everything on a map where that is merely one of two options.
    expect(kinds(L32)).not.toContain("allLocked");
  });

  it("reports live progress, not just presence", () => {
    const g = find(
      { require: [{ kind: "superiorLocks", count: 3 }], alsoWinIf: [], authored: true },
      "superiorLocks", snap({ superiorLocks: 2 }),
    );
    expect([g.current, g.target]).toEqual([2, 3]);
    expect(g.done).toBe(false);
  });

  it("counts a breakable goal up as slabs come apart", () => {
    // The example the request was made with: "0/3 or 2/3 when you've taken out
    // two of them".
    const spec: WinSpec = {
      require: [{ kind: "smashed", count: 3 }], alsoWinIf: [], authored: true,
    };
    const at = (n: number) => find(spec, "smashed", snap({ smashed: n }));
    expect([at(0).current, at(0).target, at(0).done]).toEqual([0, 3, false]);
    expect([at(2).current, at(2).target, at(2).done]).toEqual([2, 3, false]);
    expect([at(3).current, at(3).target, at(3).done]).toEqual([3, 3, true]);
  });
});

describe("space, which is the one that had to be turned around", () => {
  it("counts UP toward what the map asks for", () => {
    // The evaluator models space as a limit: remaining percent counting DOWN to
    // a threshold. That is right for the win check and wrong for a tracker,
    // where every other row counts up, so the display pair is inverted here.
    const g = find(L32, "space", snap({ remainingPercent: 40 }));
    expect(g.current).toBe(60);      // 60% cleared
    expect(g.target).toBe(93);       // of the 93% this map wants
    expect(g.unit).toBe("percent");
  });

  it("takes `done` from the evaluator rather than from its own arithmetic", () => {
    // The inversion is presentation only. If these two could disagree, the bar
    // would say CLEAR on a map that refuses to finish.
    for (const remainingPercent of [40, 8, 7, 6, 0]) {
      const s = snap({ remainingPercent, superiorLocks: 1 });
      const g = find(L32, "space", s);
      expect(g.done, `space at ${remainingPercent}% disagreed with the win check`)
        .toBe(isWinMet(L32, s));
    }
  });

  it("never shows a negative percentage", () => {
    // A board can briefly read over 100% remaining while a region resolves.
    expect(find(L32, "space", snap({ remainingPercent: 102 })).current).toBe(0);
  });
});

describe("par, which is a budget and not a demand", () => {
  it("is its own tier, never a requirement", () => {
    // Going over par costs score, never the map. A chip that read like the
    // others would say the map wants eight cuts, and no map does.
    const par = find(PLAIN, "par");
    expect(par.tier).toBe("budget");
    expect(par.done).toBe(false);
  });

  it("reads the par the win check reads", () => {
    // The top bar used to be handed level.expectedCuts directly while the win
    // check read snap.par: two copies of one number, free to disagree.
    const par = find(PLAIN, "par", snap({ cuts: 4, par: 9 }));
    expect([par.current, par.target]).toEqual([4, 9]);
  });

  it("warns once it is over, and not before", () => {
    expect(find(PLAIN, "par", snap({ cuts: 6, par: 6 })).over).toBe(false);
    expect(find(PLAIN, "par", snap({ cuts: 7, par: 6 })).over).toBe(true);
  });

  it("is never at risk, however few balls are left", () => {
    // At-risk means "locking this ball loses the map". Par cannot lose a map.
    expect(goalAtRisk(find(PLAIN, "par"), 1)).toBe(false);
  });
});

describe("the board frame", () => {
  const outstandingExtras = (spec: WinSpec, s = snap()) =>
    outstandingGoals(extraGoals(mapGoals(spec, s))).length > 0;

  it("is lit while the unusual requirement is outstanding", () => {
    expect(outstandingExtras(L32)).toBe(true);
  });

  it("resolves the moment that requirement is satisfied", () => {
    expect(outstandingExtras(L32, snap({ superiorLocks: 1 }))).toBe(false);
  });

  it("ignores the ordinary clear entirely", () => {
    // The frame says "this map is not a normal clear". A board still full of
    // space must not light it, and a cleared board must not resolve it - which
    // is why it reads extraGoals rather than the whole row.
    expect(outstandingExtras(L32, snap({ remainingPercent: 90, superiorLocks: 1 }))).toBe(false);
    expect(outstandingExtras(L32, snap({ remainingPercent: 0, superiorLocks: 0 }))).toBe(true);
  });

  it("says nothing at all on an ordinary map", () => {
    expect(extraGoals(mapGoals(PLAIN, snap()))).toEqual([]);
    expect(outstandingExtras(PLAIN)).toBe(false);
  });

  it("does not treat a live constraint as an achievement", () => {
    // THE subtle one. A limit clause is met until it is blown, so under-par
    // reads as satisfied on the very first frame. Calling that done would
    // resolve the frame on a map the player has not begun to earn.
    const underPar: WinSpec = {
      require: [{ kind: "underPar", delta: 0 }], alsoWinIf: [], authored: true,
    };
    const g = find(underPar, "underPar");
    expect(g.progress!.met, "the evaluator no longer reports a fresh limit as met").toBe(true);
    expect(g.done, "a limit was banked as an achievement").toBe(false);
    expect(outstandingExtras(underPar)).toBe(true);
  });
});

describe("the last ball", () => {
  it("warns on a requirement that ball still has to satisfy", () => {
    expect(goalAtRisk(find(L32, "superiorLocks"), 1)).toBe(true);
    expect(goalAtRisk(find(L32, "superiorLocks"), 2)).toBe(false);
  });

  it("stays quiet once that requirement is behind you", () => {
    expect(goalAtRisk(find(L32, "superiorLocks", snap({ superiorLocks: 1 })), 1)).toBe(false);
  });

  it("never warns about space or locks, which a last lock HELPS", () => {
    // It adds a lock, and the capture cascade takes the board down. Everything
    // else outstanding is something that ball still has to do first.
    expect(goalAtRisk(find(L32, "space"), 1)).toBe(false);
    expect(goalAtRisk(find(PLAIN, "locks"), 1)).toBe(false);
  });
});

describe("the readouts against the gate itself", () => {
  it("never calls a map's extra requirement done while the map refuses to win", () => {
    // The failure this whole file exists to prevent, checked directly: sweep
    // the states of level 32 and assert the frame only ever resolves where the
    // real win check agrees the requirement is behind you.
    for (const superiorLocks of [0, 1, 2]) {
      for (const remainingPercent of [40, 7, 0]) {
        const s = snap({ superiorLocks, remainingPercent });
        if (outstandingGoals(extraGoals(mapGoals(L32, s))).length === 0) {
          expect(
            isWinMet(L32, { ...s, remainingPercent: 0 }),
            `frame resolved at superiorLocks=${superiorLocks} but the map would not win`,
          ).toBe(true);
        }
      }
    }
  });

  it("stays outstanding on a map won only by its alternative", () => {
    // Locking everything wins level 32 without a superior lock. The map is won,
    // but the REQUIREMENT was never met, and the frame reports the requirement.
    const s = snap({ allLocked: true, remainingPercent: 40 });
    expect(isWinMet(L32, s), "the alternative no longer wins the map").toBe(true);
    expect(outstandingGoals(extraGoals(mapGoals(L32, s))).length).toBeGreaterThan(0);
  });
});

describe("the word CLEAR, which speaks for the whole map", () => {
  /**
   * Reported from play: "level 13, I can't finish it. After winning, the map
   * just does nothing and I end up stuck with no post map menu."
   *
   * The map was not won, and nothing in the engine was wrong. Level 13's win is
   * "clear to 14% AND smash one slab"; the board had been cleared, one slab was
   * still standing, and the gate went on waiting for it exactly as authored.
   * What was wrong was the bar: the space chip printed the map-wide word CLEAR
   * the moment the SPACE goal alone was done, so the player read a win off the
   * HUD that the map had never granted, and every further cut looked like a
   * dead game rather than an unfinished requirement.
   *
   * This is the failure the top of this file names - a readout disagreeing with
   * the gate - arriving through a chip that was telling the truth about itself
   * and a lie about the map. So the answer lives next to the goals rather than
   * in the component: one function, asked by the chip, that means what the gate
   * means.
   */
  const L13 = resolveWinSpec(byLevel(LADDER, 13)!, NO_RUN_RULES);
  const goalsOf = (spec: WinSpec, s: WinSnapshot) => mapGoals(spec, s);

  it("reads level 13 as unwon while the slab still stands", () => {
    // THE regression, against the shipped map rather than a lookalike.
    const cleared = snap({ remainingPercent: 0, smashed: 0 });
    expect(find(L13, "space", cleared).done, "the space clause is not met on a cleared board")
      .toBe(true);
    expect(everyRequirementMet(goalsOf(L13, cleared)), "the bar would say CLEAR on an unwon map")
      .toBe(false);
    expect(isWinMet(L13, cleared), "level 13 no longer wants its slab").toBe(false);
  });

  it("agrees the moment the last requirement lands", () => {
    const both = snap({ remainingPercent: 0, smashed: 1 });
    expect(everyRequirementMet(goalsOf(L13, both))).toBe(true);
    expect(isWinMet(L13, both)).toBe(true);
  });

  it("never claims a win the gate would refuse, over every state of level 13", () => {
    // The property, swept: CLEAR may only appear where the real win check
    // agrees. The converse is deliberately not asserted - a map won by its
    // alsoWinIf alternative never met its requirements, and the post-map screen
    // arrives on its own there.
    for (const remainingPercent of [40, 14, 0]) {
      for (const smashed of [0, 1, 2]) {
        const s = snap({ remainingPercent, smashed });
        if (everyRequirementMet(goalsOf(L13, s))) {
          expect(isWinMet(L13, s), `CLEAR at ${remainingPercent}% / ${smashed} smashed, but the map would not win`)
            .toBe(true);
        }
      }
    }
  });

  it("still says CLEAR on an ordinary map the moment the board is done", () => {
    // The fix must not cost the word its ordinary use. On a map whose only
    // requirement is space, a cleared board IS the win.
    const plainSpace: WinSpec = {
      require: [{ kind: "space", threshold: 10 }], alsoWinIf: [], authored: false,
    };
    expect(everyRequirementMet(goalsOf(plainSpace, snap({ remainingPercent: 40 })))).toBe(false);
    expect(everyRequirementMet(goalsOf(plainSpace, snap({ remainingPercent: 0 })))).toBe(true);
  });

  it("is not held back by the budget or the tallies", () => {
    // Par is a budget and loose locks are a tally; neither can lose a map, so
    // neither may withhold the word. PLAIN at 0% with its two locks is won
    // whatever the cut count says.
    const over = snap({ remainingPercent: 0, lockedBalls: 2, cuts: 99, par: 6 });
    expect(find(PLAIN, "par", over).over, "par is no longer blown here").toBe(true);
    expect(everyRequirementMet(goalsOf(PLAIN, over))).toBe(true);
  });

  it("says nothing at all before the goals exist", () => {
    // An empty row is a bar that has not been handed a spec yet, not a won map.
    expect(everyRequirementMet([])).toBe(false);
  });
});

describe("the chip actually asks", () => {
  /**
   * Source pins. The function above is only a fix if the chip consults it, and
   * the chip's condition is one line that read correctly for three years on
   * every map with a single requirement.
   */
  const read = (rel: string) =>
    readFileSync(resolve(__dirname, rel), "utf8");

  it("gates CLEAR on the whole map being won", () => {
    const chip = read("../components/game/GoalChip.tsx");
    expect(chip, "the space chip prints CLEAR off its own goal again")
      .toContain("goal.done && goal.kind === 'space' && winMet");
  });

  it("is told by the bar, which computes it once for the row", () => {
    const bar = read("../components/game/GameTopBar.tsx");
    expect(bar).toContain("everyRequirementMet(goals ?? [])");
    expect(bar, "the chip is left to guess").toContain("winMet={winMet}");
  });
});
