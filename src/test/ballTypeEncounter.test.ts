import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMetaProgression } from "@/hooks/useMetaProgression";

// Ball-type "encountered" tracking (tutorial: show a ball's ability only after
// the player has LOCKED one, per the user's chosen definition - not merely
// having seen it spawn). Mirrors the recordLoadoutWin/recordMapHighscore
// pattern: an id set persisted under the existing jezzball_unlock_state key.

describe("useMetaProgression: encountered ball types", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty and records a ball type as encountered", () => {
    const { result } = renderHook(() => useMetaProgression());
    expect(result.current.encounteredBallTypeIds).toEqual([]);

    act(() => result.current.recordBallTypeEncountered("yellow"));
    expect(result.current.encounteredBallTypeIds).toEqual(["yellow"]);
  });

  it("is idempotent for a type already encountered", () => {
    const { result } = renderHook(() => useMetaProgression());
    act(() => result.current.recordBallTypeEncountered("purple"));
    act(() => result.current.recordBallTypeEncountered("purple"));
    expect(result.current.encounteredBallTypeIds).toEqual(["purple"]);
  });

  it("returns true only on the FIRST lock of a type (drives the Info Unlocked flash)", () => {
    const { result } = renderHook(() => useMetaProgression());
    let first: boolean | undefined;
    let second: boolean | undefined;
    act(() => { first = result.current.recordBallTypeEncountered("black"); });
    act(() => { second = result.current.recordBallTypeEncountered("black"); });
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("accumulates distinct types across multiple locks", () => {
    const { result } = renderHook(() => useMetaProgression());
    act(() => result.current.recordBallTypeEncountered("yellow"));
    act(() => result.current.recordBallTypeEncountered("black"));
    expect(result.current.encounteredBallTypeIds.sort()).toEqual(["black", "yellow"]);
  });

  it("persists across a fresh hook instance (survives reload)", () => {
    const first = renderHook(() => useMetaProgression());
    act(() => first.result.current.recordBallTypeEncountered("grey"));
    first.unmount();

    const second = renderHook(() => useMetaProgression());
    expect(second.result.current.encounteredBallTypeIds).toEqual(["grey"]);
  });

  it("resetProgression clears encountered ball types", () => {
    const { result } = renderHook(() => useMetaProgression());
    act(() => result.current.recordBallTypeEncountered("yellow"));
    act(() => result.current.resetProgression());
    expect(result.current.encounteredBallTypeIds).toEqual([]);
  });

  it("does not disturb other unlock-state fields (loadouts, highscores)", () => {
    const { result } = renderHook(() => useMetaProgression());
    act(() => result.current.recordLoadoutWin("crunch_time"));
    act(() => result.current.recordMapHighscore("level-1", 100));
    act(() => result.current.recordBallTypeEncountered("yellow"));

    expect(result.current.wonLoadoutIds).toEqual(["crunch_time"]);
    expect(result.current.mapHighscores).toEqual({ "level-1": 100 });
    expect(result.current.encounteredBallTypeIds).toEqual(["yellow"]);
  });
});
