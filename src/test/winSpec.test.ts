/**
 * A map's win, as data.
 *
 * It used to be an implicit priority chain in applyCut.ts over five unrelated
 * LevelConfig fields, where the fact that a gate area REPLACES the space clear
 * rather than adding to it was expressed only by the order of the `if`s. And
 * the "How to win" modal read those same five fields a SECOND time to reach its
 * own conclusion, so a map could tell the player one thing and check another.
 *
 * The single most important property here is that introducing the model changed
 * nothing: every shipped map's derived spec has to mean exactly what the old
 * chain meant, or 40 maps quietly re-tune themselves.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  resolveWinSpec, evaluateWinCondition, isWinMet, winningCondition,
  winSpecProblems, winReasonFor, winBonusPercent,
} from "@/lib/winSpec";
import { WIN_CONDITION_KINDS } from "@/types/winSpec";
import type { WinCondition, WinSnapshot } from "@/types/winSpec";
import type { LevelConfig } from "@/types/level";

const level = (over: Partial<LevelConfig> = {}): LevelConfig => ({
  id: "l", level: 5, sizeThreshold: 20, expectedCuts: 6, points: 20,
  balls: [], maxBalls: 3,
  ...over,
} as LevelConfig);

const snap = (over: Partial<WinSnapshot> = {}): WinSnapshot => ({
  remainingPercent: 100, lockedBalls: 0, superiorLocks: 0, areaTargets: 0,
  lockedByType: {}, bossDefeated: false, allLocked: false,
  cuts: 0, par: 6, activeSeconds: 0,
  ...over,
});

const gateArea = { kind: "const", x: 0, y: 0, width: 100, height: 100, required: true };

// ── The compatibility contract ─────────────────────────────────────────────

describe("deriving a spec reproduces the old chain exactly", () => {
  it("makes an ordinary map a space clear with the all-locked shortcut", () => {
    const spec = resolveWinSpec(level({ sizeThreshold: 20 }));
    expect(spec.authored).toBe(false);
    expect(spec.require).toEqual([{ kind: "space", threshold: 20 }]);
    expect(spec.alsoWinIf).toEqual([{ kind: "allLocked" }]);
  });

  it("carries threadLockRequired alongside the clear, not instead of it", () => {
    const spec = resolveWinSpec(level({ threadLockRequired: 2 }));
    expect(spec.require).toEqual([
      { kind: "space", threshold: 20 },
      { kind: "locks", count: 2 },
    ]);
  });

  /**
   * The clause the ordering encoded: a gate area is the SOLE win. A derivation
   * that also emitted the space clause would turn level 10 into "fill the zone
   * AND clear 85% of the board", which is a different and much harder map.
   */
  it("makes a gate area the sole win, with no space clause at all", () => {
    const spec = resolveWinSpec(level({ coloredAreas: [gateArea] } as Partial<LevelConfig>));
    expect(spec.require).toEqual([{ kind: "area", count: 1 }]);
    expect(spec.alsoWinIf, "locking everything must not walk around the gate").toEqual([]);
  });

  it("makes a boss the sole win, so space never applies", () => {
    const spec = resolveWinSpec(level({ boss: { objective: {} } } as unknown as Partial<LevelConfig>));
    expect(spec.require).toEqual([{ kind: "boss" }]);
    expect(spec.alsoWinIf).toEqual([]);
  });

  it("derives count 1 for an area, matching the old boolean", () => {
    // coloredAreaSatisfied was set by the FIRST target in, so the equivalent
    // count is one; anything higher would silently make level 10 harder.
    const spec = resolveWinSpec(level({ coloredAreas: [gateArea] } as Partial<LevelConfig>));
    expect(spec.require[0]).toEqual({ kind: "area", count: 1 });
  });

  it("takes an authored block over the derivation", () => {
    const spec = resolveWinSpec(level({
      threadLockRequired: 9,
      win: { require: [{ kind: "superiorLocks", count: 2 }] },
    } as Partial<LevelConfig>));
    expect(spec.authored).toBe(true);
    expect(spec.require).toEqual([{ kind: "superiorLocks", count: 2 }]);
  });

  /** An authored gate that all-locked could walk around would not be a gate. */
  it("gives an authored spec no alternatives it did not ask for", () => {
    const spec = resolveWinSpec(level({
      win: { require: [{ kind: "area", count: 2 }] },
    } as Partial<LevelConfig>));
    expect(spec.alsoWinIf).toEqual([]);
  });
});

