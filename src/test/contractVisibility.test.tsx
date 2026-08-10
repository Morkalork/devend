/**
 * Issue #49 / #61 / #63: the active assignment/Promotion are visible in the
 * Specs panel (TopBarDetailsPanel), and the finished contract is recapped on a
 * dedicated "Assignment Complete" summary screen at each block boundary.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act, cleanup, renderHook, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import "@/i18n";
import { TopBarDetailsPanel } from "@/components/game/TopBarDetailsPanel";
import { AssignmentSummaryScreen } from "@/components/game/AssignmentSummaryScreen";
import { AssignmentConfig } from "@/types/assignment";
import { CapstoneConfig } from "@/types/capstone";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";

afterEach(cleanup);

const door: AssignmentConfig = {
  id: "crunch_sprint", name: "Crunch Sprint",
  constraint: { text: "Balls move 15% faster.", modifiers: { ballSpeedMultiplier: 1.15 } },
  mission: {
    text: "Lock 20 balls over 5 maps.",
    track: { mode: "cumulative", kind: "lockCount" },
    tiers: [{ threshold: 20, label: "+2 lives", reward: { type: "lives", count: 2 } }],
  },
  clarify: "",
};
const capstone: CapstoneConfig = {
  id: "stock_options", name: "Stock Options",
  description: "The per-map overtime cap rises by 20h.", tag: "risk",
  clarify: "", modifiers: {},
} as CapstoneConfig;

describe("Specs panel assignment section", () => {
  const panelProps = {
    visible: true, onClose: () => {},
    levelNumber: 7, cutsUsed: 1, parCuts: 10, lives: 3,
    spaceRemaining: 80, spaceRequired: 60, lockedBalls: 0,
    ownedUpgrades: [],
  };

  it("shows the assignment's constraint and mission", () => {
    render(<TopBarDetailsPanel {...panelProps} activeDoor={door} capstone={capstone} />);
    expect(screen.getByText("Balls move 15% faster.")).toBeTruthy();
    expect(screen.getByText("Lock 20 balls over 5 maps.")).toBeTruthy();
  });

  it("shows the Promotion's description", () => {
    render(<TopBarDetailsPanel {...panelProps} activeDoor={null} capstone={capstone} />);
    expect(screen.getByText("The per-map overtime cap rises by 20h.")).toBeTruthy();
  });

  it("shows nothing from the assignment without an active door or capstone", () => {
    render(<TopBarDetailsPanel {...panelProps} />);
    expect(screen.queryByText("Balls move 15% faster.")).toBeNull();
    expect(screen.queryByText("The per-map overtime cap rises by 20h.")).toBeNull();
  });
});

describe("assignment summary screen (#63)", () => {
  it("recaps the finished mission, block stats, and the reward earned", () => {
    render(
      <AssignmentSummaryScreen
        assignment={door}
        results={[]}
        blockStats={{ locks: 10, livesLost: 1 }}
        rewardLabel="+2 lives"
        onContinue={vi.fn()}
      />
    );
    expect(screen.getByText("Assignment Complete")).toBeTruthy();
    expect(screen.getByText("Lock 20 balls over 5 maps.")).toBeTruthy();
    // Locks landed is shown; overtime + map count were trimmed as noise (#63).
    expect(screen.getByText("10")).toBeTruthy();
    // The reward label appears in both the callout and the tier ladder row.
    expect(screen.getAllByText("+2 lives").length).toBeGreaterThan(0);
  });

  it("shows a closure note when the mission was missed (no reward)", () => {
    render(
      <AssignmentSummaryScreen
        assignment={door}
        results={[]}
        blockStats={{ locks: 3, livesLost: 2 }}
        rewardLabel={null}
        onContinue={vi.fn()}
      />
    );
    expect(screen.getByText(/fell short of the mission/)).toBeTruthy();
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

    // Maps 6-9 through shops; map 10 ends the contract's block. The finished
    // mission is recapped on its own screen first (#63); continuing from it
    // routes into the Promotion draft (level 10 is the trigger), then the
    // next assignment draft.
    for (let i = 0; i < 5; i++) await finishMap(30, 2);
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("assignmentSummary"));
    await act(async () => { result.current.session.handleContinueFromSummary(); });
    // Continuing from the summary walks asynchronously through however many
    // reward screens this contract earned before reaching the next assignment.
    //
    // WHICH screens appear is not fixed: the Promotion draft rides the level-10
    // trigger, and a tierDraft appears only when the drafted assignment's
    // mission tiers were actually met - and which assignment gets drafted is
    // seeded RNG. An earlier de-flake enumerated capstoneDraft/doorDraft and so
    // still failed roughly one run in four, on `tierDraft`, because it had
    // guessed at the set instead of draining it.
    //
    // So drain: clear whatever intermediate draft is on screen until the
    // assignment draft arrives. The bound stops a routing bug from hanging the
    // suite instead of failing it.
    for (let guard = 0; guard < 6; guard++) {
      await waitFor(() =>
        expect(["capstoneDraft", "tierDraft", "doorDraft"]).toContain(result.current.nav.currentScreen),
      );
      const screen = result.current.nav.currentScreen;
      if (screen === "doorDraft") break;
      if (screen === "capstoneDraft") {
        await act(async () => { result.current.session.handleSelectCapstone(result.current.session.capstoneOffers[0]); });
      } else {
        await act(async () => {
          result.current.session.handleSelectTierUpgrade(result.current.session.pendingTierDraft!.offers[0].id);
        });
      }
    }
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("doorDraft"));

    // The report card covers exactly the contract's 5 maps.
    expect(result.current.session.lastContractSummary).toMatchObject({
      overtime: 150, maps: 5, locks: 10, livesLost: 0,
    });
  });
});
