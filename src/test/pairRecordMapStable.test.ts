/**
 * The host publishes its run once per map, not once per render.
 *
 * Reported from two phones: the guest could not get past a map's Acceptance
 * Criteria. `recordMap` depended on the object usePairRunSave returns, which
 * is new on every render, so recordMap was too, and Index's once-per-map
 * publish effect (keyed on it) fired on every render instead. The host re-sent
 * its run in a loop, the guest re-adopted each copy, each adoption rebuilt its
 * modifiers, and the map's Acceptance Criteria re-armed after every tap.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePairSession } from "@/hooks/usePairSession";
import { usePairRunSave } from "@/hooks/usePairRunSave";

describe("the pair session's per-map callbacks", () => {
  it("keeps recordMap the same function across renders", () => {
    const { result, rerender } = renderHook(() => usePairSession(null));
    const first = result.current.recordMap;
    rerender();
    rerender();
    expect(result.current.recordMap, "a new recordMap re-fires the publish effect").toBe(first);
  });

  it("keeps the save's functions stable even when the save itself changes", () => {
    // The fix leans on this: the object is new each render, the functions are not.
    const { result } = renderHook(() => usePairRunSave());
    const { store, saveFor, discard } = result.current;
    act(() => {
      store(
        { pairId: "p", runId: "r", seed: "s", devices: ["a", "b"] },
        { levelSequenceIds: ["level-1"], currentLevelIndex: 0 } as never,
      );
    });
    expect(result.current.store).toBe(store);
    expect(result.current.saveFor).toBe(saveFor);
    expect(result.current.discard).toBe(discard);
    act(() => { discard(); });
  });
});
