/**
 * The canvas end-of-run screen's view model (src/ui/screens/resultScreenModel.ts),
 * carrying over the behavioural assertions of resultScreenActions.test.tsx and
 * the ResultScreen case in hallOfFameScreen.test.tsx.
 *
 * The DOM test checked which button sat inside the scrolling box. On the
 * canvas the split is two lists: pinnedActions() feeds the bar that never
 * scrolls and detourActions() the end of the scrolling recap, so "Play Again
 * is not something you scroll to find" is "Play Again is pinned, not a detour".
 */
import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import type { TFunction } from "i18next";
import type { GameResult } from "@/types/game";
import type { RunRecap } from "@/lib/buildRecap";
import {
  detourActions, ladderBlock, pinnedActions, recapBlock, type ResultRunRank,
} from "@/ui/screens/resultScreenModel";

const t = i18n.t.bind(i18n) as unknown as TFunction;

const LOSS: GameResult = {
  isWin: false, remainingPercent: 55, levelId: "level-31", levelNumber: 31,
  completedAllLevels: false, totalScore: 640,
};

const RECAP: RunRecap = {
  primary: "lock", secondary: "freeze",
  tagCounts: { lock: 5, freeze: 3 },
  capstoneId: "golden_handshake", capstoneName: "Golden Handshake",
  score: 640, previousBest: 500, isArchetypeRecord: true,
} as RunRecap;

const RANK: ResultRunRank = {
  rank: 2, gapToNext: 40, gapToTop10: null, monthBest: true, dayBest: true,
  dailyStreak: 4, aheadThroughMaps: 12,
};

describe("the pinned action", () => {
  it("keeps Play Again OUT of the scrolling recap", () => {
    const pinned = pinnedActions({ hasPlayAgain: true, hasRestart: false }, t);
    expect(pinned.map(a => a.text)).toEqual([expect.stringMatching(/Play Again/i)]);
    expect(detourActions({ hasRecords: true, totalScore: 640 })).not.toContain("playAgain");
  });

  it("holds it out even on the tallest possible screen", () => {
    // The run that earns a rank, a crown, a streak and a build record is the
    // run whose Play Again used to be furthest down.
    expect(ladderBlock(LOSS, RANK, t)?.monthBestText).toMatch(/Employee of the Month/i);
    expect(recapBlock(RECAP, t)?.capstoneText).toMatch(/Golden Handshake/);
    expect(pinnedActions({ hasPlayAgain: true, hasRestart: false }, t)[0].kind).toBe("playAgain");
  });

  it("pins Continue AND Restart together when a checkpoint exists", () => {
    const pinned = pinnedActions({ checkpointLevel: 25, hasPlayAgain: true, hasRestart: true }, t);
    expect(pinned.map(a => a.text)).toEqual([
      expect.stringMatching(/Continue \(Level 25\)/i),
      expect.stringMatching(/Restart/i),
    ]);
    expect(pinned.some(a => /Play Again/i.test(a.text)), "both offers at once").toBe(false);
  });

  it("offers Play Again, not Continue, from level one", () => {
    const pinned = pinnedActions({ checkpointLevel: 1, hasPlayAgain: true, hasRestart: true }, t);
    expect(pinned.map(a => a.kind)).toEqual(["playAgain"]);
  });
});

describe("the detours stay in the recap", () => {
  it.each([["records"], ["share"], ["mainMenu"]] as const)("%s scrolls with the recap", kind => {
    expect(detourActions({ hasRecords: true, totalScore: 640 })).toContain(kind);
  });

  it("offers Records only when there is a ladder to open", () => {
    expect(detourActions({ hasRecords: false, totalScore: 60 })).not.toContain("records");
    expect(detourActions({ hasRecords: true, totalScore: 60 })).toContain("records");
  });

  it("offers Share only when something was banked", () => {
    expect(detourActions({ hasRecords: false, totalScore: 0 })).not.toContain("share");
    expect(detourActions({ hasRecords: false })).not.toContain("share");
  });
});

describe("the screen with nothing pinned to it", () => {
  it("draws no empty bar when there is no way to play on", () => {
    expect(pinnedActions({ hasPlayAgain: false, hasRestart: false }, t)).toEqual([]);
    expect(detourActions({ hasRecords: false, totalScore: 640 })).toContain("mainMenu");
  });
});

describe("the ladder block", () => {
  it("is absent when nothing was banked or the run is unranked", () => {
    expect(ladderBlock({ ...LOSS, totalScore: 0 }, RANK, t)).toBeNull();
    expect(ladderBlock(LOSS, null, t)).toBeNull();
  });

  it("gives the monthly crown only below #1", () => {
    expect(ladderBlock(LOSS, { ...RANK, rank: 1 }, t)?.monthBestText).toBeNull();
    expect(ladderBlock(LOSS, { ...RANK, rank: 1 }, t)?.newBestText).toBeTruthy();
  });
});

describe("the build recap", () => {
  it("orders the tag chips most-owned first and drops empty tags", () => {
    const r = recapBlock({ ...RECAP, tagCounts: { freeze: 3, lock: 5, risk: 0 } }, t);
    expect(r?.chips).toEqual([{ tag: "lock", count: 5 }, { tag: "freeze", count: 3 }]);
  });
});