describe("every shipped map still means what it meant", () => {
  const MAPS = (yaml.load(
    readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
  ) as { levels: LevelConfig[] }).levels;

  /**
   * Act IV states its own win conditions; every other map still derives one.
   * Pinned as a LIST rather than a count so authoring a `win:` block on a map
   * is a deliberate act that shows up here, not something that drifts in.
   */
  it("authors a win only on the maps that mean to", () => {
    expect(MAPS.length).toBeGreaterThan(30);
    const authored = MAPS.filter(m => resolveWinSpec(m).authored).map(m => String(m.id));
    expect(authored.sort()).toEqual(["level-32", "level-33", "level-34"]);
  });

  it("still derives a working spec for every other map", () => {
    for (const m of MAPS) {
      if (resolveWinSpec(m).authored) continue;
      expect(resolveWinSpec(m).require.length, String(m.id)).toBeGreaterThan(0);
    }
  });

  it("gives every map at least one required clause", () => {
    // An empty require list is treated as unwinnable, so a derivation that
    // produced one would strand the map forever.
    for (const m of MAPS) {
      expect(resolveWinSpec(m).require.length, `${m.id} has no win`).toBeGreaterThan(0);
    }
  });

  it("flags no shipped map as unwinnable", () => {
    const broken = MAPS
      .map(m => [m.id, winSpecProblems(resolveWinSpec(m), m)] as const)
      .filter(([, p]) => p.length > 0);
    expect(broken.map(([id, p]) => `${id}: ${p.join(" ")}`)).toEqual([]);
  });

  it("keeps the space clause on every ordinary map", () => {
    const ordinary = MAPS.filter(m => !m.boss && !(m.coloredAreas ?? []).some(a => a.required !== false));
    expect(ordinary.length).toBeGreaterThan(20);
    for (const m of ordinary) {
      expect(resolveWinSpec(m).require.some(c => c.kind === "space"), String(m.id)).toBe(true);
    }
  });
});

// ── Evaluation ─────────────────────────────────────────────────────────────

describe("evaluating clauses", () => {
  it("treats the space clear as a limit, met at exactly the threshold", () => {
    // The HUD shows CLEAR at remaining == threshold; a strictly-less check left
    // the map unfinished on an exact landing.
    const c: WinCondition = { kind: "space", threshold: 12 };
    expect(evaluateWinCondition(c, snap({ remainingPercent: 12 })).met).toBe(true);
    expect(evaluateWinCondition(c, snap({ remainingPercent: 13 })).met).toBe(false);
    expect(evaluateWinCondition(c, snap({ remainingPercent: 12 })).mode).toBe("limit");
  });

  it("counts area targets, so two balls in a zone is expressible", () => {
    const c: WinCondition = { kind: "area", count: 2 };
    expect(evaluateWinCondition(c, snap({ areaTargets: 1 })).met).toBe(false);
    expect(evaluateWinCondition(c, snap({ areaTargets: 2 })).met).toBe(true);
  });

  it("counts locks of a named ball type only", () => {
    const c: WinCondition = { kind: "lockType", ballType: "black", count: 1 };
    expect(evaluateWinCondition(c, snap({ lockedByType: { red: 4 } })).met).toBe(false);
    expect(evaluateWinCondition(c, snap({ lockedByType: { black: 1 } })).met).toBe(true);
  });

  it("reads under-par relative to the map's own par", () => {
    const c: WinCondition = { kind: "underPar", delta: -1 };
    expect(evaluateWinCondition(c, snap({ par: 6, cuts: 5 })).met).toBe(true);
    expect(evaluateWinCondition(c, snap({ par: 6, cuts: 6 })).met).toBe(false);
  });

  /** limit clauses start met and can only be lost, so a HUD must not celebrate
   *  them at second zero. */
  it("marks the limit clauses as limits", () => {
    for (const c of [
      { kind: "underPar", delta: 0 }, { kind: "speedClear", seconds: 60 },
    ] as WinCondition[]) {
      expect(evaluateWinCondition(c, snap()).mode, c.kind).toBe("limit");
    }
  });
});

