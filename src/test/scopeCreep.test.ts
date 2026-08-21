import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { creepStep, creepFactor, DEFAULT_SCOPE_CREEP, ScopeCreepConfig } from "@/lib/scopeCreep";

/**
 * An explicit fixture, NOT the live defaults.
 *
 * These tests describe the MECHANISM (when a surge lands, how it compounds,
 * where it caps), which must not move every time the game is retuned. Pointing
 * them at DEFAULT_SCOPE_CREEP coupled them to the tuning, so shortening the
 * grace from 45s to 30s broke three tests that had nothing to say about the
 * change. The authored numbers are pinned separately at the bottom of this file,
 * which is where a tuning change SHOULD show up in a diff.
 */
const CFG: ScopeCreepConfig = { graceSeconds: 45, stepSeconds: 15, stepPercent: 8, maxSteps: 4 };

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

  it("graceSeconds: 0 surges from the very first moment (Hard Deadline door)", () => {
    const immediate: ScopeCreepConfig = { ...CFG, graceSeconds: 0 };
    expect(creepFactor(0, immediate)).toBeCloseTo(1.08);
    expect(creepFactor(14.99, immediate)).toBeCloseTo(1.08);
    expect(creepFactor(15, immediate)).toBeCloseTo(1.16);
    expect(creepFactor(45, immediate)).toBeCloseTo(1.32); // cap arrives 45s sooner
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

// ── The authored cadence ────────────────────────────────────────────────────

/**
 * The tuning, pinned. The tests above exercise the mechanism against their own
 * fixture, so nothing here noticed when the real numbers changed. These are a
 * deliberate balance decision (the grace was 45s with four surges and the
 * opening read as too generous), and a silent drift would change how every map
 * past the first thirty seconds plays without anyone seeing it in a diff.
 */
describe("the authored scope creep cadence", () => {
  const CONFIG = (yaml.load(
    readFileSync(resolve(__dirname, "../../public/game-config.yml"), "utf8"),
  ) as { scope_creep: Record<string, number> }).scope_creep;

  it("first pushes back at 30 seconds, not 45", () => {
    expect(CONFIG.grace_seconds).toBe(30);
  });

  it("surges five times, so the extra tier was ADDED rather than shifted", () => {
    expect(CONFIG.max_steps).toBe(5);
    const surges = Array.from({ length: CONFIG.max_steps },
      (_, i) => CONFIG.grace_seconds + i * CONFIG.step_seconds);
    expect(surges).toEqual([30, 45, 60, 75, 90]);
  });

  it("tops out at +40%, the cost of that extra step", () => {
    expect(CONFIG.max_steps * CONFIG.step_percent).toBe(40);
  });

  /**
   * The grace mark should land on a Ship Early boundary, so the reward for
   * speed ends where the punishment for slowness begins. Ship Early's lowest
   * tier is 15s PER BALL, so a two-ball map's window closes at exactly 30s.
   */
  it("starts where a two-ball map's Ship Early window closes", () => {
    const scoring = (yaml.load(
      readFileSync(resolve(__dirname, "../../public/scoring-config.yml"), "utf8"),
    ) as { scoring: { shipEarly: { thresholds: { withinSecondsPerBall: number }[] } } }).scoring;
    const slowest = Math.max(...scoring.shipEarly.thresholds.map(t => t.withinSecondsPerBall));
    expect(slowest * 2).toBe(CONFIG.grace_seconds);
  });

  /** The runtime fallback must not describe a different game from the file. */
  it("matches the built-in default used when the config fails to load", () => {
    expect(DEFAULT_SCOPE_CREEP.graceSeconds).toBe(CONFIG.grace_seconds);
    expect(DEFAULT_SCOPE_CREEP.stepSeconds).toBe(CONFIG.step_seconds);
    expect(DEFAULT_SCOPE_CREEP.stepPercent).toBe(CONFIG.step_percent);
    expect(DEFAULT_SCOPE_CREEP.maxSteps).toBe(CONFIG.max_steps);
  });
});
