/**
 * Daily Stand-up integration (HIGHSCORES.md Phase D): the seeded daily run
 * serves every player the same content, survives save/resume, and files on
 * the daily ledger with an attendance streak.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useLevelManager } from "@/hooks/useLevelManager";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { setRunSeedText, getRunSeedText, dailySeedText, todayKey } from "@/lib/runRng";

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
afterEach(() => {
  vi.unstubAllGlobals();
  setRunSeedText(null);
});

function useSession() {
  const nav = useScreenNavigation();
  return { nav, session: useGameSession(nav) };
}

describe("Daily Stand-up", () => {
  it("the same seed builds the same level lineup for every player", async () => {
    setRunSeedText(dailySeedText("2026-07-16"));
    const a = renderHook(() => useLevelManager());
    const b = renderHook(() => useLevelManager());
    await act(async () => { await a.result.current.loadLevels(); });
    await act(async () => { await b.result.current.loadLevels(); });

    const idsA = a.result.current.levels.map(l => l.id);
    const idsB = b.result.current.levels.map(l => l.id);
    expect(idsA.length).toBeGreaterThan(0);
    expect(idsA).toEqual(idsB);

    // Every level number now has exactly one map, so the lineup is the same
    // every day BY CONSTRUCTION. This used to assert the opposite - a different
    // day rolling a different lineup - and it was a real guard at the time,
    // because the b-variants gave the seeded picker something to choose. With
    // the variants retired there is nothing left for it to vary, and the old
    // assertion is not merely unsupported but provably false.
    //
    // What it was protecting - that a daily seed actually reaches the run's
    // content - has not gone away, it has moved: the board itself is dealt
    // through getRunRng (rotation, obstacle placement, ball types), and
    // botSoak.test.ts pins it as "still plays differently on different seeds".
    // So what is worth asserting here is the shape the lineup must now have.
    setRunSeedText(dailySeedText("2026-07-17"));
    const c = renderHook(() => useLevelManager());
    await act(async () => { await c.result.current.loadLevels(); });
    expect(c.result.current.levels.map(l => l.id)).toEqual(idsA);

    // One map per level number, in order, none repeated: the invariant that
    // retiring the variants was supposed to produce.
    const numbers = a.result.current.levels.map(l => l.level);
    expect(numbers).toEqual([...numbers].sort((x, y) => x - y));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(new Set(idsA).size).toBe(idsA.length);
  });

  it("handleStartDaily arms today's seed, saves the dailyKey, and Continue restores it", async () => {
    const { result, unmount } = renderHook(() => useSession());
    await act(async () => { await result.current.session.handleStartDaily(); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));

    expect(result.current.session.dailyKey).toBe(todayKey());
    expect(getRunSeedText()).toBe(dailySeedText(todayKey()));

    // The run save carries the daily key.
    const save = JSON.parse(localStorage.getItem("jezzball_run_v1")!);
    expect(save.dailyKey).toBe(todayKey());

    // Cold restart (app closed) drops the armed seed; Continue re-arms it.
    unmount();
    setRunSeedText(null);
    const cold = renderHook(() => useSession());
    await act(async () => { await cold.result.current.session.handleContinueRun(); });
    await waitFor(() => expect(cold.result.current.nav.currentScreen).toBe("game"));
    expect(cold.result.current.session.dailyKey).toBe(todayKey());
    expect(getRunSeedText()).toBe(dailySeedText(todayKey()));
  });

  it("a normal Start Game after a daily clears the seeded context", async () => {
    const { result } = renderHook(() => useSession());
    await act(async () => { await result.current.session.handleStartDaily(); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    expect(getRunSeedText()).not.toBeNull();

    await act(async () => { await result.current.session.handleStartGame(undefined, true); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    expect(getRunSeedText()).toBeNull();
    expect(result.current.session.dailyKey).toBeNull();
  });

  it("a finished daily files on the daily ledger and starts the streak", async () => {
    const { result } = renderHook(() => useSession());
    await act(async () => { await result.current.session.handleStartDaily(); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));

    await act(async () => {
      result.current.session.handleLevelComplete({
        levelId: result.current.session.currentLevel!.id,
        levelScore: 30, cutCount: 10, expectedCuts: 10, remainingPercent: 30,
        lockedBallsCount: 2,
      } as never);
    });
    await act(async () => {
      result.current.session.handleGameEnd({
        isWin: false, remainingPercent: 55,
        levelId: result.current.session.currentLevel!.id,
        levelNumber: 2, completedAllLevels: false,
      } as never);
    });
    await act(async () => { result.current.session.handleDeclineContinue(); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("result"));

    expect(result.current.session.lastRunRank?.dayBest).toBe(true);
    expect(result.current.session.lastRunRank?.dailyStreak).toBe(1);
    const hall = JSON.parse(localStorage.getItem("jezzball_hall_v1")!);
    expect(hall.dailyBests[todayKey()].score).toBe(30);
    expect(hall.dailyStreak).toEqual({ count: 1, lastKey: todayKey() });
  });
});
