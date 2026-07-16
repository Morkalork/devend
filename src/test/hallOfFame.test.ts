/**
 * useHallOfFame: the persisted all-time run ledger (HIGHSCORES.md Phase A).
 * recordRun files runs, returns rank info synchronously, and only a new #1
 * replaces the Record Pace trajectory.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHallOfFame } from "@/hooks/useHallOfFame";
import { RunLedgerEntry, HALL_STORAGE_KEY } from "@/types/hallOfFame";

const entry = (score: number): RunLedgerEntry => ({
  score,
  levelsCompleted: 8,
  ascensionDepth: 0,
  primaryTag: "freeze",
  secondaryTag: "lock",
  capstoneId: "cryo_protocol",
  capstoneName: "Cryo Protocol",
  loadoutIds: ["crunch_time"],
  savedAt: 1,
});

describe("useHallOfFame", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty with no best score", () => {
    const { result } = renderHook(() => useHallOfFame());
    expect(result.current.topRuns).toEqual([]);
    expect(result.current.bestScore).toBeNull();
    expect(result.current.bestRunTrajectory).toEqual([]);
  });

  it("records a run, returns its rank synchronously, and persists", () => {
    const first = renderHook(() => useHallOfFame());
    let info: ReturnType<typeof first.result.current.recordRun>;
    act(() => { info = first.result.current.recordRun(entry(300), [80, 180, 300]); });
    expect(info!.rank).toBe(1);
    expect(first.result.current.bestScore).toBe(300);
    expect(first.result.current.bestRunTrajectory).toEqual([80, 180, 300]);
    first.unmount();

    // Survives reload.
    const second = renderHook(() => useHallOfFame());
    expect(second.result.current.bestScore).toBe(300);
    expect(second.result.current.bestRunTrajectory).toEqual([80, 180, 300]);
  });

  it("only a new #1 replaces the Record Pace trajectory", () => {
    const { result } = renderHook(() => useHallOfFame());
    act(() => { result.current.recordRun(entry(300), [80, 180, 300]); });
    act(() => { result.current.recordRun(entry(200), [90, 200]); }); // rank 2
    expect(result.current.bestRunTrajectory).toEqual([80, 180, 300]);

    act(() => { result.current.recordRun(entry(400), [100, 250, 400]); }); // new #1
    expect(result.current.bestRunTrajectory).toEqual([100, 250, 400]);
    expect(result.current.topRuns.map(r => r.score)).toEqual([400, 300, 200]);
  });

  it("caps the ladder at 10 runs", () => {
    const { result } = renderHook(() => useHallOfFame());
    for (let i = 0; i < 12; i++) {
      act(() => { result.current.recordRun(entry(100 + i * 10), [100 + i * 10]); });
    }
    expect(result.current.topRuns).toHaveLength(10);
    expect(result.current.topRuns[0].score).toBe(210);
  });

  it("ignores a corrupt stored blob", () => {
    localStorage.setItem(HALL_STORAGE_KEY, "{nope");
    const { result } = renderHook(() => useHallOfFame());
    expect(result.current.topRuns).toEqual([]);
    expect(result.current.bestScore).toBeNull();
  });
});