describe("deciding the win", () => {
  it("needs every required clause", () => {
    const spec = { require: [
      { kind: "space", threshold: 20 }, { kind: "superiorLocks", count: 1 },
    ] as WinCondition[], alsoWinIf: [], authored: true };
    expect(isWinMet(spec, snap({ remainingPercent: 10 }))).toBe(false);
    expect(isWinMet(spec, snap({ remainingPercent: 10, superiorLocks: 1 }))).toBe(true);
  });

  it("takes any single alternative", () => {
    const spec = {
      require: [{ kind: "space", threshold: 5 }] as WinCondition[],
      alsoWinIf: [{ kind: "allLocked" }] as WinCondition[], authored: false,
    };
    expect(isWinMet(spec, snap({ remainingPercent: 90, allLocked: true }))).toBe(true);
  });

  /**
   * An empty require list would otherwise be won on the first frame, which is a
   * far more confusing way to report an authoring mistake than never
   * completing. The panel flags it outright.
   */
  it("treats a spec with no requirement as unwinnable, not instantly won", () => {
    expect(isWinMet({ require: [], alsoWinIf: [], authored: true }, snap())).toBe(false);
  });

  it("names the most specific met clause as the reason", () => {
    const spec = {
      require: [{ kind: "space", threshold: 50 }, { kind: "boss" }] as WinCondition[],
      alsoWinIf: [], authored: true,
    };
    const s = snap({ remainingPercent: 10, bossDefeated: true });
    expect(winningCondition(spec, s)?.kind).toBe("boss");
  });

  it("names nothing while the win is unmet", () => {
    const spec = { require: [{ kind: "boss" }] as WinCondition[], alsoWinIf: [], authored: true };
    expect(winningCondition(spec, snap())).toBeNull();
  });
});

describe("reporting the reason", () => {
  const won = snap({
    remainingPercent: 0, lockedBalls: 9, superiorLocks: 9, areaTargets: 9,
    lockedByType: { black: 9 }, bossDefeated: true, allLocked: true, par: 9,
  });

  it("maps every condition kind to one of the four stored reasons", () => {
    const sample: Record<string, WinCondition> = {
      space: { kind: "space", threshold: 50 }, locks: { kind: "locks", count: 1 },
      superiorLocks: { kind: "superiorLocks", count: 1 }, area: { kind: "area", count: 1 },
      lockType: { kind: "lockType", ballType: "black", count: 1 }, boss: { kind: "boss" },
      allLocked: { kind: "allLocked" }, underPar: { kind: "underPar", delta: 0 },
      speedClear: { kind: "speedClear", seconds: 60 },
    };
    for (const kind of WIN_CONDITION_KINDS) {
      const reason = winReasonFor({ require: [sample[kind]], alsoWinIf: [], authored: true }, won);
      expect(["space", "allLocked", "boss", "area"], kind).toContain(reason);
    }
  });
});

// ── The authoring guard ────────────────────────────────────────────────────

describe("flagging a map that can never be won", () => {
  const problems = (win: WinCondition[], over: Partial<LevelConfig> = {}) =>
    winSpecProblems({ require: win, alsoWinIf: [], authored: true }, level(over));

  it("catches an area clause on a map with no gate area", () => {
    expect(problems([{ kind: "area", count: 1 }]).join(" ")).toMatch(/no gate area/);
  });

  it("catches a boss clause on a map with no boss", () => {
    expect(problems([{ kind: "boss" }]).join(" ")).toMatch(/no boss/);
  });

  it("catches asking for more locks than the map spawns balls", () => {
    expect(problems([{ kind: "locks", count: 9 }], { maxBalls: 3 }).join(" "))
      .toMatch(/spawns at most 3/);
    expect(problems([{ kind: "superiorLocks", count: 9 }], { maxBalls: 3 })).not.toEqual([]);
    expect(problems([{ kind: "area", count: 9 }], { maxBalls: 3, coloredAreas: [gateArea] } as Partial<LevelConfig>))
      .not.toEqual([]);
  });

  it("catches a cut budget below one cut", () => {
    expect(problems([{ kind: "underPar", delta: -9 }], { expectedCuts: 6 }).join(" "))
      .toMatch(/less than one cut/);
  });

  it("catches an empty requirement", () => {
    expect(problems([]).join(" ")).toMatch(/never be won/);
  });

  /** Lock everything and there is nothing left to put in the zone. */
  it("catches all-locked paired with a clause about a specific ball", () => {
    expect(problems([{ kind: "allLocked" }, { kind: "area", count: 1 }],
      { coloredAreas: [gateArea] } as Partial<LevelConfig>).join(" "))
      .toMatch(/never be checked/);
  });

  it("passes a sane spec", () => {
    expect(problems([{ kind: "space", threshold: 20 }, { kind: "superiorLocks", count: 1 }]))
      .toEqual([]);
  });
});

