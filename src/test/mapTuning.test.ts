/**
 * Live map tuning (src/lib/mapTuning.ts).
 *
 * The tuner overlays per-map overrides onto the level object the game plays, so
 * the win check, HUD and scoring pick them up without knowing it exists. Three
 * things are worth pinning:
 *
 * 1. OBJECT IDENTITY. The level must always come back as the SAME object. It
 *    flows into GameCanvas, which tears down and re-inits the running game
 *    whenever it changes, so a copy would rebuild the identical board and throw
 *    away the player's cuts on every tweak. Overrides are written in place.
 * 2. Because they are written in place, clearing an override has to RESTORE the
 *    authored value from a baseline captured before the first write, not merely
 *    stop overwriting it.
 * 3. A tuned run must be detectable, because it has to be kept off the ledger.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  applyMapTuning, authoredBaseline, clearAllMapTuning, clearMapTuning,
  getMapTuning, hasAnyMapTuning, isMapTuned, mapTuningVersion,
  resetMapTuningBaselines, resetMapTuningCache, setMapTuning,
  subscribeMapTuning, tuningAsYaml,
} from "@/lib/mapTuning";
import type { LevelConfig } from "@/types/level";

/** Fresh each test: applyMapTuning writes to the level object in place. */
const makeLevel = (id = "level-22"): LevelConfig => ({
  id, level: 22, sizeThreshold: 16, expectedCuts: 6,
  points: 20, maxBalls: 2, entities: [],
} as unknown as LevelConfig);

let LEVEL: LevelConfig;

beforeEach(() => {
  localStorage.clear();
  resetMapTuningCache();
  LEVEL = makeLevel();
});

describe("applying overrides to the played level", () => {
  /**
   * THE load-bearing property. GameCanvas re-inits the whole game when the
   * `level` prop changes identity, so a copy here would rebuild the identical
   * board and throw away the player's cuts on every single tweak.
   */
  it("always returns the very same object, tuned or not", () => {
    expect(applyMapTuning(LEVEL)).toBe(LEVEL);
    setMapTuning(LEVEL.id, { expectedCuts: 4 });
    expect(applyMapTuning(LEVEL)).toBe(LEVEL);
  });

  it("writes only the tuned fields, leaving the rest alone", () => {
    const entities = LEVEL.entities;
    setMapTuning(LEVEL.id, { expectedCuts: 4 });
    const tuned = applyMapTuning(LEVEL)!;

    expect(tuned.expectedCuts).toBe(4);
    expect(tuned.sizeThreshold).toBe(16); // untouched
    expect(tuned.entities).toBe(entities); // geometry never rebuilt
  });

  it("keeps maps independent", () => {
    setMapTuning("level-22", { expectedCuts: 4 });
    const other = makeLevel("level-23");
    expect(applyMapTuning(other)!.expectedCuts).toBe(6);
  });

  it("tolerates a null level", () => {
    expect(applyMapTuning(null)).toBeNull();
  });

  // The authored value has to be captured BEFORE the first override is written,
  // or "was N" in the tuner would report the override as the original.
  it("captures the authored baseline on first sight", () => {
    applyMapTuning(LEVEL);
    setMapTuning(LEVEL.id, { expectedCuts: 4 });
    applyMapTuning(LEVEL);
    expect(authoredBaseline(LEVEL.id)).toEqual({ expectedCuts: 6, sizeThreshold: 16 });
  });

  it("re-captures baselines after a map.yml reload", () => {
    applyMapTuning(LEVEL);
    resetMapTuningBaselines();
    const edited = { ...makeLevel(), expectedCuts: 9 };
    applyMapTuning(edited);
    expect(authoredBaseline(LEVEL.id)!.expectedCuts).toBe(9);
  });
});

