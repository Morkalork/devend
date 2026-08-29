/**
 * Total Reset (Options): clearAllGameState must delete every game-state key from
 * localStorage while preserving genuine device preferences (language, sound
 * volumes, renderer). This is the "complete deletion of all state" guarantee.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { clearAllGameState, performTotalReset } from "@/lib/totalReset";
import { installRunFlushListeners, registerRunFlush, flushRunSave } from "@/lib/runSaveFlush";
import { LANGUAGE_STORAGE_KEY } from "@/i18n";

// A representative spread of real game-state keys across the app's stores.
const GAME_STATE_KEYS = [
  "jezzball_certs_v1",
  "jezzball_meta_stats",
  "jezzball_unlock_state",
  "jezzball_achievements_v1",
  "jezzball_hall_v1",
  "jezzball_run_v1",
  "jezzball_checkpoints_v2",
  "tutorials_seen_v1",
  "ball_breaker_seen_interactive_tutorial",
  "devend_break_tutorial_seen",
  "devend_creep_tutorial_seen",
  "devend_boss_intro_level-10", // dynamic per-map key
  "menu_highlights_v1",
  "devend:abilitiesSeen",
];

const PRESERVED_KEYS = [
  LANGUAGE_STORAGE_KEY, // 'jezzball_language'
  "devend:renderer",
  "devend:musicVolume",
  "devend:sfxVolume",
  "devend:soundMuted",
];

describe("clearAllGameState", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  // Leave storage empty (the natural start state) so this file can't leak keys
  // into another test file sharing the jsdom localStorage.
  afterEach(() => {
    localStorage.clear();
  });

  it("removes every game-state key", () => {
    for (const k of GAME_STATE_KEYS) localStorage.setItem(k, "x");
    clearAllGameState();
    for (const k of GAME_STATE_KEYS) {
      expect(localStorage.getItem(k)).toBeNull();
    }
  });

  it("preserves device preferences (language, sound, renderer)", () => {
    for (const k of PRESERVED_KEYS) localStorage.setItem(k, "pref");
    clearAllGameState();
    for (const k of PRESERVED_KEYS) {
      expect(localStorage.getItem(k)).toBe("pref");
    }
  });

  it("wipes game state even when it shares the jezzball_ prefix with a kept pref", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "sv");
    localStorage.setItem("jezzball_meta_stats", "x");
    clearAllGameState();
    expect(localStorage.getItem("jezzball_meta_stats")).toBeNull();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("sv");
  });

  it("removes unknown/future keys too (allowlist, not denylist)", () => {
    localStorage.setItem("some_future_progress_key", "x");
    clearAllGameState();
    expect(localStorage.getItem("some_future_progress_key")).toBeNull();
  });
});

/**
 * A Total Reset must also abort the run in progress.
 *
 * Reported as "a total reset should abort any current game as well", and the
 * cause was a loop rather than a missing feature: the reset clears storage and
 * reloads, the reload fires `pagehide`, and `pagehide` is exactly what the
 * run-save flush listens to. So the run being deleted was written straight back
 * into the storage that had just been cleared, and the player who asked for a
 * clean install came back to the map they were on.
 *
 * The order is the whole fix, so the test drives the real listeners rather than
 * calling the pieces in the order it would like them to be called in.
 */
describe('a reset survives the reload that follows it', () => {
  it('does not let the teardown flush write the run back', () => {
    const uninstall = installRunFlushListeners();
    registerRunFlush(() => localStorage.setItem('devend:run', 'the run came back'));
    localStorage.setItem('devend:run', 'a run in progress');

    performTotalReset();
    // performTotalReset reloads; jsdom cannot, so fire the event the reload
    // would have fired. This is the exact sequence that resurrected the run.
    window.dispatchEvent(new Event('pagehide'));

    expect(localStorage.getItem('devend:run')).toBeNull();
    uninstall();
  });

  it('stays disabled for a later flush, not just the first', () => {
    // Any render between the reset and the reload landing could re-register the
    // flush, so a one-shot guard would be undone by ordinary React churn.
    const uninstall = installRunFlushListeners();
    performTotalReset();
    registerRunFlush(() => localStorage.setItem('devend:run', 'late write'));
    window.dispatchEvent(new Event('pagehide'));
    flushRunSave();

    expect(localStorage.getItem('devend:run')).toBeNull();
    uninstall();
  });

  it('still keeps genuine device preferences', () => {
    // The reset must abort the game, not reconfigure the device.
    localStorage.setItem('devend:sfxVolume', '0.4');
    performTotalReset();
    expect(localStorage.getItem('devend:sfxVolume')).toBe('0.4');
  });
});
