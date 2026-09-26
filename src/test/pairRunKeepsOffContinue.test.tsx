/**
 * A run started in 2-Player mode belongs to the pair.
 *
 * It is saved under the pair's own key and offered again from the 2-Player
 * screen. It must never become the welcome screen's Continue, which would drop
 * one player alone into a run two people were building, and it must not
 * disturb the solo run the player had parked there before pairing: not by
 * overwriting it on each map, not by clearing it when the pair's run starts
 * or ends.
 *
 * Driven through the real session, as the Daily's save/resume test is.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { setRunSeedText } from "@/lib/runRng";
import { flushRunSave } from "@/lib/runSaveFlush";

const PUBLIC = path.resolve(__dirname, "../../public");
const SOLO_KEY = "jezzball_run_v1";

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

type Session = ReturnType<typeof useSession>;

/** Back to the menu, as a player is before starting anything: the per-map
 *  save fires on the screen changing to the board, so this is what arms it. */
function toMenu(result: { current: Session }) {
  act(() => result.current.nav.goToWelcome());
}

async function startPairRun(result: { current: Session }) {
  toMenu(result);
  await act(async () => {
    result.current.session.beginPairRun();
    await result.current.session.handleStartGame(undefined, true, "pair-seed");
  });
  await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
}

async function loseRun(result: { current: Session }) {
  await act(async () => {
    result.current.session.handleGameEnd({
      isWin: false, remainingPercent: 55,
      levelId: result.current.session.currentLevel!.id,
      levelNumber: 1, completedAllLevels: false,
    } as never);
  });
  await act(async () => { result.current.session.handleDeclineContinue(); });
}

describe("a pair's run stays off the welcome screen's Continue", () => {
  it("never writes the solo save", async () => {
    const { result } = renderHook(() => useSession());
    await startPairRun(result);
    // The per-map write, and the flush a hidden tab or a crash triggers.
    act(() => flushRunSave());
    expect(localStorage.getItem(SOLO_KEY)).toBeNull();
    expect(result.current.session.hasSavedRun).toBe(false);
  });

  it("leaves a parked solo run exactly as it was, through the pair's start and end", async () => {
    const { result } = renderHook(() => useSession());
    await act(async () => { await result.current.session.handleStartGame(undefined, true); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    const parked = localStorage.getItem(SOLO_KEY);
    expect(parked, "the solo run never saved, so this proves nothing").not.toBeNull();

    await startPairRun(result);
    act(() => flushRunSave());
    expect(localStorage.getItem(SOLO_KEY), "the pair's start or a map touched the solo save").toBe(parked);

    await loseRun(result);
    expect(localStorage.getItem(SOLO_KEY), "the pair's run ending cleared the solo save").toBe(parked);
    expect(result.current.session.hasSavedRun).toBe(true);
  });

  it("goes back to saving as soon as a solo run starts again", async () => {
    const { result } = renderHook(() => useSession());
    await startPairRun(result);
    expect(localStorage.getItem(SOLO_KEY)).toBeNull();

    toMenu(result);
    await act(async () => { await result.current.session.handleStartGame(undefined, true); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    await waitFor(() => expect(localStorage.getItem(SOLO_KEY)).not.toBeNull());
    expect(result.current.session.hasSavedRun).toBe(true);
  });
});
