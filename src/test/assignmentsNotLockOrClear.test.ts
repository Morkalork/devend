/**
 * Three contracts that are not about locking balls or clearing board.
 *
 * The roster had drifted into one shape: every assignment counted locks, or
 * counted maps cleared under some bar. Zero Incidents, Budget Freeze and Double
 * Down replace Cost Cutting, Lockdown Protocol and Crunch Delivery, and each
 * grades something the others cannot see - lives kept, money not spent, bets
 * won.
 *
 * ── The rule that shaped them ────────────────────────────────────────────────
 *
 * A mission that depends on a map FEATURE needs an eligibility answer, because
 * a five-map block can contain almost none of it. `smashCount` has one:
 * `resolveForBlock` sizes its tiers to 70% of the block's breakables and
 * refuses the mission outright when that leaves fewer than two, so a block with
 * one breakable map never offers it. That is the cost of a feature-bound
 * contract - it needs its own capacity rule, and it spends draft slots it then
 * declines to fill.
 *
 * Lives, the store and Push Your Luck need no such rule: they are on every map
 * of every block, so these three are always offerable and always finishable.
 * That is why they were chosen over the pickup and ability ideas.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { conditionMetForMap, assignmentMetric, evaluateAssignment } from "@/lib/assignments";
import {
  assignmentsPlayableInBlock, resolveForBlock, blockBreakableCount, SMASH_TOP_TIER_SHARE,
} from "@/lib/assignmentScaling";
import type { AssignmentConfig, AssignmentMapResult } from "@/types/assignment";
import type { LevelConfig } from "@/types/level";

const DOC = yaml.load(
  readFileSync(resolve(process.cwd(), "public/assignments.yml"), "utf8"),
) as { assignments: AssignmentConfig[] };
const byId = (id: string) => DOC.assignments.find(a => a.id === id);

/** A finished map that met nothing in particular. */
const map = (over: Partial<AssignmentMapResult> = {}): AssignmentMapResult => ({
  locks: 0, superiorLocks: 0, cutsDelta: 0, clearSeconds: 60,
  ballCount: 0, allBallsLocked: false, lockedByType: {}, smashes: 0,
  livesLost: 0, spent: 0, pushWon: false,
  ...over,
});

describe("the three replaced contracts are gone", () => {
  it.each(["cost_cutting", "lockdown_protocol", "crunch_delivery"])("%s is no longer offered", (id) => {
    expect(byId(id)).toBeUndefined();
  });

  it("keeps the roster the same size", () => {
    expect(DOC.assignments).toHaveLength(11);
  });
});

describe("Zero Incidents grades survival", () => {
  const a = byId("zero_incidents")!;

  it("is authored and tracks lives, per map", () => {
    expect(a, "zero_incidents missing").toBeTruthy();
    expect(a.mission.track.kind).toBe("noLivesLost");
    expect(a.mission.track.mode).toBe("everyMap");
  });

  it("passes a map finished without losing a life", () => {
    expect(conditionMetForMap("noLivesLost", undefined, map({ livesLost: 0 }))).toBe(true);
  });

  it("fails a map that cost one", () => {
    expect(conditionMetForMap("noLivesLost", undefined, map({ livesLost: 1 }))).toBe(false);
  });

  it("does not care how much was locked or cleared", () => {
    // The whole point: a map where nothing was sealed still passes, and a
    // flawless sweep that cost a life does not.
    expect(conditionMetForMap("noLivesLost", undefined, map({ locks: 0 }))).toBe(true);
    expect(conditionMetForMap("noLivesLost", undefined,
      map({ locks: 9, allBallsLocked: true, livesLost: 1 }))).toBe(false);
  });

  it("counts clean maps across the block", () => {
    const results = [map(), map({ livesLost: 2 }), map(), map()];
    expect(assignmentMetric(a.mission.track, results)).toBe(3);
  });
});

describe("Budget Freeze grades restraint", () => {
  const a = byId("budget_freeze")!;

  it("is authored and tracks spend, per map", () => {
    expect(a, "budget_freeze missing").toBeTruthy();
    expect(a.mission.track.kind).toBe("noSpend");
    expect(a.mission.track.mode).toBe("everyMap");
  });

  it("passes a map whose store visit was walked out of empty handed", () => {
    expect(conditionMetForMap("noSpend", undefined, map({ spent: 0 }))).toBe(true);
  });

  it("fails on any purchase at all, however small", () => {
    expect(conditionMetForMap("noSpend", undefined, map({ spent: 1 }))).toBe(false);
  });

  it("has no constraint, because going without is the constraint", () => {
    expect(a.constraint?.modifiers ?? {}).toEqual({});
  });

  it("is reachable at its top tier despite the block's last map having no store", () => {
    // A five-map block offers four visits: the last map is the assignment
    // level, whose store the contract phase replaces. That map records spent 0
    // and passes, so tier 5 is reachable rather than a trap.
    const block = [map(), map(), map(), map(), map()];
    const top = Math.max(...a.mission.tiers.map(t => t.threshold));
    expect(assignmentMetric(a.mission.track, block)).toBeGreaterThanOrEqual(top);
  });
});