/**
 * The win premium: what a map's own conditions say they are worth.
 *
 * This is the first thing in the economy that makes one map worth more than
 * another. Every map carries `points: 20` and the five axis ceilings are the
 * same everywhere, so a genuinely harder win has always paid exactly what an
 * easy one did.
 */
describe("pricing a win condition", () => {
  const spec = (require: WinCondition[], alsoWinIf: WinCondition[] = []) =>
    ({ require, alsoWinIf, authored: true });
  const won = snap({ remainingPercent: 0, lockedBalls: 4, areaTargets: 2, allLocked: true });

  it("pays nothing until the map is actually won", () => {
    const s = spec([{ kind: "area", count: 2, bonusPercent: 30 }]);
    expect(winBonusPercent(s, snap({ areaTargets: 1 }))).toBe(0);
    expect(winBonusPercent(s, snap({ areaTargets: 2 }))).toBe(30);
  });

  it("pays nothing when no clause is priced", () => {
    expect(winBonusPercent(spec([{ kind: "area", count: 1 }]), won)).toBe(0);
  });

  /** Additive so an author can total a list of clauses by eye. */
  it("adds the premiums of required clauses rather than compounding them", () => {
    const s = spec([
      { kind: "locks", count: 1, bonusPercent: 20 },
      { kind: "area", count: 1, bonusPercent: 30 },
    ]);
    expect(winBonusPercent(s, won)).toBe(50);
  });

  /**
   * A required clause always pays, because the map cannot be won without it.
   * An alternative pays only when it is the route that actually fired, which is
   * what makes a hard alternative worth TAKING rather than merely possible.
   */
  it("pays only the alternative that fired, not the requirements it skipped", () => {
    const s = spec(
      [{ kind: "space", threshold: 5, bonusPercent: 10 }],
      [{ kind: "allLocked", bonusPercent: 40 }],
    );
    // Everything locked while the board is nowhere near clear: the alternative
    // ended the map, so the space clause's premium was never earned.
    expect(winBonusPercent(s, snap({ remainingPercent: 90, allLocked: true }))).toBe(40);
  });

  it("pays the requirements when they are what finished the map", () => {
    const s = spec(
      [{ kind: "space", threshold: 5, bonusPercent: 10 }],
      [{ kind: "allLocked", bonusPercent: 40 }],
    );
    expect(winBonusPercent(s, snap({ remainingPercent: 4 }))).toBe(10);
  });

  it("ignores a zero, negative or missing premium", () => {
    for (const p of [0, -30, undefined, NaN]) {
      const s = spec([{ kind: "area", count: 1, bonusPercent: p as number }]);
      expect(winBonusPercent(s, won), String(p)).toBe(0);
    }
  });

  it("flags a premium far past what the economy is tuned for", () => {
    const problems = winSpecProblems(
      spec([{ kind: "area", count: 1, bonusPercent: 500 }]),
      level({ coloredAreas: [gateArea] } as Partial<LevelConfig>));
    expect(problems.join(" ")).toMatch(/far past/);
  });

  it("accepts a sensible premium without complaint", () => {
    const problems = winSpecProblems(
      spec([{ kind: "area", count: 1, bonusPercent: 30 }]),
      level({ coloredAreas: [gateArea] } as Partial<LevelConfig>));
    expect(problems).toEqual([]);
  });

  /** Derived specs are the 40 shipped maps, which must not start paying more. */
  it("prices nothing on a derived spec", () => {
    for (const l of [level(), level({ threadLockRequired: 2 }),
                     level({ coloredAreas: [gateArea] } as Partial<LevelConfig>)]) {
      expect(winBonusPercent(resolveWinSpec(l), won)).toBe(0);
    }
  });
});
