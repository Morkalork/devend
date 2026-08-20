/**
 * ?ascension=N: start a run already at that depth.
 *
 * Reaching depth N legitimately means clearing the whole map list N times, so
 * without this the later ladder rungs are effectively untestable by hand. The
 * flag exists to make rung 9 reachable in one page load.
 *
 * Two properties matter beyond "the number goes up". The run must be
 * ledger-ineligible, because an ascension you did not earn would poison
 * highscores exactly like the ?level= jump; and the depth must actually reach
 * the RULES, since a depth that moves a counter without switching the ladder on
 * would be a debug flag that lies about what it is testing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { useScreenNavigation } from "@/hooks/useScreenNavigation";
import { useGameSession } from "@/hooks/useGameSession";
import { setRunSeedText } from "@/lib/runRng";
import { parseAscensionParam, MAX_DEBUG_ASCENSION } from "@/lib/devFlags";

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
  window.history.replaceState(null, "", "/");
});

function useSession() {
  const nav = useScreenNavigation();
  return { nav, session: useGameSession(nav) };
}

/**
 * Put the debug params in the URL and let the game boot.
 *
 * A jump param auto-starts the run on mount, which is how it works in the
 * browser: you paste the URL, the game starts. Pressing New Game as well would
 * be a second run that no longer has the param (the first consumed it), which
 * is correct behaviour and not what these tests are about.
 */
async function startWith(query: string) {
  window.history.replaceState(null, "", query ? `/?${query}` : "/");
  const hook = renderHook(() => useSession());
  if (!query) {
    await act(async () => { await hook.result.current.session.handleStartGame(undefined, true); });
  }
  await waitFor(() => expect(hook.result.current.session.upgrades.length).toBeGreaterThan(0));
  return hook;
}

describe("reading the parameter", () => {
  it("is off when absent", () => {
    expect(parseAscensionParam("")).toBe(0);
    expect(parseAscensionParam("?level=4")).toBe(0);
  });

  it("takes a positive depth", () => {
    expect(parseAscensionParam("?ascension=1")).toBe(1);
    expect(parseAscensionParam("?ascension=7")).toBe(7);
  });

  it("ignores junk rather than starting a broken run", () => {
    for (const q of ["?ascension=0", "?ascension=-3", "?ascension=abc", "?ascension="]) {
      expect(parseAscensionParam(q), q).toBe(0);
    }
  });

  it("clamps absurd values", () => {
    expect(parseAscensionParam("?ascension=99999")).toBe(MAX_DEBUG_ASCENSION);
  });
});

describe("starting a run at depth", () => {
  it("starts at depth 0 with no parameter", async () => {
    const hook = await startWith("");
    expect(hook.result.current.session.ascensionDepth).toBe(0);
  });

  it("starts at the requested depth", async () => {
    const hook = await startWith("ascension=4");
    expect(hook.result.current.session.ascensionDepth).toBe(4);
  });

  /**
   * The point of the flag. A depth that did not switch the ladder on would let
   * a rung look tested when it never ran.
   */
  it("puts the ladder rungs into force, not just the counter", async () => {
    const hook = await startWith("ascension=4");
    const rules = hook.result.current.session.ascensionRules;
    expect(rules.shopEveryOtherLevel).toBe(true);  // rung 1
    expect(rules.doorOffers).toBe(2);              // rung 2
    expect(rules.noCapstone).toBe(true);           // rung 3
    expect(rules.fencesWearOut).toBe(true);        // rung 4
    expect(rules.everyMapMutated).toBe(false);     // rung 9, not yet
  });

  it("reaches the deepest rungs too", async () => {
    const hook = await startWith("ascension=10");
    const rules = hook.result.current.session.ascensionRules;
    expect(rules.everyMapMutated).toBe(true);
    expect(rules.pickupLifetimeFactor).toBeLessThan(1);
    expect(rules.forcedCurseLoadoutId).toBeTruthy();
  });

  it("turns on the ascension fence rule, which depth 0 never has", async () => {
    const plain = await startWith("");
    expect(plain.result.current.session.fenceDurability).toBeNull();

    const ascended = await startWith("ascension=4");
    expect(ascended.result.current.session.fenceDurability).toBeGreaterThan(0);
  });

  it("combines with a level jump as one instruction", async () => {
    const hook = await startWith("ascension=3&level=12");
    expect(hook.result.current.session.ascensionDepth).toBe(3);
    expect(hook.result.current.session.currentLevelIndex).toBe(11);
  });

  it("carries no drafted loadouts, so a rung is seen on its own", async () => {
    const hook = await startWith("ascension=6");
    expect(hook.result.current.session.draftedLoadoutIds).toEqual([]);
  });
});

describe("what the jump must not do", () => {
  /**
   * An ascension you did not earn must never reach the highscore ledger, the
   * same rule the ?level= jump has always followed.
   */
  it("consumes the parameter, so Play Again is an ordinary run", async () => {
    const hook = await startWith("ascension=5");
    expect(window.location.search).not.toContain("ascension");

    act(() => { hook.result.current.session.handlePlayAgain(); });
    await waitFor(() => expect(hook.result.current.session.ascensionDepth).toBe(0));
  });

  /**
   * The claim above, actually checked. An ineligible run files nothing, which
   * shows up as a null rank on the result screen: there is no ladder position
   * for a run the ladder never heard about.
   *
   * The run has to CLEAR a map first. A run that scored nothing files nothing
   * anyway, so ending one immediately would pass whether the flag was set or
   * not, which is exactly what an earlier version of this test did.
   */
  const playOneMapThenDie = async (query: string) => {
    const hook = await startWith(query);
    act(() => {
      hook.result.current.session.handleLevelComplete({
        levelNumber: 1, levelId: "l1", cutCount: 5, expectedCuts: 5,
        basePoints: 20, levelScore: 40, remainingPercent: 30,
      });
    });
    await waitFor(() => expect(hook.result.current.session.totalScore).toBeGreaterThan(0));
    act(() => {
      hook.result.current.session.handleGameEnd({
        isWin: false, remainingPercent: 70, levelId: "l1", levelNumber: 1,
      });
    });
    await waitFor(() => expect(hook.result.current.nav.currentScreen).toBe("result"));
    return hook;
  };

  it("files nothing on the highscore ledger", async () => {
    // Control: the same run without the jump DOES get a ladder position, so the
    // assertion below is about eligibility and not about scoring zero.
    const honest = await playOneMapThenDie("");
    expect(honest.result.current.session.lastRunRank).not.toBeNull();

    const jumped = await playOneMapThenDie("ascension=5");
    expect(jumped.result.current.session.lastRunRank).toBeNull();
  });

  it("consumes only its own parameter, leaving the rest of the query alone", async () => {
    await startWith("ascension=2&keepme=1");
    expect(window.location.search).not.toContain("ascension");
    expect(window.location.search).toContain("keepme=1");
  });
});