describe("Double Down grades nerve", () => {
  const a = byId("double_down")!;

  it("is authored and sums pushes over the block", () => {
    expect(a, "double_down missing").toBeTruthy();
    expect(a.mission.track.kind).toBe("pushesWon");
    expect(a.mission.track.mode).toBe("cumulative");
  });

  it("counts a banked push", () => {
    expect(conditionMetForMap("pushesWon", undefined, map({ pushWon: true }))).toBe(true);
  });

  it("does not count declining the offer", () => {
    // Playing safe is allowed and scores nothing, which is the bet.
    expect(conditionMetForMap("pushesWon", undefined, map({ pushWon: false }))).toBe(false);
  });

  it("sums them across the block", () => {
    const results = [map({ pushWon: true }), map(), map({ pushWon: true }), map()];
    expect(assignmentMetric(a.mission.track, results)).toBe(2);
    expect(evaluateAssignment(a, results).highestReachedIndex).toBeGreaterThanOrEqual(0);
  });
});

describe("none of the three can be satisfied by locking or clearing", () => {
  it.each(["zero_incidents", "budget_freeze", "double_down"])(
    "%s ignores a perfect lock-and-clear map",
    (id) => {
      const a = byId(id)!;
      // Everything the old roster measured, maxed out. If any of these three
      // scored off it, it would just be another throughput contract.
      const perfect = map({
        locks: 9, superiorLocks: 9, allBallsLocked: true,
        cutsDelta: -5, clearSeconds: 5, smashes: 9,
        livesLost: 1, spent: 500, pushWon: false,
      });
      expect(assignmentMetric(a.mission.track, [perfect])).toBe(0);
    },
  );
});

describe("every constraint names a modifier that exists", () => {
  // The `mutator: gravity` class: a constraint whose modifier resolves to
  // nothing reads as a rule to the player and does nothing at all. Double Down
  // wanted "a failed push costs a life", which has no modifier behind it.
  const src = readFileSync(resolve(process.cwd(), "src/hooks/useActiveModifiers.ts"), "utf8");

  it.each(DOC.assignments.map(a => [a.id, a] as const))("%s", (_id, a) => {
    for (const key of Object.keys(a.constraint?.modifiers ?? {})) {
      expect(
        new RegExp(`\\b${key}\\s*[:,]`).test(src),
        `${a.id} names modifier "${key}", which GameModifiers does not have`,
      ).toBe(true);
    }
  });
});

/**
 * The contrast that picked these three: what a feature-bound mission costs, and
 * what these avoid by not being one.
 */
describe("a mission bound to a map feature needs an eligibility rule", () => {
  const LEVELS = (yaml.load(
    readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
  ) as { levels: LevelConfig[] }).levels;

  it("smashCount is the only feature-bound contract left", () => {
    const featureBound = DOC.assignments.filter(a => a.mission.track.kind === "smashCount");
    expect(featureBound.map(a => a.id)).toEqual(["tech_debt_writedown"]);
  });

  it("and it is refused on a block too thin to carry it", () => {
    // Not "unguarded": resolveForBlock sizes it to 70% of the block's
    // breakables and returns null below two, so a thin block drops it from the
    // pool rather than offering an unreachable top tier.
    const smash = DOC.assignments.find(a => a.mission.track.kind === "smashCount")!;
    const offered = (from: number) =>
      assignmentsPlayableInBlock([smash], LEVELS, from).length === 1;

    const verdicts = [6, 11, 16, 21, 26, 31].map(from => [from, offered(from)] as const);

    // The thin half of the ladder: 21-25, 26-30 and 31-35 hold 1, 1 and 2
    // breakables, which is under the two-tier minimum, so all three drop it.
    expect(verdicts.filter(([, ok]) => !ok).map(([from]) => from)).toEqual([21, 26, 31]);
    expect(verdicts.filter(([, ok]) => ok).map(([from]) => from)).toEqual([6, 11, 16]);

    // Wherever it IS offered, its top tier fits inside what the block holds.
    for (const [from, ok] of verdicts) {
      if (!ok) continue;
      const sized = resolveForBlock(smash, LEVELS, from)!;
      const top = Math.max(...sized.mission.tiers.map(t => t.threshold));
      expect(top, `block ${from}`)
        .toBeLessThanOrEqual(Math.floor(blockBreakableCount(LEVELS, from) * SMASH_TOP_TIER_SHARE));
    }
  });

  it("the three new ones need no such rule, because no map can lack them", () => {
    for (const id of ["zero_incidents", "budget_freeze", "double_down"]) {
      const a = byId(id)!;
      expect(["noLivesLost", "noSpend", "pushesWon"]).toContain(a.mission.track.kind);
      // Offerable on every block, unlike the feature-bound one above.
      for (const from of [6, 11, 16, 21, 26, 31]) {
        expect(assignmentsPlayableInBlock([a], LEVELS, from), `${id} dropped on block ${from}`)
          .toHaveLength(1);
      }
    }
  });
});
