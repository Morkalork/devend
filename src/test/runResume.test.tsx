/**
 * Integration: driving a run forward writes a resume-save with the CURRENT map
 * index, and Continue restores that index (not level 1). Reproduces the bug
 * where Continue dropped the player back on the first map.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";

// Serve the real public/*.yml files through fetch so the managers load actual
// data (levels, upgrades, doors, ...).
const PUBLIC = path.resolve(__dirname, "../../public");
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const file = String(url).split("?")[0].replace(/^\//, "");
    const full = path.join(PUBLIC, file);
    if (!fs.existsSync(full)) return { ok: false, status: 404, text: async () => "" } as Response;
    const body = fs.readFileSync(full, "utf8");
    return { ok: true, status: 200, text: async () => body } as Response;
  }));
});
afterEach(() => vi.unstubAllGlobals());

function useSession() {
  const nav = useScreenNavigation();
  return { nav, session: useGameSession(nav) };
}

describe("run resume restores the map index", () => {
  it("saves the current index each map and Continue restores it", async () => {
    const { result, unmount } = renderHook(() => useSession());

    // Start a fresh run and enter the first map.
    await act(async () => { await result.current.session.handleStartGame(undefined, true); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    expect(result.current.session.currentLevelIndex).toBe(0);

    // Advance two maps by completing + leaving the shop, mimicking real flow.
    // locks=0 sends us through the CLOSED store (early maps with no locks).
    const finishMap = async (locks = 0) => {
      await act(async () => {
        result.current.session.handleLevelComplete({
          levelId: result.current.session.currentLevel!.id,
          levelScore: 30, cutCount: 10, expectedCuts: 10, remainingPercent: 30,
          lockedBallsCount: locks,
        } as never);
      });
      await act(async () => { result.current.session.handleContinueFromOverlay(); });
      // We may land in the shop (normal) — leave it to advance.
      if (result.current.nav.currentScreen === "upgradeShop") {
        await act(async () => { result.current.session.handleContinueFromShop(); });
      }
      await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    };

    await finishMap(); // -> map 2 (index 1)
    expect(result.current.session.currentLevelIndex).toBe(1);
    await finishMap(); // -> map 3 (index 2)
    expect(result.current.session.currentLevelIndex).toBe(2);

    // The save on disk should now point at index 2.
    const saved = JSON.parse(localStorage.getItem("jezzball_run_v1")!);
    expect(saved.currentLevelIndex).toBe(2);

    const map3Id = result.current.session.currentLevel!.id;

    // Simulate closing + reopening the app: unmount (drops all in-memory state,
    // incl. the level manager's allMaps) and remount fresh from disk.
    unmount();
    const cold = renderHook(() => useSession());
    expect(cold.result.current.session.hasSavedRun).toBe(true);
    expect(cold.result.current.session.currentLevelIndex).toBe(0); // nothing loaded yet

    await act(async () => { await cold.result.current.session.handleContinueRun(); });
    await waitFor(() => expect(cold.result.current.nav.currentScreen).toBe("game"));

    // The bug: this came back as 0 (first map). It must be 2, same map id.
    expect(cold.result.current.session.currentLevelIndex).toBe(2);
    expect(cold.result.current.session.currentLevel!.id).toBe(map3Id);
  });
});