describe("editing overrides", () => {
  it("merges successive patches instead of replacing them", () => {
    setMapTuning(LEVEL.id, { expectedCuts: 4 });
    setMapTuning(LEVEL.id, { sizeThreshold: 10 });
    expect(getMapTuning(LEVEL.id)).toEqual({ expectedCuts: 4, sizeThreshold: 10 });
  });

  /**
   * The level object still carries the old override, so "stop applying it" is
   * not enough: the authored value has to be written back over the top.
   */
  it("clearing one field restores its authored value", () => {
    applyMapTuning(LEVEL); // capture the baseline first, as the game does
    setMapTuning(LEVEL.id, { expectedCuts: 4, sizeThreshold: 10 });
    applyMapTuning(LEVEL);
    setMapTuning(LEVEL.id, { expectedCuts: undefined });

    const tuned = applyMapTuning(LEVEL)!;
    expect(tuned.expectedCuts).toBe(6); // restored, not left at 4
    expect(tuned.sizeThreshold).toBe(10);
    expect("expectedCuts" in getMapTuning(LEVEL.id)).toBe(false);
  });

  it("drops the map entirely once its last override goes", () => {
    setMapTuning(LEVEL.id, { expectedCuts: 4 });
    setMapTuning(LEVEL.id, { expectedCuts: undefined });
    expect(isMapTuned(LEVEL.id)).toBe(false);
    expect(hasAnyMapTuning()).toBe(false);
  });

  // Reset is the escape hatch; it must put the board back exactly as authored.
  it("Reset restores every authored value on the live level", () => {
    applyMapTuning(LEVEL);
    setMapTuning(LEVEL.id, { expectedCuts: 4, sizeThreshold: 40 });
    applyMapTuning(LEVEL);
    clearMapTuning(LEVEL.id);

    const restored = applyMapTuning(LEVEL)!;
    expect(restored.expectedCuts).toBe(6);
    expect(restored.sizeThreshold).toBe(16);
  });

  it("Reset clears one map, leaving others tuned", () => {
    setMapTuning("level-22", { expectedCuts: 4 });
    setMapTuning("level-23", { expectedCuts: 9 });
    clearMapTuning("level-22");
    expect(isMapTuned("level-22")).toBe(false);
    expect(isMapTuned("level-23")).toBe(true);
    expect(hasAnyMapTuning()).toBe(true);
  });

  it("clearAll wipes the lot", () => {
    setMapTuning("level-22", { expectedCuts: 4 });
    setMapTuning("level-23", { expectedCuts: 9 });
    clearAllMapTuning();
    expect(hasAnyMapTuning()).toBe(false);
  });
});

describe("keeping a tuned run off the ledger", () => {
  it("reports any tuning anywhere, not just on the current map", () => {
    expect(hasAnyMapTuning()).toBe(false);
    setMapTuning("level-7", { sizeThreshold: 25 });
    expect(hasAnyMapTuning()).toBe(true);
  });
});

describe("persistence and notification", () => {
  it("survives a reload", () => {
    setMapTuning(LEVEL.id, { expectedCuts: 4 });
    resetMapTuningCache(); // simulate a fresh page load
    expect(getMapTuning(LEVEL.id)).toEqual({ expectedCuts: 4 });
  });

  it("survives corrupt stored JSON rather than bricking the level load", () => {
    localStorage.setItem("devend:mapTuning", "{not json");
    resetMapTuningCache();
    expect(() => applyMapTuning(LEVEL)).not.toThrow();
    expect(applyMapTuning(LEVEL)!.expectedCuts).toBe(6);
  });

  // useLevelManager re-derives the played level from this; without it, an edit
  // would sit in storage and not reach the board until a remount.
  it("notifies subscribers and bumps the version on every write", () => {
    let calls = 0;
    const unsubscribe = subscribeMapTuning(() => { calls++; });
    const before = mapTuningVersion();

    setMapTuning(LEVEL.id, { expectedCuts: 4 });
    expect(calls).toBe(1);
    expect(mapTuningVersion()).toBeGreaterThan(before);

    clearMapTuning(LEVEL.id);
    expect(calls).toBe(2);

    unsubscribe();
    setMapTuning(LEVEL.id, { expectedCuts: 5 });
    expect(calls).toBe(2); // no longer listening
  });
});

describe("handing values back to map.yml", () => {
  it("emits only the overridden keys, at map.yml's indentation", () => {
    setMapTuning(LEVEL.id, { expectedCuts: 4 });
    expect(tuningAsYaml(LEVEL.id)).toBe("    expectedCuts: 4");
  });

  it("emits nothing for an untuned map", () => {
    expect(tuningAsYaml(LEVEL.id)).toBe("");
  });
});
