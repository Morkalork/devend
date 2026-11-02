/**
 * Tenure is good for ONE run (owner, 2026-11-02): "only available for the next
 * game, not the next games. Just once, you have to earn it again afterwards."
 *
 * It used to stay owed until a run ENDED, because only the run-end path wrote
 * the depth it reads. So a run abandoned for a new one (the in-game Restart,
 * Play Again over a live run, New Game over a saved one) dealt it again, as
 * often as the player liked. Now dealing it into a run that starts spends it,
 * whichever card the player took.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { setRunSeedText } from "@/lib/runRng";
import { TENURE_THRESHOLDS } from "@/lib/tenure";
import { META_STATS_STORAGE_KEY } from "@/types/metaProgression";
import { getForcedTenureDepth, setForcedTenureDepth } from "@/lib/devFlags";

const PUBLIC = path.resolve(__dirname, "../../public");

beforeEach(() => {
  localStorage.clear();
  setForcedTenureDepth(null);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const file = String(url).split("?")[0].replace(/^\//, "");
    const full = path.join(PUBLIC, file);
    if (!fs.existsSync(full)) {
      return { ok: false, status: 404, text: async () => "" } as Response;
    }
    return { ok: true, status: 200, text: async () => fs.readFileSync(full, "utf8") } as Response;
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  setRunSeedText(null);
  setForcedTenureDepth(null);
});

function useSession() {
  const nav = useScreenNavigation();
  return { nav, session: useGameSession(nav) };
}

type Hook = ReturnType<typeof renderHook<ReturnType<typeof useSession>, unknown>>;

const storedDepth = () =>
  (JSON.parse(localStorage.getItem(META_STATS_STORAGE_KEY) ?? "{}") as { lastRunDepth?: number }).lastRunDepth;

/** A run is in progress, with `depth` recorded for the last ended one. */
async function midRun(depth: number): Promise<Hook> {
  localStorage.setItem(META_STATS_STORAGE_KEY, JSON.stringify({ lastRunDepth: depth }));
  const hook = renderHook(() => useSession());
  await act(async () => {
    await hook.result.current.session.handleStartGame(1, true);
  });
  await waitFor(() => expect(hook.result.current.session.upgrades.length).toBeGreaterThan(0));
  return hook;
}

/** Restart the run (Play Again, as the in-game Restart does) and say whether Tenure was dealt. */
async function restartDealsTenure(hook: Hook): Promise<boolean> {
  act(() => {
    hook.result.current.session.handlePlayAgain();
  });
  await waitFor(() => expect(["runDraft", "game"]).toContain(hook.result.current.nav.currentScreen));
  const cards = hook.result.current.session.pendingSprint?.cards ?? [];
  return cards.some(c => c.tenure);
}

describe("Tenure is spent by the run it is dealt into", () => {
  it("is not dealt again after it was taken", async () => {
    const hook = await midRun(TENURE_THRESHOLDS[0]);
    expect(await restartDealsTenure(hook), "the earned run gets it").toBe(true);
    act(() => {
      hook.result.current.session.handleSprintPick(0);
    });
    expect(storedDepth()).toBe(0);
    expect(await restartDealsTenure(hook), "the run after does not").toBe(false);
  });

  it("is spent when another card is taken instead", async () => {
    const hook = await midRun(TENURE_THRESHOLDS[1]);
    expect(await restartDealsTenure(hook)).toBe(true);
    const cards = hook.result.current.session.pendingSprint!.cards;
    const other = cards.findIndex(c => !c.tenure);
    expect(other).toBeGreaterThan(-1);
    act(() => {
      hook.result.current.session.handleSprintPick(other);
    });
    expect(await restartDealsTenure(hook)).toBe(false);
  });

  it("is spent when the draft is skipped", async () => {
    const hook = await midRun(TENURE_THRESHOLDS[2]);
    expect(await restartDealsTenure(hook)).toBe(true);
    act(() => {
      hook.result.current.session.handleSprintPick(null);
    });
    expect(await restartDealsTenure(hook)).toBe(false);
  });
});

describe("Admin's owed Tenure", () => {
  it("deals it once, and clears itself when it is claimed", async () => {
    const hook = await midRun(0);
    setForcedTenureDepth(TENURE_THRESHOLDS[0]);
    expect(await restartDealsTenure(hook)).toBe(true);
    act(() => {
      hook.result.current.session.handleSprintPick(0);
    });
    expect(getForcedTenureDepth()).toBeNull();
    expect(await restartDealsTenure(hook)).toBe(false);
  });
});
