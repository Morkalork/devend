/**
 * A loadout that changes what WINNING MEANS.
 *
 * Every other modifier in the game tunes a number. `winRequiresSplitLocks`
 * appends a clause to a map's own win, which is a different kind of thing and
 * has a different worst case: a gate checking something the player was never
 * told, or a map made impossible by a card they picked six maps ago.
 *
 * So the two things under test are (1) every reader sees the SAME win, and
 * (2) a map that cannot carry the clause is left alone.
 */
import { describe, it, expect } from "vitest";
import {
  resolveWinSpec, baseWinSpec, acceptsRunClause, NO_RUN_RULES, isWinMet,
  type RunWinRules,
} from "@/lib/winSpec";
import { mapGoals } from "@/lib/goalTracker";
import { readWinSnapshot } from "@/lib/physics/applyCut";
import { LADDER } from "@/test/fixtures/maps";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { LoadoutData } from "@/types/loadout";
import type { LevelConfig } from "@/types/level";
import type { WinSnapshot } from "@/types/winSpec";

const ON: RunWinRules = { winRequiresSplitLocks: 1 };

const level = (over: Partial<LevelConfig> = {}): LevelConfig => ({
  id: "l", level: 4, sizeThreshold: 30, expectedCuts: 5, points: 20,
  balls: [], maxBalls: 2, ...over,
} as LevelConfig);

const plainWin = { require: [{ kind: "space", threshold: 30 }], alsoWinIf: [] };

const snap = (over: Partial<WinSnapshot> = {}): WinSnapshot => ({
  remainingPercent: 100, lockedBalls: 0, superiorLocks: 0, areaTargets: 0,
  lockedByType: {}, lockPoints: [], delivered: 0, smashed: 0, terminals: 0,
  harvested: 0, bossDefeated: false, allLocked: false, cuts: 0, par: 5,
  activeSeconds: 0, ...over,
});

const kinds = (l: LevelConfig, rules: RunWinRules) =>
  resolveWinSpec(l, rules).require.map(c => c.kind);

describe("a run clause is appended to the maps that can carry it", () => {
  it("adds nothing when the run asks for nothing", () => {
    const l = level({ win: plainWin } as Partial<LevelConfig>);
    expect(kinds(l, NO_RUN_RULES)).toEqual(["space"]);
    expect(resolveWinSpec(l, NO_RUN_RULES)).toEqual(baseWinSpec(l));
  });

  it("adds the clause to a plain clear", () => {
    const l = level({ win: plainWin } as Partial<LevelConfig>);
    expect(kinds(l, ON)).toEqual(["space", "splitLocks"]);
  });

  it("adds it to a clear-and-lock map too, which is the same shape", () => {
    const l = level({ win: {
      require: [{ kind: "space", threshold: 30 }, { kind: "locks", count: 1 }],
      alsoWinIf: [],
    } } as Partial<LevelConfig>);
    expect(kinds(l, ON)).toEqual(["space", "locks", "splitLocks"]);
  });
});

