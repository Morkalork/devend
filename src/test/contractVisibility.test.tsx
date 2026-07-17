/**
 * Issue #49: the active assignment/Promotion are visible as hold-to-detail
 * chips in the game top bar, and the next assignment draft shows a report
 * card for the contract that just ended.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, renderHook, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import "@/i18n";
import { GameTopBar } from "@/components/game/GameTopBar";
import { DoorDraftScreen } from "@/components/game/DoorDraftScreen";
import { DoorConfig } from "@/types/door";
import { CapstoneConfig } from "@/types/capstone";
import { LevelConfig } from "@/types/level";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";

afterEach(cleanup);

const door: DoorConfig = {
  id: "crunch_sprint", name: "Crunch Sprint",
  risk: "Balls move 15% faster.", reward: "Earn 40% more overtime.",
  clarify: "", modifiers: {},
} as DoorConfig;
const capstone: CapstoneConfig = {
  id: "stock_options", name: "Stock Options",
  description: "The per-map overtime cap rises by 20h.", tag: "risk",
  clarify: "", modifiers: {},
} as CapstoneConfig;

describe("top-bar contract chips", () => {
  const barProps = {
    levelNumber: 7, cutsUsed: 1, parCuts: 10, lives: 3,
    spaceRemaining: 80, spaceRequired: 60, lockedBalls: 0,
    ownedUpgrades: [],
  };

  it("holding the assignment chip opens its risk/reward detail", () => {
    vi.useFakeTimers();
    try {
      render(<GameTopBar {...barProps} activeDoor={door} capstone={capstone} />);
      const chip = screen.getByRole("button", { name: "Crunch Sprint" });
      fireEvent.pointerDown(chip);
      act(() => { vi.advanceTimersByTime(500); });
      expect(screen.getByText("Balls move 15% faster.")).toBeTruthy();
      expect(screen.getByText("Earn 40% more overtime.")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("holding the Promotion chip opens its description", () => {
    vi.useFakeTimers();
    try {
      render(<GameTopBar {...barProps} activeDoor={null} capstone={capstone} />);
      fireEvent.pointerDown(screen.getByRole("button", { name: "Stock Options" }));
      act(() => { vi.advanceTimersByTime(500); });
      expect(screen.getByText("The per-map overtime cap rises by 20h.")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders no chips without an active door or capstone", () => {
    render(<GameTopBar {...barProps} />);
    expect(screen.queryByRole("button", { name: "Crunch Sprint" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stock Options" })).toBeNull();
  });
});

describe("assignment report card", () => {
  it("shows the finished contract's stats above the new offers", () => {
    const nextLevel = { id: "assign-x", level: 10, sizeThreshold: 25, expectedCuts: 14, points: 40, maxBalls: 2 } as unknown as LevelConfig;
    render(
      <DoorDraftScreen
        nextLevel={nextLevel}
        offers={[door]}
        onSelect={vi.fn()}
        previousContract={{ doorId: "crunch_sprint", doorName: "Crunch Sprint", overtime: 150, maps: 5, locks: 10, livesLost: 1 }}
      />
    );
    expect(screen.getByText(/Last contract: Crunch Sprint/)).toBeTruthy();
    expect(screen.getByText("150h")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
  });
});

describe("contract stats accumulate across the block (session integration)", () => {
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

  it("the second assignment draft reports the first contract's block", async () => {
    const { result } = renderHook(() => useSession());
    await act(async () => { await result.current.session.handleStartGame(undefined, true); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));

    const finishMap = async (score: number, locks: number) => {
      await act(async () => {
        result.current.session.handleLevelComplete({
          levelId: result.current.session.currentLevel!.id,
          levelScore: score, cutCount: 10, expectedCuts: 10, remainingPercent: 30,
          lockedBallsCount: locks,
        } as never);
      });
      await act(async () => { result.current.session.handleContinueFromOverlay(); });
      if (result.current.nav.currentScreen === "upgradeShop") {
        await act(async () => { result.current.session.handleContinueFromShop(); });
      }
    };

    // Maps 1-4 route through shops; map 5 opens the FIRST assignment draft.
    for (let i = 0; i < 5; i++) await finishMap(30, 1);
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("doorDraft"));
    // Nothing to report yet: no contract ran before the first assignment.
    expect(result.current.session.lastContractSummary).toBeNull();

    await act(async () => { result.current.session.handleSelectDoor(result.current.session.doorOffers[0]); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));

    // Maps 6-9 through shops; map 10 ends the contract's block. Level 10 is
    // also the Promotion trigger, so pick the capstone to reach the draft.
    for (let i = 0; i < 5; i++) await finishMap(30, 2);
    if (result.current.nav.currentScreen === "capstoneDraft") {
      await act(async () => { result.current.session.handleSelectCapstone(result.current.session.capstoneOffers[0]); });
    }
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("doorDraft"));

    // The report card covers exactly the contract's 5 maps.
    expect(result.current.session.lastContractSummary).toMatchObject({
      overtime: 150, maps: 5, locks: 10, livesLost: 0,
    });
  });
});
