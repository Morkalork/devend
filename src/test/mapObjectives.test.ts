/**
 * mapObjectives — per-map optional objectives (issue #55).
 *
 * Covers the deterministic 0-or-1 per-map roll (seed determinism, eligibility
 * gate, none-bucket, variety), the pure evaluator for each objective kind, and
 * that the reward folds UNDER the per-map score cap.
 */
import { describe, it, expect } from "vitest";
import { createRng } from "@/lib/runRng";
import {
  selectMapObjective,
  eligibleObjectives,
  evaluateObjective,
  objectiveClearReward,
} from "@/lib/mapObjectives";
import { calculateScore } from "@/lib/scoring";
import type { MapObjective, ObjectiveSnapshot } from "@/types/objective";

const LOCKDOWN: MapObjective = { id: "lockdown", name: "Lockdown", description: "d", kind: "lockCount", weight: 3, params: { count: 2 }, reward: 3 };
const VAULT: MapObjective = { id: "vault", name: "Vault", description: "d", kind: "lockCount", minLevel: 15, weight: 50, params: { count: 4 }, reward: 6 };
const PRECISION: MapObjective = { id: "precision", name: "Precision", description: "d", kind: "superiorLocks", weight: 3, params: { count: 1 }, reward: 4 };
const UNDER_PAR: MapObjective = { id: "under-budget", name: "Under Budget", description: "d", kind: "underPar", weight: 2, params: { delta: 0 }, reward: 4 };
const SPEED: MapObjective = { id: "speed-run", name: "Speed Run", description: "d", kind: "speedClear", weight: 2, params: { seconds: 35 }, reward: 4 };
const POOL = [LOCKDOWN, VAULT, PRECISION, UNDER_PAR, SPEED];

const snap = (o: Partial<ObjectiveSnapshot>): ObjectiveSnapshot =>
  ({ lockedBalls: 0, superiorLocks: 0, cuts: 0, par: 10, activeSeconds: 0, ...o });

describe("selectMapObjective (#55)", () => {
  it("returns null below the procedural band", () => {
    expect(selectMapObjective(10, createRng("s"), POOL, 0)).toBeNull();
  });

  it("is deterministic: same seed picks the same objective", () => {
    const a = selectMapObjective(12, createRng("daily:2026-07-19::objective:level-12"), POOL, 0);
    const b = selectMapObjective(12, createRng("daily:2026-07-19::objective:level-12"), POOL, 0);
    expect(a?.id).toBe(b?.id);
  });

  it("respects the eligible level range (vault is level 15+)", () => {
    expect(eligibleObjectives(12, POOL).map(o => o.id)).not.toContain("vault");
    expect(eligibleObjectives(15, POOL).map(o => o.id)).toContain("vault");
    for (const s of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
      expect(selectMapObjective(12, createRng(s), POOL, 0)?.id).not.toBe("vault");
    }
    const picks = ["1", "2", "3", "4", "5", "6"].map(s => selectMapObjective(15, createRng(s), POOL, 0)?.id);
    expect(picks).toContain("vault");
  });

  it("never rolls below the band even with a level-1 minLevel entry", () => {
    expect(selectMapObjective(5, createRng("s"), [{ ...LOCKDOWN, minLevel: 1 }], 0)).toBeNull();
  });

  it("rolls 0-or-1: noneWeight 0 always yields one, a large noneWeight often none", () => {
    for (const s of ["a", "b", "c", "d", "e"]) expect(selectMapObjective(12, createRng(s), POOL, 0)).not.toBeNull();
    const outs = ["a", "b", "c", "d", "e", "f", "g", "h"].map(s => selectMapObjective(12, createRng(s), POOL, 100));
    expect(outs.some(o => o === null)).toBe(true);
  });

  it("varies the pick across seeds", () => {
    const ids = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(s => selectMapObjective(12, createRng(s), POOL, 0)?.id));
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe("evaluateObjective (#55)", () => {
  it("lockCount: met once enough balls are locked (accumulate mode)", () => {
    expect(evaluateObjective(LOCKDOWN, snap({ lockedBalls: 1 }))).toMatchObject({ current: 1, target: 2, met: false, mode: "accumulate" });
    expect(evaluateObjective(LOCKDOWN, snap({ lockedBalls: 2 })).met).toBe(true);
    expect(evaluateObjective(LOCKDOWN, snap({ lockedBalls: 5 })).met).toBe(true);
  });

  it("tags accumulate vs limit mode so the HUD never shows a limit goal as complete early", () => {
    expect(evaluateObjective(LOCKDOWN, snap({})).mode).toBe("accumulate");
    expect(evaluateObjective(PRECISION, snap({})).mode).toBe("accumulate");
    expect(evaluateObjective(UNDER_PAR, snap({})).mode).toBe("limit");
    expect(evaluateObjective(SPEED, snap({})).mode).toBe("limit");
    // A limit objective reads "met" from the start (0 cuts / 0s), which is why
    // the HUD keys completion styling off mode, not met alone.
    expect(evaluateObjective(UNDER_PAR, snap({ cuts: 0, par: 5 })).met).toBe(true);
    expect(evaluateObjective(SPEED, snap({ activeSeconds: 0 })).met).toBe(true);
  });

  it("superiorLocks: counts only superior locks", () => {
    expect(evaluateObjective(PRECISION, snap({ superiorLocks: 0, lockedBalls: 9 })).met).toBe(false);
    expect(evaluateObjective(PRECISION, snap({ superiorLocks: 1 })).met).toBe(true);
  });

  it("underPar: met at or under par, false when over", () => {
    expect(evaluateObjective(UNDER_PAR, snap({ cuts: 10, par: 10 })).met).toBe(true);
    expect(evaluateObjective(UNDER_PAR, snap({ cuts: 11, par: 10 })).met).toBe(false);
    // delta widens the budget.
    expect(evaluateObjective({ ...UNDER_PAR, params: { delta: 2 } }, snap({ cuts: 12, par: 10 })).met).toBe(true);
  });

  it("speedClear: met within the time budget", () => {
    expect(evaluateObjective(SPEED, snap({ activeSeconds: 20 })).met).toBe(true);
    expect(evaluateObjective(SPEED, snap({ activeSeconds: 35 })).met).toBe(true);
    expect(evaluateObjective(SPEED, snap({ activeSeconds: 36 })).met).toBe(false);
  });
});

describe("objectiveClearReward (#55)", () => {
  it("pays the reward only when met, 0 otherwise or when absent", () => {
    expect(objectiveClearReward(LOCKDOWN, snap({ lockedBalls: 2 }))).toBe(3);
    expect(objectiveClearReward(LOCKDOWN, snap({ lockedBalls: 1 }))).toBe(0);
    expect(objectiveClearReward(null, snap({}))).toBe(0);
  });

  it("folds UNDER the per-map cap (issue #43): reward beyond the cap adds nothing", () => {
    const base = 20;
    const reward = objectiveClearReward(LOCKDOWN, snap({ lockedBalls: 2 })); // 3h, met
    const capped = calculateScore(5, 5, 10, 30, base, { extraBonus: 10_000 }).levelScore;
    const cappedPlus = calculateScore(5, 5, 10, 30, base, { extraBonus: 10_000 + reward }).levelScore;
    expect(cappedPlus).toBe(capped);
  });
});
