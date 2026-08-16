/**
 * Tenure fires from every way of starting a run, not just New Game.
 *
 * Reported: got past map 10, lost, pressed Play Again on the result screen, got
 * no head start. The roll lived inside the New Game handler only; Play Again and
 * Restart went straight to the loadout draft. So the most natural way there is
 * to start the next run, the button right under the score of the run that just
 * earned the head start, was the one path that silently skipped it.
 *
 * The tell was that both other paths already ran the loadout draft, and Tenure
 * is specified to be picked BEFORE that draft. It was an omission, not a rule.
 *
 * These tests drive the real session hook against the real catalogues, because
 * the bug was never in the Tenure logic (which was well covered) but in which
 * call sites reached it. Only an end-to-end path check could have caught it.
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

/** The shallowest depth that earns a head start. */
const EARNING_DEPTH = TENURE_THRESHOLDS[0];

/**
 * Get the session into the state the report describes: a run that reached
 * `depth` has ended, and the catalogues are loaded.
 *
 * The depth is written to storage the way a finished run leaves it, rather than
 * poked into the hook, so what is under test is the same value a real Play Again
 * would read.
 */
async function afterARunThatReached(depth: number) {
  localStorage.setItem(META_STATS_STORAGE_KEY, JSON.stringify({ lastRunDepth: depth }));
  const hook = renderHook(() => useSession());
  await act(async () => { await hook.result.current.session.handleStartGame(1, true); });
  await waitFor(() => expect(hook.result.current.session.upgrades.length).toBeGreaterThan(0));
  return hook;
}

describe("starting the next run after one that earned a head start", () => {
  it("offers Tenure from Play Again, the button under the score", async () => {
    const hook = await afterARunThatReached(EARNING_DEPTH);

    act(() => { hook.result.current.session.handlePlayAgain(); });

    await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("tenureDraft"));
    expect(hook.result.current.session.pendingTenure?.offers.length).toBeGreaterThan(0);
    expect(hook.result.current.session.pendingTenure?.earnedAtLevel).toBe(EARNING_DEPTH);
  });

  it("offers Tenure from Restart", async () => {
    const hook = await afterARunThatReached(EARNING_DEPTH);

    act(() => { hook.result.current.session.handleRestartRun(); });

    await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("tenureDraft"));
    expect(hook.result.current.session.pendingTenure?.offers.length).toBeGreaterThan(0);
  });

  it("still offers Tenure from New Game", async () => {
    const hook = await afterARunThatReached(EARNING_DEPTH);

    await act(async () => { await hook.result.current.session.handleStartGame(); });

    await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("tenureDraft"));
    expect(hook.result.current.session.pendingTenure?.offers.length).toBeGreaterThan(0);
  });

  it("grants a deeper chain for a deeper run, whichever button is used", async () => {
    const hook = await afterARunThatReached(TENURE_THRESHOLDS[1]);

    act(() => { hook.result.current.session.handlePlayAgain(); });

    await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("tenureDraft"));
    // Two tiers at the second threshold, one at the first.
    for (const offer of hook.result.current.session.pendingTenure!.offers) {
      expect(offer.upgrades).toHaveLength(2);
    }
  });
});

describe("when no head start was earned", () => {
  it("Play Again goes straight on, with no empty draft screen", async () => {
    const hook = await afterARunThatReached(EARNING_DEPTH - 1);

    act(() => { hook.result.current.session.handlePlayAgain(); });

    await waitFor(() => expect(hook.result.current.nav.currentScreen).not.toBe("result"));
    expect(hook.result.current.nav.currentScreen).not.toBe("tenureDraft");
    expect(hook.result.current.session.pendingTenure).toBeNull();
  });

  it("Restart goes straight on too", async () => {
    const hook = await afterARunThatReached(0);

    act(() => { hook.result.current.session.handleRestartRun(); });

    await waitFor(() => expect(hook.result.current.nav.currentScreen).not.toBe("result"));
    expect(hook.result.current.nav.currentScreen).not.toBe("tenureDraft");
  });
});
