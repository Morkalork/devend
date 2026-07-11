import { describe, it, expect } from "vitest";
import { creepStep, creepFactor, DEFAULT_SCOPE_CREEP, ScopeCreepConfig } from "@/lib/scopeCreep";

// Default tuning: grace 45s, +8% every 15s, capped at 4 steps (+32%).
const CFG = DEFAULT_SCOPE_CREEP;

describe("scope creep factor", () => {
  it("stays at 1.0 through the whole grace window", () => {
    expect(creepFactor(0, CFG)).toBe(1);
    expect(creepFactor(20, CFG)).toBe(1);
    expect(creepFactor(44.99, CFG)).toBe(1);
  });

  it("surges in discrete steps, the first landing AT the grace mark", () => {
    expect(creepFactor(45, CFG)).toBeCloseTo(1.08);
    expect(creepFactor(59.99, CFG)).toBeCloseTo(1.08);
    expect(creepFactor(60, CFG)).toBeCloseTo(1.16);
    expect(creepFactor(75, CFG)).toBeCloseTo(1.24);
    expect(creepFactor(90, CFG)).toBeCloseTo(1.32);
  });

  it("caps at maxSteps no matter how long the stall", () => {
    expect(creepFactor(90, CFG)).toBeCloseTo(1.32);
    expect(creepFactor(9999, CFG)).toBeCloseTo(1.32);
    expect(creepStep(9999, CFG)).toBe(CFG.maxSteps);
  });

  it("is monotonic non-decreasing over a time sweep", () => {
    let prev = 0;
    for (let s = 0; s <= 200; s += 0.5) {
      const f = creepFactor(s, CFG);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it("maxSteps: 0 disables the mechanic entirely", () => {
    const off: ScopeCreepConfig = { ...CFG, maxSteps: 0 };
    expect(creepFactor(9999, off)).toBe(1);
    expect(creepStep(9999, off)).toBe(0);
  });

  it("guards against garbage config (never NaN, never below 1)", () => {
    const garbage: ScopeCreepConfig = { graceSeconds: NaN, stepSeconds: -1, stepPercent: NaN, maxSteps: 4 };
    expect(creepFactor(100, garbage)).toBe(1);
    const negativePercent: ScopeCreepConfig = { ...CFG, stepPercent: -8 };
    expect(creepFactor(100, negativePercent)).toBe(1);
    expect(creepFactor(NaN, CFG)).toBe(1);
  });
});
