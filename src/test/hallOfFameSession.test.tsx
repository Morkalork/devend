/**
 * Integration (HIGHSCORES.md Phase A): a finished run files on the Hall of
 * Fame ledger with its trajectory, the result screen gets its rank, and the
 * NEXT run races the recorded trajectory via the level-complete pace payload.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";

const PUBLIC = path.resolve(__dirname, "../../public");
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const file = String(url).split("?")[0].replace(/^\//, "");
    const full = path.join(PUBLIC, file);
    if (!fs.existsSync(full)) return { ok: false, status: 404, text: async () => "" } as Response;
    return { ok: true, status: 200, text: async () => fs.readFileSync(full, "utf8") } as Response;
  }));
});
afterEach(() => vi.unstubAllGlobals());

function useSession() {
  const nav = useScreenNavigation();
  return { nav, session: useGameSession(nav) };
}

async function finishMap(result: { current: ReturnType<typeof useSession> }, score: number) {
  await act(async () => {
    result.current.session.handleLevelComplete({
      levelId: result.current.session.currentLevel!.id,
      levelScore: score, cutCount: 10, expectedCuts: 10, remainingPercent: 30,
      lockedBallsCount: 2,
    } as never);
  });
  await act(async () => { result.current.session.handleContinueFromOverlay(); });
  if (result.current.nav.currentScreen === "upgradeShop") {
    await act(async () => { result.current.session.handleContinueFromShop(); });
  }
}

describe("Hall of Fame session integration", () => {
  it("files the run on death, then the next run races its trajectory", async () => {
    const { result } = renderHook(() => useSession());

    // Run 1: two maps, then die and decline the revive.
    await act(async () => { await result.current.session.handleStartGame(undefined, true); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    await finishMap(result, 30); // cumulative 30
    await finishMap(result, 30); // cumulative 60

    await act(async () => {
      result.current.session.handleGameEnd({
        isWin: false, remainingPercent: 55,
        levelId: result.current.session.currentLevel!.id,
        levelNumber: 3, completedAllLevels: false,
      } as never);
    });
    // A fresh run holds 1 Continue, so death defers to the revive prompt.
    await act(async () => { result.current.session.handleDeclineContinue(); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("result"));

    // First run ever: rank #1, trajectory recorded, rank handed to the screen.
    expect(result.current.session.lastRunRank?.rank).toBe(1);
    const hall = JSON.parse(localStorage.getItem("jezzball_hall_v1")!);
    expect(hall.topRuns[0].score).toBe(60);
    expect(hall.topRuns[0].levelsCompleted).toBe(2);
    expect(hall.bestRunTrajectory).toEqual([30, 60]);

    // Run 2: the first map completion now carries a Record Pace delta
    // (30 cumulative vs 30 at the same point in the best run = 0).
    await act(async () => { await result.current.session.handleStartGame(undefined, true); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    await act(async () => {
      result.current.session.handleLevelComplete({
        levelId: result.current.session.currentLevel!.id,
        levelScore: 30, cutCount: 10, expectedCuts: 10, remainingPercent: 30,
        lockedBallsCount: 2,
      } as never);
    });
    expect(result.current.session.levelPace).toEqual({ delta: 0, newPersonalBest: false });
  });

  it("debug-started runs never file on the ledger", async () => {
    const { result } = renderHook(() => useSession());
    await act(async () => { await result.current.session.handleStartGame(5, true); }); // forceLevel
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    await finishMap(result, 30);

    await act(async () => {
      result.current.session.handleGameEnd({
        isWin: false, remainingPercent: 55,
        levelId: result.current.session.currentLevel!.id,
        levelNumber: 6, completedAllLevels: false,
      } as never);
    });
    await act(async () => { result.current.session.handleDeclineContinue(); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("result"));

    expect(result.current.session.lastRunRank).toBeNull();
    expect(localStorage.getItem("jezzball_hall_v1")).toBeNull();
    // And the pace payload stayed absent (nothing to race, ineligible anyway).
    expect(result.current.session.levelPace).toBeNull();
  });
});
