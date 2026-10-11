/**
 * The canvas post-map overlay's view model (src/ui/screens/levelCompleteModel.ts),
 * carrying over the behavioural assertions of levelCompleteBreakdown.test.tsx and
 * overtimeOutOf.test.tsx, which render the DOM overlay. The reasoning for each
 * rule is in those files; the short version is repeated here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import type { TFunction } from "i18next";
import type { LevelScoreData } from "@/types/game";
import {
  COUNT_UP_DELAY_MS, COUNT_UP_DURATION_MS, STAT_INFO, countUpAt, levelCompleteModel, statInfoFor,
} from "@/ui/screens/levelCompleteModel";

const t = i18n.t.bind(i18n) as unknown as TFunction;

const scoreData: LevelScoreData = {
  levelNumber: 4,
  levelId: "level-4",
  cutCount: 3,
  expectedCuts: 5,
  basePoints: 20,
  levelScore: 48,
  remainingPercent: 12,
  underParBonus: 6,
  spaceBonus: 4,
  lockBonus: 10,
  lockedBallsCount: 2,
  performanceMultiplier: 1,
};

const model = (over: Partial<LevelScoreData> = {}) => levelCompleteModel({ ...scoreData, ...over }, t);

describe("post-map score breakdown collapses", () => {
  const SRC = readFileSync(resolve(process.cwd(), "src/ui/screens/LevelCompleteOverlay.tsx"), "utf8");

  it("hides the itemised rows by default but keeps the totals visible", () => {
    // The fold starts closed and its header toggles it.
    expect(SRC).toContain("const [breakdownOpen, setBreakdownOpen] = useState(false);");
    expect(SRC).toContain("onTap={() => setBreakdownOpen(open => !open)}");
    expect(SRC).toContain('t("levelComplete.breakdownTitle")');
    // The itemised rows are inside the fold; the totals come after it closes.
    const open = SRC.indexOf("{breakdownOpen && (");
    const earned = SRC.indexOf('hold("overtimeEarned")');
    const fold = SRC.slice(open, earned);
    expect(open).toBeGreaterThan(0);
    expect(fold).toContain('hold("fencesUsed")');
    expect(fold.trimEnd(), "a total moved inside the fold").toMatch(/\)\}$/);
    expect(SRC.indexOf('hold("totalOvertime")')).toBeGreaterThan(earned);
  });

  it("shows the Overtime row's ceiling without opening the breakdown (overtimeOutOf)", () => {
    const earned = SRC.indexOf('hold("overtimeEarned")');
    const suffix = SRC.indexOf("{m.overtimeSuffix && (");
    expect(suffix, "the ceiling is not drawn on the Overtime row").toBeGreaterThan(earned);
    expect(suffix).toBeLessThan(SRC.indexOf('hold("totalOvertime")'));
  });

  it("no longer itemises the hours the axes already reported", () => {
    for (const row of ["threadLocks", "superiorLocks", "zoneLocks"]) {
      expect(SRC, `the ${row} row is back`).not.toContain(`hold("${row}")`);
    }
  });

  // Closing by default would otherwise bury the good news, so the collapsed
  // header carries the bonus subtotal.
  it("shows the bonus subtotal on the collapsed header", () => {
    expect(model().subtotalText).toBe("+20h");
  });

  it("omits the subtotal when the map earned no bonus at all", () => {
    expect(model({ underParBonus: 0, spaceBonus: 0, lockBonus: 0 }).subtotalText).toBeNull();
  });
});

describe("post-map screen names the win condition", () => {
  it("reports the condition that finished the map", () => {
    expect(model({ winReason: "allLocked" }).winReason?.reason).toBe("All balls locked");
  });

  // Old saves and the game-over path carry no reason; inventing one would be worse.
  it("stays silent rather than guessing when no reason is given", () => {
    expect(model().winReason).toBeNull();
  });

  it("does not claim the space target when the lock is what drained the board", () => {
    const m = model({ winReason: "allLocked" });
    expect(m.winReason?.reason).toBe("All balls locked");
    expect(m.winReason?.also).toBeNull();
  });

  it("says both landed when the cut cleared to target on its own merits", () => {
    const m = model({ winReason: "allLocked", alsoClearedSpace: true });
    expect(m.winReason?.also).toMatch(/space target also met/);
  });

  it("hides Remaining only for the all-locked win, which drains the board", () => {
    expect(model({ winReason: "space" }).showRemaining).toBe(true);
    expect(model({ wonByAllLocked: true }).showRemaining).toBe(false);
  });
});

describe("the breakdown says what was on offer, not just what landed", () => {
  const withAxes = {
    multipliedBase: 20,
    mapCeiling: 100,
    levelScore: 56,
    axes: {
      delivery: 18, craft: 0, tempo: 12, thrift: 6, greed: 0,
      total: 36,
      ratios: { delivery: 0.6, craft: 0, tempo: 0.6, thrift: 0.3, greed: 0 },
      ceilings: { delivery: 30, craft: 20, tempo: 20, thrift: 20, greed: 10 },
    },
  } as Partial<LevelScoreData>;

  it("says a zone was sealed, with its denominator", () => {
    expect(model({ ...withAxes, zoneLockCount: 1, zoneCount: 2 }).zonesSealedText).toBe("1/2");
  });

  it("reports the sealed zone as a COUNT, never as hours", () => {
    const text = model({ ...withAxes, zoneLockCount: 1, zoneCount: 2, zoneLockBonus: 9 }).zonesSealedText;
    expect(text).not.toMatch(/\dh/);
  });

  it("stays quiet on a map with no zones at all", () => {
    expect(model(withAxes).zonesSealedText).toBeNull();
  });

  it("stays quiet when the map had zones and none were taken", () => {
    expect(model({ ...withAxes, zoneLockCount: 0, zoneCount: 2 }).zonesSealedText).toBeNull();
  });

  it("closes with the scorer's own numbers, not a sum of its rows", () => {
    const m = model(withAxes);
    expect(m.scoreEarnedText).toBe("56");
    expect(m.scoreAvailableText).toBe("/ 100h");
  });

  it("never claims a ceiling smaller than what was earned", () => {
    const m = model({ ...withAxes, mapCeiling: 10 });
    expect(m.scoreAvailableText).toBe("/ 56h");
  });
});

describe("the Overtime row states what the map could have paid", () => {
  const base = { levelScore: 56, multipliedBase: 20, mapCeiling: 100 } as Partial<LevelScoreData>;

  it("shows the ceiling on the always-visible row", () => {
    expect(model(base).overtimeSuffix).toBe("/ 100");
  });

  it("drops the fraction when the map paid everything it had", () => {
    expect(model({ ...base, levelScore: 100 }).overtimeSuffix).toBeNull();
  });

  it("never renders a ceiling below the payout", () => {
    expect(model({ ...base, levelScore: 140 }).overtimeSuffix).toBeNull();
  });

  it("agrees with the Score row rather than inventing a second denominator", () => {
    const m = model(base);
    expect(m.scoreAvailableText).toBe("/ 100h");
    expect(m.overtimeSuffix).toBe("/ 100");
  });

  it("stays quiet when the scorer gave it no ceiling to report", () => {
    expect(model({ ...base, mapCeiling: undefined }).overtimeSuffix).toBeNull();
  });
});

describe("hours paid on top of the Score line (#79)", () => {
  it("lists each on-top channel below the Score and nothing that paid zero", () => {
    const m = model({ winBonus: 8, winBonusPercent: 10, bouncerOvertime: 3, pickupBonus: 0 });
    expect(m.onTopRows.map(r => r.key)).toEqual(["winBonus", "bouncerHours"]);
    expect(m.onTopTotal).toBe(11);
  });

  it("counts the highscore bonus only when the highscore was actually beaten", () => {
    expect(model({ highscoreBonus: 5 }).onTopRows).toHaveLength(0);
    expect(model({ highscoreBonus: 5, beatHighscore: true }).onTopRows.map(r => r.key)).toEqual(["newHighscore"]);
  });

  it("reports what the backstop clipped, and never a negative clip", () => {
    const axes = { delivery: 30, craft: 0, tempo: 0, thrift: 0, greed: 0, total: 30, ratios: {}, ceilings: {} };
    const m = model({ multipliedBase: 20, axes, levelScore: 40 } as Partial<LevelScoreData>);
    expect(m.clipped).toBe(10);
    expect(model({ multipliedBase: 20, axes, levelScore: 80 } as Partial<LevelScoreData>).clipped).toBe(0);
  });
});

describe("the press-and-hold info cards", () => {
  it("open for every Performance Review lane", () => {
    for (const lane of ["delivery", "craft", "tempo", "thrift", "greed", "engagement"]) {
      expect(statInfoFor(`axis_${lane}`)).toBe(STAT_INFO[`axis_${lane}`]);
    }
  });

  it("stay shut for a row with no card", () => {
    expect(statInfoFor("bouncerHours")).toBeNull();
    expect(statInfoFor(null)).toBeNull();
  });
});

describe("the count-up", () => {
  it("waits for the card to land, then eases to the exact target", () => {
    expect(countUpAt(84, 0)).toBe(0);
    expect(countUpAt(84, COUNT_UP_DELAY_MS - 1)).toBe(0);
    const mid = countUpAt(84, COUNT_UP_DELAY_MS + COUNT_UP_DURATION_MS / 2);
    expect(mid).toBeGreaterThan(42); // ease-out: past halfway at half time
    expect(mid).toBeLessThan(84);
    expect(countUpAt(84, COUNT_UP_DELAY_MS + COUNT_UP_DURATION_MS)).toBe(84);
    expect(countUpAt(84, 10_000)).toBe(84);
  });
});
