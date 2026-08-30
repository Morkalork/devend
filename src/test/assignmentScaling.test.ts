/**
 * An assignment must be possible to finish.
 *
 * Reported as "the assignments are a bit too difficult, 20 locks is sometimes
 * every single available lock". Measured against map.yml it was worse than
 * that: the tiers were authored as absolute numbers and nothing ever compared
 * them to how many balls the next five maps put on the board.
 *
 *   block   balls available   lock_quota top   crunch_delivery top
 *    6-10         11              20 (182%)         40 (364%)
 *   11-15         14              20 (143%)         40 (286%)
 *   31-35          8              20 (250%)         40 (500%)
 *
 * A mission asking for more locks than there are balls is not a hard mission,
 * it is a dead one: the player carries the constraint for five maps chasing a
 * reward that was never reachable. Thresholds are now a share of the block's
 * real capacity, with more slack before level 20, where the player is still
 * learning to seal a pocket at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  blockLockCapacity, scaleAssignmentToBlock, scaleOffersForBlock, topTierShare,
  BLOCK_SIZE, TIGHTEN_FROM_LEVEL,
} from "@/lib/assignmentScaling";
import type { LevelConfig } from "@/types/level";
import type { AssignmentConfig } from "@/types/assignment";

const LEVELS = (yaml.load(
  readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
) as { levels: LevelConfig[] }).levels;

const ASSIGNMENTS = (yaml.load(
  readFileSync(resolve(__dirname, "../../public/assignments.yml"), "utf8"),
) as { assignments: AssignmentConfig[] }).assignments;

/** Every block the ladder actually offers, as its first level. */
const BLOCK_STARTS = [6, 11, 16, 21, 26, 31];

/** Cumulative missions that count locks: the only ones scaling touches. */
const LOCK_MISSIONS = ASSIGNMENTS.filter(a => {
  const t = a.mission?.track;
  return t?.mode === "cumulative" && (t.kind === "lockCount" || t.kind === "superiorLocks");
});

const topOf = (a: AssignmentConfig) => Math.max(...a.mission.tiers.map(t => t.threshold));

describe("what a block can actually give", () => {
  it("counts the balls across its five maps", () => {
    // Level variants share a level number and only one is ever played, so
    // summing them all would double-count balls that never coexist.
    for (const from of BLOCK_STARTS) {
      const cap = blockLockCapacity(LEVELS, from);
      expect(cap, `block ${from}`).toBeGreaterThan(0);
      expect(cap, `block ${from} counted variants twice`).toBeLessThanOrEqual(BLOCK_SIZE * 5);
    }
  });

  it("finds the small blocks that made this bite", () => {
    // 6-10 and 31-35 are the thin ones, and they are where an absolute target
    // was furthest out of reach.
    expect(blockLockCapacity(LEVELS, 6)).toBeLessThan(blockLockCapacity(LEVELS, 26));
    expect(blockLockCapacity(LEVELS, 31)).toBeLessThan(blockLockCapacity(LEVELS, 11));
  });
});

describe("every mission is finishable on every block", () => {
  it("never asks for more locks than the block has balls", () => {
    const impossible: string[] = [];
    for (const a of LOCK_MISSIONS) {
      for (const from of BLOCK_STARTS) {
        const cap = blockLockCapacity(LEVELS, from);
        const top = topOf(scaleAssignmentToBlock(a, cap, from));
        if (top > cap) impossible.push(`${a.id} block ${from}: ${top} of ${cap}`);
      }
    }
    expect(impossible).toEqual([]);
  });

  /** The actual complaint: reachable is not enough, it has to have slack. */
  it("leaves real slack rather than demanding every ball", () => {
    const tight: string[] = [];
    for (const a of LOCK_MISSIONS) {
      for (const from of BLOCK_STARTS) {
        const cap = blockLockCapacity(LEVELS, from);
        const top = topOf(scaleAssignmentToBlock(a, cap, from));
        if (top / cap > 0.80) tight.push(`${a.id} block ${from}: ${top} of ${cap}`);
      }
    }
    expect(tight).toEqual([]);
  });

  it("gives more slack before level 20 than after", () => {
    for (const kind of ["lockCount", "superiorLocks"]) {
      expect(topTierShare(kind, 6), kind).toBeLessThan(topTierShare(kind, 26));
      expect(topTierShare(kind, TIGHTEN_FROM_LEVEL - 1), kind)
        .toBeLessThan(topTierShare(kind, TIGHTEN_FROM_LEVEL));
    }
  });

  /**
   * A superior lock needs a pocket tight enough to grade, so converting even
   * half a roster is a strong block. Sharing a number with plain locks is what
   * left cost_cutting wanting ten superior locks from eleven balls.
   */
  it("asks for a smaller share of superior locks than of plain ones", () => {
    for (const from of [6, 26]) {
      expect(topTierShare("superiorLocks", from)).toBeLessThan(topTierShare("lockCount", from));
    }
  });
});

