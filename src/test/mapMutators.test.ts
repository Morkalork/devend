/**
 * mapMutators — per-map environmental modifiers (issue #54).
 *
 * Covers the deterministic per-map roll (seed determinism, eligibility gate,
 * none-bucket, variety), the conveyor drift resolution, the pure speed-factor
 * and overtime-premium helpers (including the winnability cap on crunch), and
 * that the premium folds UNDER the per-map score cap.
 */
import { describe, it, expect } from "vitest";
import { createRng } from "@/lib/runRng";
import {
  selectMapMutator,
  eligibleMutators,
  mutatorSpeedFactor,
  mutatorOvertimePremium,
} from "@/lib/mapMutators";
import { calculateScore } from "@/lib/scoring";
import type { MapMutator, ActiveMapMutator } from "@/types/mapMutator";

const CRUNCH: MapMutator = {
  id: "crunch", name: "Crunch", description: "d", behavior: "crunch",
  weight: 1, params: { perLockPercent: 7, maxPercent: 56 }, overtimePremium: 3,
};
const CONVEYOR: MapMutator = {
  id: "conveyor", name: "Conveyor", description: "d", behavior: "conveyor",
  weight: 1, params: { speed: 55 }, overtimePremium: 2,
};
const OVERCLOCK: MapMutator = {
  id: "overclock", name: "Overclock", description: "d", behavior: "overclock",
  weight: 1, params: { factor: 1.18 }, overtimePremium: 2,
};
const RIPTIDE: MapMutator = {
  id: "riptide", name: "Riptide", description: "d", behavior: "conveyor",
  minLevel: 15, weight: 50, params: { speed: 82 },
};
const POOL = [CRUNCH, CONVEYOR, OVERCLOCK, RIPTIDE];

describe("selectMapMutator (#54)", () => {
  it("returns null below the procedural band", () => {
    expect(selectMapMutator(10, createRng("s"), POOL, 0)).toBeNull();
  });

  it("is deterministic: same seed picks the same mutator", () => {
    const a = selectMapMutator(12, createRng("daily:2026-07-19::mapMutator:level-12"), POOL, 0);
    const b = selectMapMutator(12, createRng("daily:2026-07-19::mapMutator:level-12"), POOL, 0);
    expect(a?.id).toBe(b?.id);
    expect(a).not.toBeNull();
  });

  it("respects the eligible level range (riptide is level 15+)", () => {
    expect(eligibleMutators(12, POOL).map(m => m.id)).not.toContain("riptide");
    expect(eligibleMutators(15, POOL).map(m => m.id)).toContain("riptide");
    // At level 12, riptide can never be picked even though its weight is huge.
    for (const s of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
      expect(selectMapMutator(12, createRng(s), POOL, 0)?.id).not.toBe("riptide");
    }
    // At level 15 its heavy weight means it shows up across seeds.
    const picks = ["1", "2", "3", "4", "5", "6"].map(s => selectMapMutator(15, createRng(s), POOL, 0)?.id);
    expect(picks).toContain("riptide");
  });

  it("never mutates below the band even with a level-1 minLevel entry", () => {
    const early: MapMutator = { ...CRUNCH, minLevel: 1 };
    expect(selectMapMutator(5, createRng("s"), [early], 0)).toBeNull();
  });

  it("noneWeight 0 always yields a mutator; a large noneWeight sometimes yields none", () => {
    for (const s of ["a", "b", "c", "d", "e"]) {
      expect(selectMapMutator(12, createRng(s), POOL, 0)).not.toBeNull();
    }
    const outs = ["a", "b", "c", "d", "e", "f", "g", "h"].map(s => selectMapMutator(12, createRng(s), POOL, 100));
    expect(outs.some(o => o === null)).toBe(true);
  });

  it("varies the pick across seeds", () => {
    const ids = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(s => selectMapMutator(12, createRng(s), POOL, 0)?.id));
    expect(ids.size).toBeGreaterThan(1);
  });

  it("resolves a conveyor drift vector along one axis, magnitude = speed", () => {
    for (const s of ["1", "2", "3", "4", "5", "6"]) {
      const m = selectMapMutator(12, createRng(s), [CONVEYOR], 0)!;
      expect(m.behavior).toBe("conveyor");
      const dx = m.driftX ?? 0, dy = m.driftY ?? 0;
      expect(Math.min(Math.abs(dx), Math.abs(dy))).toBe(0);       // exactly one axis
      expect(Math.hypot(dx, dy)).toBeCloseTo(55, 5);              // magnitude = speed
    }
  });
});

describe("mutatorSpeedFactor (#54)", () => {
  it("is 1 with no mutator, or a conveyor (positional, not speed)", () => {
    expect(mutatorSpeedFactor(null, 5)).toBe(1);
    expect(mutatorSpeedFactor({ ...CONVEYOR } as ActiveMapMutator, 5)).toBe(1);
  });

  it("applies the flat overclock factor regardless of locks", () => {
    expect(mutatorSpeedFactor(OVERCLOCK as ActiveMapMutator, 0)).toBeCloseTo(1.18, 5);
    expect(mutatorSpeedFactor(OVERCLOCK as ActiveMapMutator, 9)).toBeCloseTo(1.18, 5);
  });

  it("ramps crunch with locks and CAPS it (winnability: speed can't blow up)", () => {
    expect(mutatorSpeedFactor(CRUNCH as ActiveMapMutator, 0)).toBe(1);          // no locks yet
    expect(mutatorSpeedFactor(CRUNCH as ActiveMapMutator, 3)).toBeCloseTo(1.21, 5); // 3 * 7%
    // Far beyond the cap: clamps to 1 + maxPercent/100, never higher.
    expect(mutatorSpeedFactor(CRUNCH as ActiveMapMutator, 1000)).toBeCloseTo(1.56, 5);
  });
});

describe("mutatorOvertimePremium (#54)", () => {
  it("returns the premium, or 0 when absent/invalid", () => {
    expect(mutatorOvertimePremium(CRUNCH as ActiveMapMutator)).toBe(3);
    expect(mutatorOvertimePremium(null)).toBe(0);
    expect(mutatorOvertimePremium({ ...CRUNCH, overtimePremium: -5 } as ActiveMapMutator)).toBe(0);
    expect(mutatorOvertimePremium({ ...CRUNCH, overtimePremium: undefined } as ActiveMapMutator)).toBe(0);
  });

  it("folds UNDER the per-map cap (issue #43): premium beyond the cap adds nothing", () => {
    const base = 20;
    const premium = mutatorOvertimePremium(CRUNCH as ActiveMapMutator);
    // Both already saturate the cap; adding the premium on top changes nothing,
    // proving it routes through the capped extraBonus path.
    const capped = calculateScore(5, 5, 10, 30, base, { extraBonus: 10_000 }).levelScore;
    const cappedPlusPremium = calculateScore(5, 5, 10, 30, base, { extraBonus: 10_000 + premium }).levelScore;
    expect(cappedPlusPremium).toBe(capped);
  });
});
