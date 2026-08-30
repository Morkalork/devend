/**
 * Ascending starts a fresh run. It used to carry the whole one across.
 *
 * Reported as "right now you keep it all, which is pointless", and that is
 * exactly the shape of it: you re-entered level 1 with a build assembled over
 * thirty-five maps, so the ladder's new rule landed on a player who could buy
 * everything back on the first shop. The loop was easier than the run that
 * earned it, and the harder rules it exists to impose meant nothing.
 *
 * What must survive is narrow and is the whole point of ascending: the depth,
 * the loadouts stacked on the way up, and the certificate-hours accumulator,
 * which is meta progress mid-flight and is banked when the run finally ends.
 * Zeroing that last one would silently delete what the player ascended to keep
 * earning, and it is the one thing here with no visible symptom if it breaks.
 *
 * Driven through the real hook rather than asserted on the source, because the
 * bug was never in one line: it was in which of a dozen setters the ascension
 * path happened to call. Only running it shows that.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGameSession } from "@/hooks/useGameSession";
import type { useScreenNavigation } from "@/hooks/useScreenNavigation";

// The session hook pulls in the real i18n singleton (via totalReset), so this
// mock has to keep initReactI18next rather than replace the module wholesale.
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));

/**
 * The certificate-hours accumulator is in-memory and cannot be seeded from the
 * hook's public surface (restoreRunProgress is internal, and map.yml does not
 * fetch under jsdom, so no level can be completed to raise it). Asserting it is
 * "still 0" after ascending would therefore pass whether or not the reset
 * fires, which is a test that measures nothing.
 *
 * So the call itself is watched instead. The real hook runs; only
 * resetRunProgress is wrapped, and the question asked is exactly the invariant:
 * an ordinary run start zeroes the hours, an ascension must not.
 */
const resetRunProgressSpy = vi.fn();
vi.mock("@/hooks/useCertificateManager", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const real = actual.useCertificateManager as (...a: unknown[]) => Record<string, unknown>;
  return {
    ...actual,
    useCertificateManager: (...args: unknown[]) => {
      const out = real(...args);
      return {
        ...out,
        resetRunProgress: (...r: unknown[]) => {
          resetRunProgressSpy();
          return (out.resetRunProgress as (...a: unknown[]) => unknown)(...r);
        },
      };
    },
  };
});

/** Navigation is a bag of no-ops: this is about state, not routing. */
const nav = new Proxy({}, {
  get: (_t, prop) => (prop === "currentScreen" ? "game" : () => {}),
}) as unknown as ReturnType<typeof useScreenNavigation>;

const session = () => renderHook(() => useGameSession(nav));

beforeEach(() => { localStorage.clear(); resetRunProgressSpy.mockClear(); });

describe("what an ascension clears", () => {
  it("drops every upgrade bought on the way up", async () => {
    const { result } = session();

    await act(async () => {
      result.current.handlePurchaseUpgrade("some_upgrade", 0);
      result.current.handlePurchaseUpgrade("another_upgrade", 0);
    });
    expect(result.current.ownedUpgradeIds).toHaveLength(2);

    await act(async () => { result.current.handleAscend("loadout_a"); });
    expect(
      result.current.ownedUpgradeIds,
      "the new loop started with the old build still owned",
    ).toEqual([]);
  });

  it("drops the banked overtime, or the upgrades come straight back", async () => {
    const { result } = session();

    // A negative price is the test's lever for putting score on the clock:
    // handlePurchaseUpgrade is the only exposed writer of totalScore. Keeping
    // the run's score would let the player re-buy the build they just lost on
    // the first shop of the new loop, which is the same bug wearing a hat.
    await act(async () => { result.current.handlePurchaseUpgrade("x", -500); });
    expect(result.current.totalScore).toBe(500);

    await act(async () => { result.current.handleAscend("loadout_a"); });
    expect(result.current.totalScore).toBe(0);
  });
});

describe("what an ascension keeps", () => {
  it("raises the depth", async () => {
    const { result } = session();
    expect(result.current.ascensionDepth).toBe(0);

    await act(async () => { result.current.handleAscend("loadout_a"); });
    expect(result.current.ascensionDepth).toBe(1);
  });

  it("stacks the drafted loadouts rather than replacing them", async () => {
    const { result } = session();

    await act(async () => { result.current.handleAscend("loadout_a"); });
    await act(async () => { result.current.handleAscend("loadout_b"); });

    expect(result.current.draftedLoadoutIds).toEqual(["loadout_a", "loadout_b"]);
    expect(result.current.ascensionDepth).toBe(2);
  });

  it("never zeroes the certificate-hours accumulator", async () => {
    // The invariant with no visible symptom. The hours are banked when the run
    // ENDS, so clearing them mid-ascension silently throws away every level
    // cleared before it, and nothing on screen would say so.
    const { result } = session();
    resetRunProgressSpy.mockClear();

    await act(async () => { result.current.handleAscend("loadout_a"); });

    expect(
      resetRunProgressSpy,
      "ascending reset the meta progress it exists to keep earning",
    ).not.toHaveBeenCalled();
  });
});

describe("a fresh run start still clears everything", () => {
  it("takes the depth and the loadouts with it", async () => {
    // The `keepAscension` flag must not leak into the ordinary reset paths, or
    // "play again" would quietly start at depth.
    const { result } = session();

    await act(async () => { result.current.handleAscend("loadout_a"); });
    expect(result.current.ascensionDepth).toBe(1);

    resetRunProgressSpy.mockClear();
    await act(async () => { result.current.handlePlayAgain(); });
    expect(result.current.ascensionDepth).toBe(0);
    expect(result.current.draftedLoadoutIds).toEqual([]);
    // And the ordinary path DOES zero the hours, which is what makes the
    // ascension assertion above a real distinction rather than a spy that
    // never fires for anyone.
    expect(resetRunProgressSpy).toHaveBeenCalled();
  });
});
