/**
 * "I think we can remove the whole ascension part for now. The intent is
 * instead to add a large number of maps, and rely on replayability, meta
 * progress and fantastic maps."
 *
 * Beating the last map now ends the run, as a win: no Ascension draft, no loop
 * back to level 1. It is banked and filed through the same path a loss takes,
 * and the saved run is cleared, so the menu's Continue does not offer a run
 * that is over.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";

const PUBLIC = path.resolve(__dirname, "../../public");
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
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

describe("the last map", () => {
  it("ends the run as a win on the result screen, and clears the save", async () => {
    const { result } = renderHook(() => useSession());
    // Start a run, read how long the ladder is, then jump to its last map.
    await act(async () => { await result.current.session.handleStartGame(undefined, true); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("game"));
    const last = result.current.session.totalLevels;
    await act(async () => { await result.current.session.handleStartGame(last, true); });
    await waitFor(() => expect(result.current.session.currentLevelIndex).toBe(last - 1));

    await act(async () => {
      result.current.session.handleLevelComplete({
        levelId: result.current.session.currentLevel!.id,
        levelScore: 30, cutCount: 4, expectedCuts: 5, remainingPercent: 20, lockedBallsCount: 2,
      } as never);
    });
    await act(async () => { result.current.session.handleContinueFromOverlay(); });
    await waitFor(() => expect(result.current.nav.currentScreen).toBe("result"));

    const res = result.current.nav.lastResult!;
    expect(res.isWin).toBe(true);
    expect(res.completedAllLevels).toBe(true);
    expect(res.levelNumber).toBe(last);
    expect(localStorage.getItem("jezzball_run_v1")).toBeNull();
    expect(result.current.session.hasSavedRun).toBe(false);
  });
});

describe("nothing of Ascension is left to reach", () => {
  it("has no screen, no handler and no debug jump", () => {
    expect(fs.existsSync(path.resolve(process.cwd(), "src/ui/screens/AscensionDraftScreen.tsx"))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), "src/lib/ascensionLadder.ts"))).toBe(false);
    const session = read("src/hooks/useGameSession.ts");
    expect(session).not.toMatch(/handleAscend|ascensionDepth|goToAscensionDraft/);
    expect(read("src/lib/devFlags.ts")).not.toMatch(/ascension/i);
    expect(read("src/types/game.ts")).not.toMatch(/ascensionDraft/);
  });

  it("keeps every certificate reachable (Night School Diploma no longer needs an ascension)", () => {
    const certs = read("public/certificates.yml");
    expect(certs).not.toMatch(/beyond-the-backlog/);
    expect(read("public/achievements.yml")).not.toMatch(/deepestAscension/);
  });

  it("parks the loadouts: the catalogue stays, the menu entry waits for Sprint Planning", () => {
    expect(read("public/loadouts.yml")).toMatch(/^loadouts:/m);
    expect(read("public/loadouts.yml")).not.toMatch(/^ascension:/m);
    expect(read("src/pages/Index.tsx")).toContain("SPRINT_PLANNING_ENABLED && session.loadoutsIntroduced");
  });
});
