/**
 * Free-store-item pickup (issue #48): the voucher banks at level complete,
 * survives a CLOSED store (no purchases possible = nothing to be free), and is
 * consumed by the next OPEN store visit.
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

describe("free-store-item voucher", () => {
  it("banks on claim, survives a closed store, is consumed by an open one", async () => {
    const { result } = renderHook(() => useSession());
    await act(async () => { await result.current.session.handleStartGame(undefined, true); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));

    // Map 1: claimed a voucher but locked nothing -> the store opens CLOSED.
    await act(async () => {
      result.current.session.handleLevelComplete({
        levelId: result.current.session.currentLevel!.id,
        levelScore: 30, cutCount: 10, expectedCuts: 10, remainingPercent: 30,
        lockedBallsCount: 0, freeShopItemsEarned: 1,
      } as never);
    });
    expect(result.current.session.carryFreeShopItems).toBe(1);
    await act(async () => { result.current.session.handleContinueFromOverlay(); });
    expect(result.current.nav.currentScreen).toBe("upgradeShop");
    expect(result.current.session.storeClosed).toBe(true);
    await act(async () => { result.current.session.handleContinueFromShop(); });
    // Closed store: nothing was purchasable, the voucher survives.
    expect(result.current.session.carryFreeShopItems).toBe(1);

    // Map 2: locks earned -> the store opens for real and consumes the voucher.
    await act(async () => {
      result.current.session.handleLevelComplete({
        levelId: result.current.session.currentLevel!.id,
        levelScore: 30, cutCount: 10, expectedCuts: 10, remainingPercent: 30,
        lockedBallsCount: 2,
      } as never);
    });
    await act(async () => { result.current.session.handleContinueFromOverlay(); });
    expect(result.current.session.storeClosed).toBe(false);
    await act(async () => { result.current.session.handleContinueFromShop(); });
    expect(result.current.session.carryFreeShopItems).toBe(0);
  });
});
