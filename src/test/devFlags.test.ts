/**
 * Admin run flags (src/lib/devFlags.ts).
 *
 * "Infinite lives" is not a debug overlay: it changes how a NORMAL run plays so
 * a level-22 map can be reached without twenty clean clears. That makes two
 * things worth pinning. The flag must be read at CALL time, not at import, or
 * toggling it in the Admin panel would need a reload to take effect; and a
 * blocked localStorage (private mode, embedded webview) must degrade to "off"
 * rather than throwing on the run-start path.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  DEV_LIVES, baseStartingLives, isInfiniteLivesEnabled,
  setInfiniteLivesEnabled, resetDevFlagCache,
  debugMutatorId, setDebugMutatorOverride, forcedTilts, setForcedTiltsOverride,
  debugAscensionDepth, setDebugAscensionOverride, MAX_DEBUG_ASCENSION,
} from "@/lib/devFlags";

const NORMAL = 3;

beforeEach(() => {
  localStorage.clear();
  resetDevFlagCache();
});

describe("infinite lives", () => {
  it("is off unless it was switched on", () => {
    expect(isInfiniteLivesEnabled()).toBe(false);
    expect(baseStartingLives(NORMAL)).toBe(NORMAL);
  });

  it("hands out the dev count once enabled", () => {
    setInfiniteLivesEnabled(true);
    expect(baseStartingLives(NORMAL)).toBe(DEV_LIVES);
    // Big enough to survive a whole run, but a real number so every existing
    // lives comparison (perfect-level, continues) still behaves.
    expect(DEV_LIVES).toBeGreaterThan(100);
    expect(Number.isFinite(DEV_LIVES)).toBe(true);
  });

  it("goes back to normal when switched off again", () => {
    setInfiniteLivesEnabled(true);
    setInfiniteLivesEnabled(false);
    expect(baseStartingLives(NORMAL)).toBe(NORMAL);
  });

  /**
   * The reason baseStartingLives is a function and not a captured constant:
   * the Admin toggle has to bite on the next New Game, with no reload.
   */
  it("is read at call time, so a toggle applies to the next run", () => {
    expect(baseStartingLives(NORMAL)).toBe(NORMAL);
    setInfiniteLivesEnabled(true);
    expect(baseStartingLives(NORMAL)).toBe(DEV_LIVES); // no reset in between
  });

  it("survives a reload by persisting to storage", () => {
    setInfiniteLivesEnabled(true);
    resetDevFlagCache(); // simulate a fresh page load
    expect(isInfiniteLivesEnabled()).toBe(true);
  });

  it("leaves no key behind when off, so a Total Reset wipe is clean", () => {
    setInfiniteLivesEnabled(true);
    setInfiniteLivesEnabled(false);
    expect(localStorage.getItem("devend:infiniteLives")).toBeNull();
  });
});

describe("when localStorage is unavailable", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads as off instead of throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(() => isInfiniteLivesEnabled()).not.toThrow();
    expect(isInfiniteLivesEnabled()).toBe(false);
  });

  it("still applies in-memory for the rest of the session", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(() => setInfiniteLivesEnabled(true)).not.toThrow();
    expect(baseStartingLives(NORMAL)).toBe(DEV_LIVES);
  });
});

/**
 * The URL flags' session overrides, set from Admin and the Playground.
 *
 * URL-only flags were exactly as testable as they were discoverable. These
 * pin the three properties that make a control safe to add: it reads at call
 * time, it never outlives the session (no storage key, so a forced mutator
 * cannot haunt next week's normal runs), and a URL that says something still
 * wins over it, so a shared link means what it says.
 */
describe("session overrides for the URL flags", () => {
  it("are off until set, and clear with the cache", () => {
    expect(debugMutatorId()).toBeNull();
    expect(forcedTilts()).toBe(false);
    expect(debugAscensionDepth()).toBe(0);
    setDebugMutatorOverride("tipping");
    setForcedTiltsOverride(true);
    setDebugAscensionOverride(3);
    expect(debugMutatorId()).toBe("tipping");
    expect(forcedTilts()).toBe(true);
    expect(debugAscensionDepth()).toBe(3);
    resetDevFlagCache();
    expect(debugMutatorId()).toBeNull();
    expect(forcedTilts()).toBe(false);
    expect(debugAscensionDepth()).toBe(0);
  });

  it("never touch storage, so nothing survives a reload", () => {
    setDebugMutatorOverride("tipping");
    setForcedTiltsOverride(true);
    setDebugAscensionOverride(2);
    expect(localStorage.length).toBe(0);
  });

  it("clamp and sanitise like the URL parsers do", () => {
    setDebugAscensionOverride(MAX_DEBUG_ASCENSION + 40);
    expect(debugAscensionDepth()).toBe(MAX_DEBUG_ASCENSION);
    setDebugAscensionOverride(-1);
    expect(debugAscensionDepth()).toBe(0);
    setDebugAscensionOverride(2.9);
    expect(debugAscensionDepth()).toBe(2);
    setDebugMutatorOverride("   ");
    expect(debugMutatorId()).toBeNull();
  });

  it("lose to a URL that says otherwise", () => {
    const original = window.location;
    vi.stubGlobal("location", { ...original, search: "?mutator=gravity&ascension=5&tilt=1" });
    try {
      setDebugMutatorOverride("tipping");
      setDebugAscensionOverride(2);
      expect(debugMutatorId()).toBe("gravity");
      expect(debugAscensionDepth()).toBe(5);
      expect(forcedTilts()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
