/**
 * The two certificates that are on the shelf from the first run, doing their
 * jobs in a real session.
 *
 * Signing Bonus banks overtime hours before the run starts. Corporate Card
 * relaxes what the shop demands before it will sell to you: normally one lock,
 * or two on a map offering three or more balls.
 *
 * Driven through the session hook rather than tested as pure functions, because
 * both effects are about a value arriving at the right moment in a run's life:
 * the bonus has to survive every reset path, and the relief has to be read at
 * the point the shop decides whether it is open. Neither is something a unit
 * test on the modifier could show.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { setRunSeedText } from "@/lib/runRng";
import { CERT_STORAGE_KEY } from "@/types/certificate";

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

/** A save with `levels` of a certificate already bought. */
function owning(certId: string, levels: number) {
  localStorage.setItem(CERT_STORAGE_KEY, JSON.stringify({
    totalCertificateHours: 0,
    maxTierCounts: {},
    unlockedCertIds: [],       // deliberately empty: `always` must not need it
    certLevelsOwned: { [certId]: levels },
    lifetimeHoursSpent: 0,
  }));
}

async function startedSession() {
  const hook = renderHook(() => useSession());
  await act(async () => { await hook.result.current.session.handleStartGame(1, true); });
  await waitFor(() => expect(hook.result.current.session.upgrades.length).toBeGreaterThan(0));
  return hook;
}

describe("Signing Bonus", () => {
  it("starts the run at zero when it is not owned", async () => {
    const hook = await startedSession();
    expect(hook.result.current.session.totalScore).toBe(0);
  });

  it("banks its hours before a single map has been played", async () => {
    owning("signing-bonus", 1);
    const hook = await startedSession();
    expect(hook.result.current.session.totalScore).toBe(10);
  });

  it("stacks across its levels", async () => {
    for (const [levels, expected] of [[2, 20], [3, 30]] as const) {
      localStorage.clear();
      owning("signing-bonus", levels);
      const hook = await startedSession();
      expect(hook.result.current.session.totalScore, `level ${levels}`).toBe(expected);
    }
  });

  /**
   * There are four ways a run resets, and the bonus has to survive all of them.
   * It is applied in the one shared reset rather than at the individual start
   * handlers precisely so that adding a fifth cannot drop it.
   */
  it("is there again after Play Again and after Restart", async () => {
    owning("signing-bonus", 2);
    const hook = await startedSession();

    act(() => { hook.result.current.session.handlePlayAgain(); });
    await waitFor(() => expect(hook.result.current.session.totalScore).toBe(20));

    act(() => { hook.result.current.session.handleRestartRun(); });
    await waitFor(() => expect(hook.result.current.session.totalScore).toBe(20));
  });

  it("does not need unlocking, since it is always on the shelf", async () => {
    owning("signing-bonus", 1); // unlockedCertIds is empty in that save
    const hook = await startedSession();
    expect(hook.result.current.session.unlockedCertIds).toContain("signing-bonus");
    expect(hook.result.current.session.totalScore).toBe(10);
  });
});

describe("Corporate Card", () => {
  const reliefFor = async (levels: number) => {
    localStorage.clear();
    if (levels > 0) owning("corporate-card", levels);
    const hook = await startedSession();
    return hook.result.current.session.activeModifiers.storeLockRelief;
  };

  it("is off until bought", async () => {
    expect(await reliefFor(0)).toBe(0);
  });

  it("counts one step per level", async () => {
    expect(await reliefFor(1)).toBe(1);
    expect(await reliefFor(2)).toBe(2);
  });
});

/**
 * The rule the card bends, stated as a table so the effect is legible without
 * reading the session hook. Mirrors the computation there: normally one lock,
 * two once a map offers three or more balls.
 */
describe("what the shop asks for", () => {
  const required = (ballsOnMap: number, relief: number) =>
    relief >= 2 ? 0 : Math.min(relief >= 1 ? 1 : 2, ballsOnMap >= 3 ? 2 : 1);

  it("asks for one lock on a quiet map and two on a busy one", () => {
    expect(required(1, 0)).toBe(1);
    expect(required(2, 0)).toBe(1);
    expect(required(3, 0)).toBe(2);
    expect(required(5, 0)).toBe(2);
  });

  it("never asks for more than one at the first level", () => {
    for (const balls of [1, 2, 3, 5, 8]) expect(required(balls, 1)).toBe(1);
  });

  it("stops asking at the second", () => {
    for (const balls of [1, 2, 3, 5, 8]) expect(required(balls, 2)).toBe(0);
  });

  it("cannot be pushed below nothing by owning more", () => {
    for (const balls of [1, 3, 8]) expect(required(balls, 5)).toBe(0);
  });
});
