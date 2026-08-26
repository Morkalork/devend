/**
 * Ship It and Tech Debt Writedown: missions gated on what a block contains.
 *
 * Both ask for something the maps have to supply, and neither can be offered
 * blind. `assignments.yml` already states the rule they are up against: taking
 * a constraint for five maps to chase a reward that could never be reached is
 * worse than a hard mission, it is a dead one.
 *
 *   Ship It    clear a map without sealing a ball. Impossible on any map whose
 *              win REQUIRES a lock, and act IV prices nearly every win that
 *              way - L31-35 has one map out of five that can be cleared clean.
 *   Writedown  smash breakables. Acts I and II carry three to five per block;
 *              L21-30 carry one, which is not a mission, it is an accident.
 *
 * So both are sized to the block and dropped from the draft when it cannot
 * carry them. These pin that, and pin the two per-map conditions underneath.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  blockSpaceWinnableMaps, blockBreakableCount, resolveForBlock,
  assignmentsPlayableInBlock, SMASH_TOP_TIER_SHARE, BLOCK_SIZE,
} from "@/lib/assignmentScaling";
import { conditionMetForMap, assignmentMetric } from "@/lib/assignments";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { processDestroysFn } from "@/lib/physics/destructibles";
import type { CanvasGameState } from "@/types/gameState";
import type { AssignmentConfig, AssignmentMapResult } from "@/types/assignment";
import type { LevelData } from "@/types/level";

const levels = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels;
const pool = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/assignments.yml"), "utf8"),
) as { assignments: AssignmentConfig[] }).assignments;

/** The blocks a real run drafts over: every 5th completed level. */
const BLOCK_STARTS = [6, 11, 16, 21, 26, 31];

const shipIt = pool.find(a => a.mission?.track?.kind === "noLocks")!;
const writedown = pool.find(a => a.mission?.track?.kind === "smashCount")!;

function mkMap(over: Partial<AssignmentMapResult> = {}): AssignmentMapResult {
  return {
    locks: 0, superiorLocks: 0, cutsDelta: 0, clearSeconds: 999,
    ballCount: 0, allBallsLocked: false, ...over,
  };
}

describe("clearing a map clean", () => {
  it("counts only a map where nothing was sealed", () => {
    expect(conditionMetForMap("noLocks", undefined, mkMap({ locks: 0 }))).toBe(true);
    expect(conditionMetForMap("noLocks", undefined, mkMap({ locks: 1 }))).toBe(false);
  });

  it("counts maps passed across the block", () => {
    const track = { mode: "everyMap", kind: "noLocks" } as const;
    expect(assignmentMetric(track, [
      mkMap({ locks: 0 }), mkMap({ locks: 3 }), mkMap({ locks: 0 }),
    ])).toBe(2);
  });
});

describe("counting a block's clean-clearable maps", () => {
  it("never counts a boss map", () => {
    // A boss map's objective IS trapping the boss.
    const withBoss = blockSpaceWinnableMaps(levels, 6);
    expect(withBoss).toBeLessThan(BLOCK_SIZE);
  });

  it("never counts a map whose win demands a lock", () => {
    // Act IV is the priced-win act: superiorLocks, lockType, area, boss.
    expect(blockSpaceWinnableMaps(levels, 31)).toBeLessThanOrEqual(1);
  });

  it("counts a block with no lock-priced wins in full", () => {
    expect(blockSpaceWinnableMaps(levels, 11)).toBe(BLOCK_SIZE);
  });
});

describe("smashing things", () => {
  it("counts a map that broke enough", () => {
    expect(conditionMetForMap("smashCount", { count: 2 }, mkMap({ smashes: 2 }))).toBe(true);
    expect(conditionMetForMap("smashCount", { count: 2 }, mkMap({ smashes: 1 }))).toBe(false);
  });

  it("sums across the block rather than counting maps", () => {
    // A cumulative mission: three on one map and none on the rest is three.
    const track = { mode: "cumulative", kind: "smashCount" } as const;
    expect(assignmentMetric(track, [
      mkMap({ smashes: 3 }), mkMap({ smashes: 0 }), mkMap({ smashes: 1 }),
    ])).toBe(4);
  });

  it("treats a map that reported nothing as zero, not as a pass", () => {
    const track = { mode: "cumulative", kind: "smashCount" } as const;
    expect(assignmentMetric(track, [mkMap({}), mkMap({})])).toBe(0);
  });
});

