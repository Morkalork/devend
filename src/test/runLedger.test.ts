/**
 * Run-ledger pure logic (HIGHSCORES.md Phase A): Top 10 insertion + rank/gap
 * math, Record Pace deltas, and the near-miss "ahead through map N" epitaph.
 */
import { describe, it, expect } from "vitest";
import { insertRun, paceDelta, aheadThroughMaps } from "@/lib/runLedger";
import { RunLedgerEntry } from "@/types/hallOfFame";

const entry = (score: number, over: Partial<RunLedgerEntry> = {}): RunLedgerEntry => ({
  score,
  levelsCompleted: 10,
  ascensionDepth: 0,
  primaryTag: "lock",
  secondaryTag: null,
  capstoneId: null,
  capstoneName: null,
  loadoutIds: [],
  savedAt: 1,
  ...over,
});

describe("insertRun", () => {
  it("first run ever ranks #1 with no gaps", () => {
    const { topRuns, info } = insertRun([], entry(300));
    expect(info).toEqual({ rank: 1, gapToNext: null, gapToTop10: null });
    expect(topRuns.map(r => r.score)).toEqual([300]);
  });

  it("ranks below better runs and reports the gap up", () => {
    const ladder = [entry(500), entry(400), entry(200)];
    const { topRuns, info } = insertRun(ladder, entry(350));
    expect(info.rank).toBe(3);
    expect(info.gapToNext).toBe(50); // 400 - 350
    expect(info.gapToTop10).toBeNull();
    expect(topRuns.map(r => r.score)).toEqual([500, 400, 350, 200]);
  });

  it("ties keep the earlier run ahead", () => {
    const ladder = [entry(400, { savedAt: 111 })];
    const { topRuns, info } = insertRun(ladder, entry(400, { savedAt: 222 }));
    expect(info.rank).toBe(2);
    expect(topRuns[0].savedAt).toBe(111);
  });

  it("caps the ladder and reports the miss gap", () => {
    const ladder = Array.from({ length: 10 }, (_, i) => entry(1000 - i * 50)); // 1000..550
    const { topRuns, info } = insertRun(ladder, entry(500));
    expect(info.rank).toBeNull();
    expect(info.gapToTop10).toBe(50); // 550 - 500
    expect(topRuns).toHaveLength(10);
    expect(topRuns.some(r => r.score === 500)).toBe(false);
  });

  it("a mid-ladder entry pushes the last run off a full ladder", () => {
    const ladder = Array.from({ length: 10 }, (_, i) => entry(1000 - i * 50));
    const { topRuns, info } = insertRun(ladder, entry(975));
    expect(info.rank).toBe(2);
    expect(topRuns).toHaveLength(10);
    expect(topRuns.map(r => r.score)).not.toContain(550); // old #10 dropped
  });

  it("does not mutate the input ladder", () => {
    const ladder = [entry(400)];
    insertRun(ladder, entry(500));
    expect(ladder.map(r => r.score)).toEqual([400]);
  });
});

describe("paceDelta", () => {
  const best = [50, 120, 200]; // best run's cumulative per map, final score 200

  it("is null with no best run or before any map", () => {
    expect(paceDelta(80, 1, [], null)).toBeNull();
    expect(paceDelta(0, 0, best, 200)).toBeNull();
  });

  it("compares against the best run at the same map", () => {
    expect(paceDelta(70, 1, best, 200)).toBe(20);   // 70 vs 50
    expect(paceDelta(100, 2, best, 200)).toBe(-20); // 100 vs 120
  });

  it("past the best run's end compares against its final score", () => {
    expect(paceDelta(180, 5, best, 200)).toBe(-20);
    expect(paceDelta(230, 5, best, 200)).toBe(30);
  });
});

describe("aheadThroughMaps", () => {
  const best = [50, 120, 200, 260];

  it("null when there is no best run or the run beat the record", () => {
    expect(aheadThroughMaps([60, 130], [], 130, null)).toBeNull();
    expect(aheadThroughMaps([60, 300], best, 300, 260)).toBeNull();
  });

  it("reports the last map the run was ahead at", () => {
    // Ahead on maps 1 and 2, fell behind on 3, died at 150 < 260.
    expect(aheadThroughMaps([60, 130, 190], best, 150, 260)).toBe(2);
  });

  it("null when the run never led", () => {
    expect(aheadThroughMaps([40, 100], best, 100, 260)).toBeNull();
  });
});
