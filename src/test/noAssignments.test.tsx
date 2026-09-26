/**
 * Assignments are gone: the every-5th-map "Next Assignment" draft, its
 * contracts, missions and rewards were cut as too much. What that leaves:
 *
 *   - the map after every 5th is an ordinary one, so its shop opens like any
 *     other (the draft used to REPLACE the shop there);
 *   - the Specs panel's run section still shows the Promotion, the one
 *     run-defining pick that shared it with the contract.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act, cleanup, renderHook, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import "@/i18n";
import { TopBarDetailsPanel } from "@/components/game/TopBarDetailsPanel";
import { CapstoneConfig } from "@/types/capstone";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { LADDER_END } from "./fixtures/maps";

afterEach(cleanup);

const capstone: CapstoneConfig = {
  id: "stock_options", name: "Stock Options",
  description: "The per-map overtime cap rises by 20h.", tag: "risk",
  clarify: "", modifiers: {},
} as CapstoneConfig;

describe("Specs panel run section", () => {
  const panelProps = {
    visible: true, onClose: () => {},
    levelNumber: 7, cutsUsed: 1, parCuts: 10, lives: 3,
    spaceRemaining: 80, spaceRequired: 60, lockedBalls: 0,
    ownedUpgrades: [],
  };

  it("shows the Promotion's description", () => {
    render(<TopBarDetailsPanel {...panelProps} capstone={capstone} />);
    expect(screen.getByText("The per-map overtime cap rises by 20h.")).toBeTruthy();
  });

  it("shows nothing from the Promotion before one is taken", () => {
    render(<TopBarDetailsPanel {...panelProps} />);
    expect(screen.queryByText("The per-map overtime cap rises by 20h.")).toBeNull();
  });
});

describe("the map after every 5th (session integration)", () => {
  const PUBLIC = path.resolve(__dirname, "../../public");
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const file = String(url).split("?")[0].replace(/^\//, "");
      const full = path.join(PUBLIC, file);
      if (!fs.existsSync(full)) {
        return { ok: false, status: 404, text: async () => "" } as Response;
      }
      return { ok: true, status: 200, text: async () => fs.readFileSync(full, "utf8") } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  function useSession() {
    const nav = useScreenNavigation();
    return { nav, session: useGameSession(nav) };
  }

  it.runIf(LADDER_END >= 6)("opens the shop after map 5, like after any other map", async () => {
    const { result } = renderHook(() => useSession());
    await act(async () => { await result.current.session.handleStartGame(undefined, true); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));

    for (let map = 1; map <= 5; map++) {
      await act(async () => {
        result.current.session.handleLevelComplete({
          levelId: result.current.session.currentLevel!.id,
          levelScore: 30, cutCount: 10, expectedCuts: 10, remainingPercent: 30,
          lockedBallsCount: 2,
        } as never);
      });
      await act(async () => { result.current.session.handleContinueFromOverlay(); });
      // Every map, 5 included, lands in the shop.
      await waitFor(() => expect(result.current.nav.currentScreen, `after map ${map}`).toBe("upgradeShop"));
      await act(async () => { result.current.session.handleContinueFromShop(); });
      await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    }
    expect(result.current.session.currentLevelIndex).toBe(5);
  });
});
