import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRunSave, RunSaveInput } from "@/hooks/useRunSave";

// Full-run persistence: written each map so the player can leave and Continue
// later, cleared when the run ends or a New Game starts. See useRunSave.

const SAMPLE: RunSaveInput = {
  levelSequenceIds: ["level-1", "level-2", "level-3"],
  currentLevelIndex: 1,
  totalScore: 140,
  ownedUpgradeIds: ["feature_freeze_junior"],
  currentLives: 2,
  livesAtLevelStart: 2,
  continuesRemaining: 1,
  cumulativeLockedBalls: 4,
  runLevelsCompleted: 6,
  carryInstantFences: 1,
  carrySpendFences: 0,
  carrySpendFenceSpeed: 0.2,
  activeDoorId: "cold_call",
  capstoneId: "cryo_protocol",
  ascensionDepth: 0,
  draftedLoadoutIds: [],
};

describe("useRunSave", () => {
  beforeEach(() => localStorage.clear());

  it("starts with no save", () => {
    const { result } = renderHook(() => useRunSave());
    expect(result.current.hasSavedRun).toBe(false);
    expect(result.current.readRun()).toBeNull();
  });

  it("round-trips a saved run and flips hasSavedRun", () => {
    const { result } = renderHook(() => useRunSave());
    act(() => result.current.saveRun(SAMPLE));

    expect(result.current.hasSavedRun).toBe(true);
    const loaded = result.current.readRun();
    expect(loaded).toMatchObject(SAMPLE);
    // Stamped on write.
    expect(loaded?.version).toBe(1);
    expect(typeof loaded?.savedAt).toBe("number");
  });

  it("persists across a fresh hook instance (survives reload)", () => {
    const first = renderHook(() => useRunSave());
    act(() => first.result.current.saveRun(SAMPLE));
    first.unmount();

    const second = renderHook(() => useRunSave());
    expect(second.result.current.hasSavedRun).toBe(true);
    expect(second.result.current.readRun()).toMatchObject(SAMPLE);
  });

  it("clearRun removes the save", () => {
    const { result } = renderHook(() => useRunSave());
    act(() => result.current.saveRun(SAMPLE));
    act(() => result.current.clearRun());
    expect(result.current.hasSavedRun).toBe(false);
    expect(result.current.readRun()).toBeNull();
  });

  it("rejects a save from a different schema version", () => {
    localStorage.setItem("jezzball_run_v1", JSON.stringify({ ...SAMPLE, version: 99, savedAt: 1 }));
    const { result } = renderHook(() => useRunSave());
    expect(result.current.hasSavedRun).toBe(false);
    expect(result.current.readRun()).toBeNull();
  });

  it("rejects a corrupt / empty-sequence save", () => {
    localStorage.setItem("jezzball_run_v1", JSON.stringify({ ...SAMPLE, version: 1, savedAt: 1, levelSequenceIds: [] }));
    const { result } = renderHook(() => useRunSave());
    expect(result.current.readRun()).toBeNull();

    localStorage.setItem("jezzball_run_v1", "{not json");
    const { result: r2 } = renderHook(() => useRunSave());
    expect(r2.current.readRun()).toBeNull();
  });
});