describe("a block that cannot carry a mission never offers it", () => {
  it("drops Ship It where nearly every win is priced in locks", () => {
    const offered = BLOCK_STARTS.filter(s => resolveForBlock(shipIt, levels, s) !== null);
    const dropped = BLOCK_STARTS.filter(s => !offered.includes(s));
    console.log(`Ship It offered in blocks: ${offered.join(", ")} | dropped: ${dropped.join(", ") || "none"}`);
    // It has to be a real mission somewhere, and it has to know when to stay out.
    expect(offered.length, "Ship It is never offered at all").toBeGreaterThan(2);
    expect(dropped, "act IV can carry a clean-clear mission?").toContain(31);
  });

  it("drops the Writedown where there is nothing to break", () => {
    const offered = BLOCK_STARTS.filter(s => resolveForBlock(writedown, levels, s) !== null);
    const dropped = BLOCK_STARTS.filter(s => !offered.includes(s));
    console.log(`Writedown offered in blocks: ${offered.join(", ")} | dropped: ${dropped.join(", ") || "none"}`);
    expect(offered.length, "the Writedown is never offered at all").toBeGreaterThan(0);
    for (const s of dropped) {
      expect(
        Math.floor(blockBreakableCount(levels, s) * SMASH_TOP_TIER_SHARE),
        `block ${s} was dropped but could carry a mission`,
      ).toBeLessThan(2);
    }
  });

  it("never asks for more than the block holds", () => {
    for (const start of BLOCK_STARTS) {
      const ship = resolveForBlock(shipIt, levels, start);
      if (ship) {
        const top = Math.max(...ship.mission.tiers.map(t => t.threshold));
        expect(top, `Ship It block ${start}`).toBeLessThanOrEqual(blockSpaceWinnableMaps(levels, start));
      }
      const dem = resolveForBlock(writedown, levels, start);
      if (dem) {
        const top = Math.max(...dem.mission.tiers.map(t => t.threshold));
        expect(top, `Writedown block ${start}`).toBeLessThanOrEqual(blockBreakableCount(levels, start));
      }
    }
  });

  it("keeps every tier a distinct, ascending rung after capping", () => {
    // Two rungs collapsed onto one number would pay the lower reward for the
    // higher effort.
    for (const start of BLOCK_STARTS) {
      for (const a of [shipIt, writedown]) {
        const r = resolveForBlock(a, levels, start);
        if (!r) continue;
        const th = r.mission.tiers.map(t => t.threshold);
        expect(th, `${a.id} block ${start}`).toHaveLength(a.mission.tiers.length);
        for (let i = 1; i < th.length; i++) {
          expect(th[i], `${a.id} block ${start}: ${th.join("/")}`).toBeGreaterThan(th[i - 1]);
        }
        expect(Math.min(...th), `${a.id} block ${start}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("is filtered out of the pool before the offers are drawn", () => {
    // The whole point of gating: it costs an offer slot, not a broken card.
    const playable = assignmentsPlayableInBlock(pool, levels, 31).map(a => a.id);
    expect(playable, "Ship It reached an act IV draft").not.toContain(shipIt.id);
    expect(playable.length, "act IV has no assignments left at all").toBeGreaterThan(2);
  });

  it("leaves the ungated missions alone in every block", () => {
    // Lock quotas and the rest have no content requirement and must never be
    // filtered out by this machinery.
    const ungated = pool.filter(a =>
      !["noLocks", "smashCount", "ballType"].includes(a.mission.track.kind),
    ).map(a => a.id);
    expect(ungated.length).toBeGreaterThan(0);
    for (const start of BLOCK_STARTS) {
      const playable = assignmentsPlayableInBlock(pool, levels, start).map(a => a.id);
      for (const id of ungated) expect(playable, `${id} dropped from block ${start}`).toContain(id);
    }
  });
});

describe("the shipped pair", () => {
  it("names the store cost of shipping clean rather than hiding it", () => {
    // The store's lock toll shuts it after a map with no locks whether or not
    // the card says so. Saying so is the difference between a cost and an
    // ambush.
    expect(shipIt.constraint?.text ?? "", "Ship It hides its real cost").toMatch(/store/i);
  });

  it("gives the Writedown a constraint that bites on its own skill", () => {
    // A tierDraft only sits on a constrained assignment, and slower fences is
    // what makes herding a ball into a block hard.
    expect(writedown.constraint?.modifiers?.fenceGenerationSpeedMultiplier).toBeLessThan(1);
  });
});

/**
 * The counter the Writedown reads.
 *
 * Behavioural, not structural, because this is the half that silently breaks:
 * a mission whose metric never moves looks exactly like a mission the player
 * failed. Driven through the real destroy pipeline rather than by setting the
 * field.
 */
describe("counting what was actually destroyed", () => {
  const CB = { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} };

  function build(levelNumber: number): CanvasGameState {
    const level = levels.find(l => l.level === levelNumber)!;
    const game = createInitialGameData(level, level.level, DEFAULT_MODIFIERS) as unknown as CanvasGameState;
    const g = game as unknown as Record<string, unknown>;
    for (const k of [
      "objectDebris", "fallingObjects", "pendingDestroys", "balls",
    ]) g[k] ??= [];
    g.breakBonus ??= 0; g.breakMultiplier ??= 1; g.objectivesBroken ??= 0;
    g.breakablesSmashed ??= 0;
    return game;
  }

  /** A level in the Writedown's own band, so this tests a real board. */
  const LEVEL = 11;

  function seedRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  afterEach(() => { vi.restoreAllMocks(); });

  it("starts a map at zero", () => {
    expect(build(LEVEL).breakablesSmashed).toBe(0);
  });

  it("counts every breakable the map loses", () => {
    const game = build(LEVEL);
    const breakables = game.destructibles.filter(d => d.kind === "breakable" && d.obstaclePolygon);
    expect(breakables.length, "level 11 has no breakables to count").toBeGreaterThan(0);

    for (const d of breakables) { d.destroyed = true; game.pendingDestroys.push(d); }
    processDestroysFn(game, CB, LEVEL, DEFAULT_MODIFIERS);

    expect(game.breakablesSmashed).toBe(breakables.length);
  });

  it("counts one that was TOPPLED, not smashed", () => {
    // A slab that came down because its supporter did is still a block the
    // player destroyed, and completeBreakable is the seam both routes share.
    //
    // Seeded, and swept: support is decided GEOMETRICALLY after the map is
    // rotated ("b sits just below a"), so a stack in the authored layout is
    // not a stack in every orientation the map can be dealt in. Picking one
    // run and hoping is how this test would become flaky.
    let tested = 0;
    for (let seed = 1; seed <= 8 && tested === 0; seed++) {
      vi.spyOn(Math, "random").mockImplementation(seedRandom(seed));
      const game = build(LEVEL);
      const supporters = new Set(
        game.stackObjects.filter(so => so.supporterId).map(so => so.supporterId as string),
      );
      const base = game.destructibles.find(d => d.kind === "breakable" && supporters.has(d.id));
      vi.restoreAllMocks();
      if (!base) continue;

      base.destroyed = true;
      game.pendingDestroys.push(base);
      processDestroysFn(game, CB, LEVEL, DEFAULT_MODIFIERS);

      // The supporter plus at least the thing that was resting on it.
      expect(game.breakablesSmashed, `seed ${seed}`).toBeGreaterThan(1);
      tested++;
    }
    expect(tested, "no orientation of level 11 stacked a breakable to topple").toBe(1);
  });
});
