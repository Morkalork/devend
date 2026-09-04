/**
 * mapMutators — per-map environmental modifiers (issue #54).
 *
 * Covers the deterministic per-map roll (seed determinism, eligibility gate,
 * none-bucket, variety), the pure speed-factor
 * and overtime-premium helpers (including the winnability cap on crunch), and
 * that the premium folds UNDER the per-map score cap.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
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
const OVERCLOCK: MapMutator = {
  id: "overclock", name: "Overclock", description: "d", behavior: "overclock",
  weight: 1, params: { factor: 1.18 }, overtimePremium: 2,
};
/** The level-gated entry, so the eligibility range is tested against a real one. */
const GRAVITY: MapMutator = {
  id: "gravity_well", name: "Technical Gravity", description: "d", behavior: "gravity",
  minLevel: 14, weight: 50, overtimePremium: 4,
};
const POOL = [CRUNCH, OVERCLOCK, GRAVITY];

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

  it("respects the eligible level range (gravity is level 14+)", () => {
    expect(eligibleMutators(12, POOL).map(m => m.id)).not.toContain("gravity_well");
    expect(eligibleMutators(14, POOL).map(m => m.id)).toContain("gravity_well");
    // At level 12 it can never be picked even though its weight is huge.
    for (const s of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
      expect(selectMapMutator(12, createRng(s), POOL, 0)?.id).not.toBe("gravity_well");
    }
    // At level 14 its heavy weight means it shows up across seeds.
    const picks = ["1", "2", "3", "4", "5", "6"].map(s => selectMapMutator(14, createRng(s), POOL, 0)?.id);
    expect(picks).toContain("gravity_well");
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

  it("hands out a COPY, never the catalogue entry itself", () => {
    // game.mapMutator is written to during play. Returning the shared entry
    // would leak one map's state into every later map that rolled the same one.
    const picked = selectMapMutator(12, createRng("s"), POOL, 0)!;
    expect(POOL.some(m => m === picked)).toBe(false);
    expect(POOL.some(m => m.id === picked.id)).toBe(true);
  });
});

describe("mutatorSpeedFactor (#54)", () => {
  it("is 1 with no mutator, or one that does not touch speed", () => {
    expect(mutatorSpeedFactor(null, 5)).toBe(1);
    expect(mutatorSpeedFactor({ ...GRAVITY } as ActiveMapMutator, 5)).toBe(1);
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

  /**
   * The premium used to fold under the per-map cap, which meant a hazard map
   * paid nothing extra on exactly the runs good enough to reach the ceiling.
   * Under the axis economy it is hazard pay: owed for playing the map at all,
   * so it belongs outside the axes and always lands.
   */
  it("is owed whatever route the run took", () => {
    const base = 20;
    const premium = mutatorOvertimePremium(CRUNCH as ActiveMapMutator);
    expect(premium).toBeGreaterThan(0);
    const without = calculateScore(5, 5, 10, 30, base, {}).levelScore;
    const withPremium = calculateScore(5, 5, 10, 30, base, { flatBonus: premium }).levelScore;
    expect(withPremium).toBe(without + premium);
  });
});

/**
 * The shipped pool, checked against the behaviours the code actually implements.
 *
 * parseMutatorEntry DROPS an entry whose behaviour it does not know, silently,
 * so a typo in the YAML does not break anything - it just quietly removes a
 * mutator from the game and nothing says so. This is the thing that would say
 * so.
 */
describe("public/mapMutators.yml", () => {
  const doc = yaml.load(
    readFileSync(resolve(process.cwd(), "public/mapMutators.yml"), "utf8"),
  ) as { mutators: Array<{ id: string; behavior: string }> };

  /** Every behaviour updateBall / mapMutators.ts has a rule for. */
  const IMPLEMENTED = new Set(["crunch", "overclock", "gravity", "none"]);

  it("only authors behaviours the code implements", () => {
    expect(doc.mutators.length, "the pool is empty").toBeGreaterThan(0);
    for (const m of doc.mutators) {
      expect(IMPLEMENTED.has(m.behavior), `${m.id}: unknown behavior "${m.behavior}"`).toBe(true);
    }
  });

  it("has no invisible current", () => {
    // The conveyor was removed deliberately, not by accident. It applied a
    // steady drift to every ball for a whole map with nothing on screen to say
    // so, in a game whose entire skill is predicting where a ball will be:
    // MAP_DESIGN_GUIDELINES.md's third convention says a Turn has to be visible coming or
    // it is an ambush, and an invisible force acting all map is exactly that.
    // Players read it as the map being broken, which is what it looks like.
    //
    // If it comes back it needs to be drawn first.
    for (const m of doc.mutators) {
      expect(m.behavior, `${m.id} is a conveyor`).not.toBe("conveyor");
    }
  });
});
