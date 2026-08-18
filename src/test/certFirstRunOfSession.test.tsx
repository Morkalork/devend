/**
 * Certificates apply to the FIRST run of a session, not just every run after it.
 *
 * The catalogues are fetched inside the run-start handlers themselves, so any
 * value those handlers read out of React state was captured before the fetch
 * resolved. On the first run of a session that state is still empty; by the
 * second run a re-render has refreshed the closure and everything works. A bug
 * that only shows on the very first go and then hides for the rest of the
 * session is one nobody can reproduce on demand, so the rule here is that a
 * run-start path reads certificates through the synchronous accessor, never
 * through the memo.
 *
 * Head Start is the loud case: without this, buying "begin at level 5" would
 * silently drop you on level 1 the first time you pressed New Game after
 * opening the game.
 *
 * Everything is driven through the real session hook against the real
 * certificates.yml, because the fault was never in the arithmetic (which unit
 * tests covered) but in WHEN the arithmetic ran.
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

/** A save with certificate levels already bought, as a returning player has. */
function owning(owned: Record<string, number>) {
  localStorage.setItem(CERT_STORAGE_KEY, JSON.stringify({
    totalCertificateHours: 0,
    maxTierCounts: {},
    unlockedCertIds: Object.keys(owned),
    certLevelsOwned: owned,
    lifetimeHoursSpent: 0,
  }));
}

/**
 * Press New Game on a freshly opened game: the hook is rendered and the handler
 * called without ever letting a render settle in between, which is the exact
 * window the stale closure lives in. Passing no forceLevel is essential, since
 * a forced level bypasses the Head Start lookup entirely.
 */
async function firstRunOfSession() {
  const hook = renderHook(() => useSession());
  await act(async () => { await hook.result.current.session.handleStartGame(undefined, true); });
  await waitFor(() => expect(hook.result.current.session.upgrades.length).toBeGreaterThan(0));
  return hook;
}

async function firstDailyOfSession() {
  const hook = renderHook(() => useSession());
  await act(async () => { await hook.result.current.session.handleStartDaily(); });
  await waitFor(() => expect(hook.result.current.session.upgrades.length).toBeGreaterThan(0));
  return hook;
}

describe("Head Start on the first New Game of a session", () => {
  it("begins on level 1 when no head start is owned", async () => {
    const hook = await firstRunOfSession();
    expect(hook.result.current.session.currentLevelIndex).toBe(0);
  });

  it("begins on the bought level straight away, not from the second run on", async () => {
    owning({ "head-start-i": 1 }); // "Begin every run at level 5"
    const hook = await firstRunOfSession();
    expect(hook.result.current.session.currentLevelIndex).toBe(4);
  });

  it("takes the highest head start owned rather than adding them up", async () => {
    owning({ "head-start-i": 1, "head-start-ii": 1 }); // levels 5 and 10
    const hook = await firstRunOfSession();
    expect(hook.result.current.session.currentLevelIndex).toBe(9);
  });

  /** The label under the result screen's Play Again reads this too. */
  it("reports the same level it actually started on", async () => {
    owning({ "head-start-ii": 1 });
    const hook = await firstRunOfSession();
    expect(hook.result.current.session.certStartingLevel).toBe(10);
  });

  it("still yields to an explicit debug level jump", async () => {
    owning({ "head-start-ii": 1 });
    const hook = renderHook(() => useSession());
    await act(async () => { await hook.result.current.session.handleStartGame(3, true); });
    await waitFor(() => expect(hook.result.current.session.upgrades.length).toBeGreaterThan(0));
    expect(hook.result.current.session.currentLevelIndex).toBe(2);
  });
});

describe("extra lives on the first run of a session", () => {
  const livesAfterFirstRun = async (owned: Record<string, number>) => {
    localStorage.clear();
    if (Object.keys(owned).length) owning(owned);
    const hook = await firstRunOfSession();
    return hook.result.current.session.currentLives;
  };

  it("grants them on the first New Game, not only later ones", async () => {
    const base = await livesAfterFirstRun({});
    expect(await livesAfterFirstRun({ "resilience-protocol": 2 })).toBe(base + 2);
  });

  it("grants them on the first Daily Stand-up too", async () => {
    const plain = await firstDailyOfSession();
    const base = plain.result.current.session.currentLives;

    localStorage.clear();
    owning({ "resilience-protocol": 3 });
    const upgraded = await firstDailyOfSession();
    expect(upgraded.result.current.session.currentLives).toBe(base + 3);
  });
});

/**
 * The Daily is the same run for everyone on the day, so a bought head start
 * must not move one player's start line. This is a deliberate exception, not
 * an oversight, and it is easy to undo by accident while fixing the above.
 */
describe("the Daily Stand-up", () => {
  it("ignores Head Start and begins at level 1 for everyone", async () => {
    owning({ "head-start-ii": 1 });
    const hook = await firstDailyOfSession();
    expect(hook.result.current.session.currentLevelIndex).toBe(0);
  });
});