describe("scaling preserves what the author wrote", () => {
  /**
   * A purpose-built three-tier mission, not one plucked from the roster.
   *
   * It used to be `LOCK_MISSIONS.find(tiers.length === 3)`, which was Crunch
   * Delivery and nothing else - so retiring that contract took this test's
   * subject with it and left the scaler's spacing maths untested. What is being
   * measured here is a property of scaleAssignmentToBlock, not of the content,
   * and it should not stop working because someone edited the roster.
   */
  const threeTier: AssignmentConfig = {
    ...LOCK_MISSIONS[0],
    id: "spacing-probe",
    mission: {
      ...LOCK_MISSIONS[0].mission,
      tiers: [
        { threshold: 10, label: "a", reward: { type: "overtime", hours: 1 } },
        { threshold: 20, label: "b", reward: { type: "overtime", hours: 2 } },
        { threshold: 50, label: "c", reward: { type: "overtime", hours: 3 } },
      ],
    },
  };

  it("has a multi-tier mission to check", () => {
    // The fixture is only worth anything if the roster still has a lock mission
    // to base it on, and if it really carries three ascending tiers.
    expect(LOCK_MISSIONS.length, "no cumulative lock mission to model").toBeGreaterThan(0);
    expect(threeTier.mission.tiers).toHaveLength(3);
  });

  it("keeps the number of tiers", () => {
    for (const a of LOCK_MISSIONS) {
      for (const from of BLOCK_STARTS) {
        const scaled = scaleAssignmentToBlock(a, blockLockCapacity(LEVELS, from), from);
        expect(scaled.mission.tiers.length, `${a.id} block ${from}`).toBe(a.mission.tiers.length);
      }
    }
  });

  /** Two tiers rounding to the same number would pay the lower reward for the
   *  higher effort. */
  it("keeps the tiers strictly ascending", () => {
    for (const a of LOCK_MISSIONS) {
      for (const from of BLOCK_STARTS) {
        const t = scaleAssignmentToBlock(a, blockLockCapacity(LEVELS, from), from)
          .mission.tiers.map(x => x.threshold);
        for (let i = 1; i < t.length; i++) {
          expect(t[i], `${a.id} block ${from}: ${JSON.stringify(t)}`).toBeGreaterThan(t[i - 1]);
        }
        expect(t[0]).toBeGreaterThanOrEqual(1);
      }
    }
  });

  /**
   * No shipped block is small enough to make two tiers collide, so this drives
   * the guard directly. Without it a tiny block pays the lower reward for the
   * higher effort, and nothing on the real ladder would have caught it.
   */
  it("separates tiers that would otherwise round to the same number", () => {
    const twoTier = LOCK_MISSIONS.find(a => a.mission.tiers.length === 2)!;
    // A capacity this small squashes both authored tiers onto 1.
    const t = scaleAssignmentToBlock(twoTier, 2, 6).mission.tiers.map(x => x.threshold);
    expect(t[1], `collapsed to ${JSON.stringify(t)}`).toBeGreaterThan(t[0]);
  });

  it("keeps the relative spacing of a three-tier mission roughly intact", () => {
    const authored = threeTier.mission.tiers.map(t => t.threshold);
    const scaled = scaleAssignmentToBlock(threeTier, 15, 26).mission.tiers.map(t => t.threshold);
    const ratio = (v: number[]) => (v[1] - v[0]) / (v[2] - v[1]);
    expect(ratio(scaled)).toBeCloseTo(ratio(authored), 0);
  });

  /** A roomy block should make a mission easier, not move the goalposts. */
  it("never scales a mission UP", () => {
    for (const a of LOCK_MISSIONS) {
      const huge = scaleAssignmentToBlock(a, 10_000, 6);
      expect(topOf(huge), a.id).toBe(topOf(a));
    }
  });
});

describe("what scaling must not touch", () => {
  it("leaves everyMap missions alone", () => {
    // Their thresholds are maps-passed out of five and have nothing to do with
    // how many balls exist; scaling those by ball count would be nonsense.
    const perMap = ASSIGNMENTS.filter(a => a.mission?.track?.mode === "everyMap");
    expect(perMap.length, "expected some everyMap missions").toBeGreaterThan(0);
    for (const a of perMap) {
      expect(scaleAssignmentToBlock(a, 4, 6)).toBe(a);
    }
  });

  it("leaves a cumulative mission that is not about locks alone", () => {
    const other = ASSIGNMENTS.find(a =>
      a.mission?.track?.mode === "cumulative" &&
      a.mission.track.kind !== "lockCount" && a.mission.track.kind !== "superiorLocks");
    if (other) expect(scaleAssignmentToBlock(other, 4, 6)).toBe(other);
  });

  it("returns the assignment untouched on a nonsense capacity", () => {
    const a = LOCK_MISSIONS[0];
    for (const cap of [0, -5, NaN]) expect(scaleAssignmentToBlock(a, cap, 6)).toBe(a);
  });
});

describe("scaling a whole offer set", () => {
  it("sizes offers to the block that FOLLOWS the completed level", () => {
    // Offered after level 5, the block is 6-10; using level 5's own capacity
    // would size the mission against a map that has already been played.
    const offers = scaleOffersForBlock(LOCK_MISSIONS, LEVELS, 5);
    const cap = blockLockCapacity(LEVELS, 6);
    for (const a of offers) expect(topOf(a)).toBeLessThanOrEqual(cap);
  });

  it("returns one scaled offer per offer in", () => {
    expect(scaleOffersForBlock(LOCK_MISSIONS, LEVELS, 5)).toHaveLength(LOCK_MISSIONS.length);
  });
});

/**
 * The call site. A correct scaler is worth nothing if the draft hands out the
 * raw pool, which is exactly the state this was found in: the numbers were in
 * the YAML and nobody ever compared them to a block.
 */
describe("the draft actually scales what it offers", () => {
  const SRC = readFileSync(resolve(__dirname, "../hooks/useGameSession.ts"), "utf8");

  it("routes the drawn offers through the scaler", () => {
    expect(SRC).toMatch(/setDoorOffers\(scaleOffersForBlock\(/);
    expect(SRC, "the raw pool must not go straight out").not.toMatch(/setDoorOffers\(drawn\)/);
  });

  it("sizes against the block that follows the completed level", () => {
    expect(SRC).toMatch(/scaleOffersForBlock\(drawn, levels, currentLevelIndex \+ 1\)/);
  });
});
