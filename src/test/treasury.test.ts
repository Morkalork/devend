import { describe, it, expect } from "vitest";
import {
  runwayBonuses,
  runwayStatus,
  spendChunks,
  spendBoons,
  spendChunkCap,
  RUNWAY_FREEZE_SECONDS,
  SPEND_CHUNK_HOURS,
  MAX_SPEND_CHUNKS,
} from "@/lib/treasury";
import { computeGameModifiers, GameModifiers } from "@/hooks/useActiveModifiers";

// Real defaults from the engine so key names can never drift.
const mods = (overrides: Partial<GameModifiers> = {}): GameModifiers => ({
  ...computeGameModifiers([], new Map()),
  ...overrides,
});

describe("runway (hoard-side thresholds)", () => {
  it("grants nothing without owned perks or below every threshold", () => {
    expect(runwayBonuses(500, mods())).toBeUndefined();
    expect(runwayBonuses(99.99, mods({ runwayInstantFenceAt: 100 }))).toBeUndefined();
  });

  it("meets a threshold exactly at the boundary", () => {
    expect(runwayBonuses(100, mods({ runwayInstantFenceAt: 100 }))).toEqual({ instantFencesPerMap: 1 });
  });

  it("stacks every met perk at a fat bank", () => {
    const all = mods({ runwayInstantFenceAt: 100, runwayConcurrentFenceAt: 200, runwayFreezeAt: 300 });
    expect(runwayBonuses(300, all)).toEqual({
      instantFencesPerMap: 1,
      additionalConcurrentFences: 1,
      ballFreezeDuration: RUNWAY_FREEZE_SECONDS,
      freezeUsesPerMap: 1,
    });
    // Mid bank: only the lower thresholds pay.
    expect(runwayBonuses(250, all)).toEqual({ instantFencesPerMap: 1, additionalConcurrentFences: 1 });
  });

  it("guards a garbage bank (treated as 0)", () => {
    expect(runwayBonuses(NaN, mods({ runwayInstantFenceAt: 100 }))).toBeUndefined();
  });

  it("reports live status sorted by threshold for the shop strip", () => {
    const all = mods({ runwayFreezeAt: 300, runwayInstantFenceAt: 100 });
    const status = runwayStatus(150, all);
    expect(status.map(s => s.perk)).toEqual(["instantFence", "freeze"]);
    expect(status.map(s => s.met)).toEqual([true, false]);
  });
});

describe("budget cycle (spend-side chunks)", () => {
  it("charges one chunk per 60h spent, boundary inclusive", () => {
    expect(spendChunks(59.99)).toBe(0);
    expect(spendChunks(SPEND_CHUNK_HOURS)).toBe(1);
    expect(spendChunks(180)).toBe(3);
  });

  it("caps at MAX_SPEND_CHUNKS no matter the splurge", () => {
    expect(spendChunks(500)).toBe(MAX_SPEND_CHUNKS);
  });

  it("guards garbage spend", () => {
    expect(spendChunks(NaN)).toBe(0);
    expect(spendChunks(-60)).toBe(0);
  });

  it("scales with an inflated chunk size (market rates)", () => {
    expect(spendChunks(120, 120)).toBe(1);
    expect(spendChunks(119, 120)).toBe(0);
    expect(spendChunks(360, 120)).toBe(MAX_SPEND_CHUNKS);
    // Garbage chunk size falls back to the base chunk.
    expect(spendChunks(60, NaN)).toBe(1);
  });

  it("composes boons from the owned tiers", () => {
    const both = mods({ spendInstantFencePerChunk: 1, spendFenceSpeedPerChunk: 0.05 });
    expect(spendBoons(2, both)).toEqual({ instantFences: 2, fenceSpeedBonus: 0.1, capturePercent: 0 });
    // Junior only: no fence-speed kick.
    expect(spendBoons(2, mods({ spendInstantFencePerChunk: 1 }))).toEqual({ instantFences: 2, fenceSpeedBonus: 0, capturePercent: 0 });
    // No chunks or no upgrades: nothing.
    expect(spendBoons(0, both)).toEqual({ instantFences: 0, fenceSpeedBonus: 0, capturePercent: 0 });
    expect(spendBoons(3, mods())).toEqual({ instantFences: 0, fenceSpeedBonus: 0, capturePercent: 0 });
  });

  // Retained Earnings: a next-map board head start, one chunk's worth per chunk.
  it("pays a board head start per chunk (Retained Earnings)", () => {
    const earnings = mods({ spendCapturePerChunk: 0.05 });
    expect(spendBoons(3, earnings).capturePercent).toBeCloseTo(0.15);
    expect(spendBoons(1, earnings).capturePercent).toBeCloseTo(0.05);
    expect(spendBoons(0, earnings).capturePercent).toBe(0);
    // Never leaks into the score-side boons.
    expect(spendBoons(3, earnings).instantFences).toBe(0);
  });

  // Leveraged Buyout: a raised per-visit chunk ceiling.
  it("raises the chunk cap (Leveraged Buyout)", () => {
    expect(spendChunkCap(mods())).toBe(MAX_SPEND_CHUNKS);
    expect(spendChunkCap(mods({ spendChunkCapBonus: 2 }))).toBe(MAX_SPEND_CHUNKS + 2);
    // A big splurge now counts up to the raised ceiling instead of 3.
    expect(spendChunks(500, SPEND_CHUNK_HOURS, spendChunkCap(mods({ spendChunkCapBonus: 2 })))).toBe(5);
    // Without the bonus it still caps at the base ceiling.
    expect(spendChunks(500, SPEND_CHUNK_HOURS, spendChunkCap(mods()))).toBe(MAX_SPEND_CHUNKS);
  });
});