describe("and left off the maps that cannot", () => {
  it("leaves a boss map alone, whose ending is the boss", () => {
    const l = level({ boss: { id: "b" } } as unknown as Partial<LevelConfig>);
    expect(kinds(l, NO_RUN_RULES)).toEqual(["boss"]);
    expect(kinds(l, ON)).toEqual(["boss"]);
  });

  it("leaves a gate-area map alone, whose ending is the zone", () => {
    const l = level({ coloredAreas: [
      { kind: "const", x: 0, y: 0, width: 100, height: 100, required: true },
    ] } as Partial<LevelConfig>);
    expect(kinds(l, NO_RUN_RULES)).toEqual(["area"]);
    expect(kinds(l, ON)).toEqual(["area"]);
  });

  it("leaves a map that cannot spawn two sides' worth alone", () => {
    const l = level({ maxBalls: 1, win: plainWin } as Partial<LevelConfig>);
    expect(kinds(l, ON)).toEqual(["space"]);
  });

  it("does not double up on a map that already asks for it", () => {
    // Level 2 authored this clause itself. A second copy would list the same
    // requirement twice and let a run rule overrule the author's own count.
    const l = LADDER.find(x => x.id === "level-2")!;
    expect(kinds(l, NO_RUN_RULES)).toEqual(["space", "splitLocks"]);
    expect(kinds(l, ON)).toEqual(["space", "splitLocks"]);
  });

  it("never makes a shipped map unwinnable", () => {
    // The whole ladder, against the rule rather than against a hand-picked
    // sample: an appended clause must never ask for more balls than the map has.
    for (const l of LADDER) {
      const spec = resolveWinSpec(l, ON);
      const split = spec.require.find(c => c.kind === "splitLocks");
      if (!split || split.kind !== "splitLocks") continue;
      expect(split.count * 2, `level ${l.level} (${l.id})`)
        .toBeLessThanOrEqual(l.maxBalls ?? 1);
    }
  });
});

describe("the whole game reads one win", () => {
  /**
   * The bug this feature can have is asymmetry: the gate checking a clause the
   * player was never shown. Every reader goes through resolveWinSpec, so the
   * check is that they are handed the same rules, not that each renders well.
   */
  const l = level({ win: plainWin } as Partial<LevelConfig>);

  it("puts the added clause in the goal list the player watches", () => {
    const withRun = mapGoals(resolveWinSpec(l, ON), snap());
    const without = mapGoals(resolveWinSpec(l, NO_RUN_RULES), snap());
    expect(withRun.some(g => g.kind === "splitLocks")).toBe(true);
    expect(without.some(g => g.kind === "splitLocks")).toBe(false);
  });

  it("holds the map open until the added clause is met", () => {
    const cleared = snap({ remainingPercent: 10, lockedBalls: 2 });
    expect(isWinMet(resolveWinSpec(l, NO_RUN_RULES), cleared)).toBe(true);
    expect(isWinMet(resolveWinSpec(l, ON), cleared)).toBe(false);
    const split = snap({
      remainingPercent: 10, lockedBalls: 2,
      lockPoints: [{ x: 100, y: 400 }, { x: 800, y: 400 }],
    });
    expect(isWinMet(resolveWinSpec(l, ON), split)).toBe(true);
  });

  it("keeps the authoring tools looking at the MAP, not at a run", () => {
    // winSpecProblems blaming a map because a loadout broke it would be
    // blaming the wrong document.
    expect(baseWinSpec(l).require.map(c => c.kind)).toEqual(["space"]);
  });
});

describe("acceptsRunClause states the rule on its own", () => {
  it("refuses a count of zero", () => {
    expect(acceptsRunClause(baseWinSpec(level({ win: plainWin } as Partial<LevelConfig>)), level(), 0))
      .toBe(false);
  });

  it("refuses an empty requirement list", () => {
    expect(acceptsRunClause({ require: [], alsoWinIf: [], authored: true }, level(), 1))
      .toBe(false);
  });
});

describe("Definition of Done ships the rule as a card", () => {
  // Straight from the YAML source of truth, like loadoutDraft.test.ts.
  const catalogue = (yaml.load(
    readFileSync(resolve(process.cwd(), "public/loadouts.yml"), "utf8"),
  ) as LoadoutData).loadouts;

  it("is in the catalogue, gated, and pays for what it asks", () => {
    const card = catalogue.find(l => l.id === "definition_of_done");
    expect(card, "the loadout should ship").toBeDefined();
    expect(card!.modifiers.winRequiresSplitLocks).toBe(1);
    // A curse this large has to be paid for, or nobody drafts it twice.
    expect(card!.modifiers.scoreMultiplier).toBeGreaterThan(1);
    expect(card!.uniqueWinsRequired).toBeGreaterThan(0);
  });
});
