/**
 * Play Again must not be something you scroll to find.
 *
 * Reported as: "there was so much going on there that they missed the Play
 * Again button - they had to scroll down to see it."
 *
 * The screen was one column that ended in its buttons, and it had grown:
 * outcome, ascension depth, newly unlocked loadouts, the level and its id, the
 * failure and everything still needed, levels completed and certificate hours,
 * the ladder placement with four possible crowns under it, then the build recap
 * with its tag chips and archetype record. Most of that is conditional, so the
 * fold moved depending on how the run went - and the better the run, the deeper
 * the one button that starts another was buried.
 *
 * The fix is structural, not cosmetic: the recap scrolls in its own row and the
 * run-continuation buttons sit in a row that does not. jsdom lays nothing out,
 * so these check the STRUCTURE that makes it true - which button is inside the
 * scrolling box and which is outside it - rather than pixels.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@/i18n";
import { ResultScreen } from "@/components/game/ResultScreen";
import type { GameResult } from "@/types/game";
import type { RunRankInfo } from "@/lib/runLedger";

const LOSS: GameResult = {
  isWin: false, remainingPercent: 55, levelId: "level-31", levelNumber: 31,
  completedAllLevels: false, totalScore: 640,
  failure: {
    kind: "lockedOut",
    unmet: [{
      condition: { kind: "smashed", count: 2 },
      current: 0, target: 2, met: false, mode: "accumulate",
    }],
  },
};

/** Every optional block switched on: the tallest this screen ever gets. */
const FULL = {
  result: LOSS,
  onMainMenu: vi.fn(),
  onPlayAgain: vi.fn(),
  onRecords: vi.fn(),
  runHoursAwarded: 12,
  runLevelsCompleted: 30,
  newlyUnlockedLoadouts: ["Crunch Time", "Hot Fix"],
  runRecap: {
    primary: "lock" as const, secondary: "freeze" as const,
    tagCounts: { lock: 5, freeze: 3 },
    capstoneId: "golden_handshake", capstoneName: "Golden Handshake",
    score: 640, previousBest: 500, isArchetypeRecord: true,
  },
  runRank: {
    rank: 2, gapToNext: 40, gapToTop10: null, monthBest: true, dayBest: true,
    dailyStreak: 4, aheadThroughMaps: 12,
  } as RunRankInfo & { aheadThroughMaps: number | null; monthBest?: boolean; dayBest?: boolean; dailyStreak?: number },
};

/** The box that owns the overflow. Everything inside it can be scrolled away. */
const scroller = () => document.querySelector(".overflow-y-auto");
const button = (name: RegExp) => screen.getByRole("button", { name });

afterEach(cleanup);

describe("the pinned action", () => {
  it("keeps Play Again OUT of the scrolling recap", () => {
    render(<ResultScreen {...FULL} />);
    const box = scroller();
    expect(box, "nothing owns the overflow, so the page grows and takes the buttons with it").toBeTruthy();
    expect(
      box!.contains(button(/Play Again/i)),
      "Play Again is inside the scroller, which is the reported bug",
    ).toBe(false);
  });

  it("holds it out even on the tallest possible screen", () => {
    // The regression is conditional content: the run that earns a rank, a
    // crown, a streak, a build record and two loadout unlocks is exactly the
    // run whose Play Again used to be furthest down.
    render(<ResultScreen {...FULL} />);
    expect(screen.getByText(/Employee of the Month/i)).toBeTruthy();
    expect(screen.getByText(/Golden Handshake/)).toBeTruthy();
    expect(scroller()!.contains(button(/Play Again/i))).toBe(false);
  });

  it("still starts the next run", () => {
    const onPlayAgain = vi.fn();
    render(<ResultScreen {...FULL} onPlayAgain={onPlayAgain} />);
    fireEvent.click(button(/Play Again/i));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
  });

  it("pins Continue AND Restart together when a checkpoint exists", () => {
    // They are one decision asked two ways. Pinning only the first would hide
    // the harder half behind the fold, which is the same bug one step over.
    render(<ResultScreen {...FULL} onRestart={vi.fn()} checkpointLevel={25} />);
    const box = scroller()!;
    expect(box.contains(button(/Continue \(Level 25\)/i))).toBe(false);
    expect(box.contains(button(/Restart/i))).toBe(false);
    expect(screen.queryByRole("button", { name: /Play Again/i }), "both offers at once").toBeNull();
  });
});

describe("the detours stay in the recap", () => {
  /**
   * Reading the ladder, sharing the card and leaving for the menu are all
   * "instead of playing". A bar deep enough to hold every action would take a
   * third of a phone and put the recap behind a letterbox - one bad screen
   * traded for another.
   */
  it.each([
    ["Records", /Records/i],
    ["Share", /Share/i],
    ["Main Menu", /Main Menu/i],
  ])("%s scrolls with the recap", (_label, name) => {
    render(<ResultScreen {...FULL} />);
    expect(scroller()!.contains(button(name))).toBe(true);
  });

  it("still works, being merely lower down", () => {
    const onMainMenu = vi.fn();
    render(<ResultScreen {...FULL} onMainMenu={onMainMenu} />);
    fireEvent.click(button(/Main Menu/i));
    expect(onMainMenu).toHaveBeenCalledTimes(1);
  });
});

describe("the screen with nothing pinned to it", () => {
  it("draws no empty bar when there is no way to play on", () => {
    // onPlayAgain and onRestart are both optional props. An empty gradient
    // strip eating the bottom of the screen would be pure loss.
    render(<ResultScreen result={LOSS} onMainMenu={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Play Again/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Main Menu/i })).toBeTruthy();
  });
});
