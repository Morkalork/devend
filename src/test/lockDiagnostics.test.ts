/**
 * The lock-decision recorder itself. Its whole value is being trustworthy when
 * a rare bug finally reproduces, so the buffer must not silently drop the entry
 * that matters or keep recording once the flag is off.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  LOCK_DEBUG_KEY,
  isLockDebugEnabled,
  setLockDebugEnabled,
  recordLockDecision,
  getLockDecisions,
  clearLockDecisions,
  resetLockDebugCache,
  type LockDecision,
} from "@/lib/lockDiagnostics";

const decision = (regionCells: number): LockDecision => ({
  ballId: `b${regionCells}`, ballColor: "#fff", isBoss: false,
  regionCells, denominator: 1000, percentage: regionCells / 10,
  thresholdPercent: 5, lockedByPercent: true, lockedBySliver: false,
  containedInArea: false, trulySealed: true, area: null, outcome: "locked",
});

beforeEach(() => {
  localStorage.clear();
  resetLockDebugCache();
  clearLockDecisions();
});

describe("lock diagnostics recorder", () => {
  it("records nothing while disabled: off must cost nothing and leak nothing", () => {
    expect(isLockDebugEnabled()).toBe(false);
    recordLockDecision(decision(1));
    expect(getLockDecisions()).toEqual([]);
  });

  it("persists the flag so it survives into a normal run", () => {
    setLockDebugEnabled(true);
    expect(localStorage.getItem(LOCK_DEBUG_KEY)).toBe("1");
    // A fresh page load re-reads storage rather than defaulting to off.
    resetLockDebugCache();
    expect(isLockDebugEnabled()).toBe(true);
  });

  it("returns newest first, so an overlay shows the most recent lock on top", () => {
    setLockDebugEnabled(true);
    recordLockDecision(decision(1));
    recordLockDecision(decision(2));
    recordLockDecision(decision(3));
    expect(getLockDecisions().map(d => d.regionCells)).toEqual([3, 2, 1]);
  });

  it("caps the buffer by dropping the OLDEST, never the newest", () => {
    setLockDebugEnabled(true);
    for (let i = 1; i <= 60; i++) recordLockDecision(decision(i));
    const kept = getLockDecisions();
    expect(kept.length).toBe(40);
    // Newest survived; oldest evicted.
    expect(kept[0].regionCells).toBe(60);
    expect(kept.at(-1)!.regionCells).toBe(21);
  });

  it("drops the buffer when switched off, so a later session can't read stale rows", () => {
    setLockDebugEnabled(true);
    recordLockDecision(decision(1));
    setLockDebugEnabled(false);
    expect(getLockDecisions()).toEqual([]);
    expect(localStorage.getItem(LOCK_DEBUG_KEY)).toBeNull();
  });
});
