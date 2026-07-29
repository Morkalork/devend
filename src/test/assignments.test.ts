import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { drawDoorOffers, isAssignmentLevel, ASSIGNMENT_OFFER_COUNT } from "@/lib/doorDraft";
import {
  evaluateAssignment,
  assignmentRewardForBlock,
  conditionMetForMap,
  assignmentMetric,
  eligibleTierUpgrades,
} from "@/lib/assignments";
import { computeGameModifiers } from "@/hooks/useActiveModifiers";
import type { AssignmentConfig, AssignmentData, AssignmentMapResult } from "@/types/assignment";
import type { UpgradeConfig } from "@/types/upgrade";

// ── YAML pool integrity (assignments.yml is the source of truth) ─────────────
const doc = yaml.load(
  readFileSync(resolve(process.cwd(), "public/assignments.yml"), "utf8"),
) as AssignmentData;
const assignments = doc.assignments;
const VALID_KEYS = new Set(Object.keys(computeGameModifiers([], new Map())));
const VALID_KINDS = new Set(["lockCount", "superiorLocks", "underPar", "speedClear", "allBallsLocked"]);

describe("assignment pool integrity", () => {
  it("has at least enough assignments for a full roll", () => {
    expect(assignments.length).toBeGreaterThanOrEqual(ASSIGNMENT_OFFER_COUNT);
  });

  it("has unique ids", () => {
    const ids = assignments.map(a => a.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("gives every assignment a name, mission text, a valid condition kind and clarify", () => {
    const offenders = assignments.filter(a =>
      !a.name || !a.mission?.text || !a.clarify ||
      !a.mission?.track || !VALID_KINDS.has(a.mission.track.kind),
    ).map(a => a.id);
    expect(offenders).toEqual([]);
  });

  it("gives every mission ascending tiers, each with a label and reward", () => {
    const offenders: string[] = [];
    for (const a of assignments) {
      const tiers = a.mission.tiers ?? [];
      if (tiers.length === 0) { offenders.push(`${a.id}: no tiers`); continue; }
      for (let i = 1; i < tiers.length; i++) {
        if (tiers[i].threshold <= tiers[i - 1].threshold) offenders.push(`${a.id}: tiers not ascending`);
      }
      for (const t of tiers) {
        if (!t.label || !t.reward?.type) offenders.push(`${a.id}: bad tier`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses only known GameModifiers keys in constraints and modifier rewards", () => {
    const offenders: string[] = [];
    for (const a of assignments) {
      for (const key of Object.keys(a.constraint?.modifiers ?? {})) {
        if (!VALID_KEYS.has(key)) offenders.push(`${a.id} constraint -> ${key}`);
      }
      for (const t of a.mission.tiers) {
        if (t.reward.type === "modifiers") {
          for (const key of Object.keys(t.reward.modifiers)) {
            if (!VALID_KEYS.has(key)) offenders.push(`${a.id} reward -> ${key}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only offers the tier-draft reward on constrained (tough) assignments", () => {
    const offenders = assignments
      .filter(a => a.mission.tiers.some(t => t.reward.type === "tierDraft") && !a.constraint)
      .map(a => a.id);
    expect(offenders).toEqual([]);
  });

  it("has a real assignment cadence (offeredAfterLevel)", () => {
    expect(doc.offeredAfterLevel).toBeGreaterThanOrEqual(1);
  });
});

// ── Draw + cadence ───────────────────────────────────────────────────────────
function mkAssignment(id: string): AssignmentConfig {
  return {
    id, name: id,
    mission: {
      text: "task",
      track: { mode: "cumulative", kind: "lockCount" },
      tiers: [{ threshold: 5, label: "+1 life", reward: { type: "lives", count: 1 } }],
    },
  };
}

describe("drawDoorOffers", () => {
  const pool = ["a", "b", "c", "d"].map(mkAssignment);
  it("draws n distinct assignments", () => {
    for (let i = 0; i < 20; i++) {
      const drawn = drawDoorOffers(pool, ASSIGNMENT_OFFER_COUNT);
      expect(drawn).toHaveLength(ASSIGNMENT_OFFER_COUNT);
      expect(new Set(drawn.map(d => d.id)).size).toBe(ASSIGNMENT_OFFER_COUNT);
    }
  });
  it("clamps to the pool size and never mutates the pool", () => {
    const before = pool.map(d => d.id).join(",");
    expect(drawDoorOffers(pool, 10)).toHaveLength(4);
    expect(drawDoorOffers(pool, 0)).toHaveLength(0);
    expect(pool.map(d => d.id).join(",")).toBe(before);
  });
});

describe("isAssignmentLevel", () => {
  it("fires on every 5th completed level and nowhere else", () => {
    expect(isAssignmentLevel(0)).toBe(false);
    expect(isAssignmentLevel(4)).toBe(false);
    expect(isAssignmentLevel(5)).toBe(true);
    expect(isAssignmentLevel(6)).toBe(false);
    expect(isAssignmentLevel(10)).toBe(true);
  });
});

// ── Mission evaluation ───────────────────────────────────────────────────────
const mkMap = (o: Partial<AssignmentMapResult>): AssignmentMapResult => ({
  locks: 0, superiorLocks: 0, cutsDelta: 0, clearSeconds: 0, ballCount: 0, allBallsLocked: false, ...o,
});

describe("conditionMetForMap", () => {
  it("checks each per-map condition kind", () => {
    expect(conditionMetForMap("lockCount", { count: 2 }, mkMap({ locks: 2 }))).toBe(true);
    expect(conditionMetForMap("lockCount", { count: 2 }, mkMap({ locks: 1 }))).toBe(false);
    expect(conditionMetForMap("underPar", { delta: 0 }, mkMap({ cutsDelta: 0 }))).toBe(true);
    expect(conditionMetForMap("underPar", { delta: 0 }, mkMap({ cutsDelta: 1 }))).toBe(false);
    expect(conditionMetForMap("speedClear", { seconds: 40 }, mkMap({ clearSeconds: 39 }))).toBe(true);
    expect(conditionMetForMap("speedClear", { seconds: 40 }, mkMap({ clearSeconds: 41 }))).toBe(false);
    expect(conditionMetForMap("allBallsLocked", undefined, mkMap({ allBallsLocked: true }))).toBe(true);
  });
});

describe("evaluateAssignment", () => {
  const cumulative: AssignmentConfig = {
    id: "c", name: "c",
    mission: {
      text: "lock lots",
      track: { mode: "cumulative", kind: "lockCount" },
      tiers: [
        { threshold: 4, label: "t1", reward: { type: "overtime", hours: 10 } },
        { threshold: 8, label: "t2", reward: { type: "lives", count: 2 } },
      ],
    },
  };

  it("sums a cumulative metric and marks reached tiers", () => {
    const results = [mkMap({ locks: 3 }), mkMap({ locks: 2 })]; // total 5
    const p = evaluateAssignment(cumulative, results);
    expect(p.current).toBe(5);
    expect(p.tiers[0].reached).toBe(true);
    expect(p.tiers[1].reached).toBe(false);
    expect(p.nextThreshold).toBe(8);
    expect(p.highestReachedIndex).toBe(0);
  });

  const everyMap: AssignmentConfig = {
    id: "e", name: "e",
    mission: {
      text: "lock 2 each",
      track: { mode: "everyMap", kind: "lockCount", params: { count: 2 } },
      tiers: [
        { threshold: 2, label: "t1", reward: { type: "lives", count: 1 } },
        { threshold: 3, label: "t2", reward: { type: "lives", count: 2 } },
      ],
    },
  };

  it("counts maps that passed the per-map condition (everyMap)", () => {
    const results = [mkMap({ locks: 2 }), mkMap({ locks: 1 }), mkMap({ locks: 3 })]; // 2 pass
    const p = evaluateAssignment(everyMap, results);
    expect(p.current).toBe(2);
    expect(p.tiers[0].reached).toBe(true);
    expect(p.tiers[1].reached).toBe(false);
  });

  it("picks the highest reached tier's reward at block end", () => {
    const results = [mkMap({ locks: 5 }), mkMap({ locks: 5 })]; // total 10 >= 8
    const r = assignmentRewardForBlock(cumulative, results);
    expect(r?.tierIndex).toBe(1);
    expect(r?.reward).toEqual({ type: "lives", count: 2 });
  });

  it("returns null when the mission fell short of tier 1", () => {
    expect(assignmentRewardForBlock(cumulative, [mkMap({ locks: 1 })])).toBeNull();
  });

  it("metric helper counts qualifying maps for pass/fail cumulative kinds", () => {
    const track = { mode: "cumulative", kind: "allBallsLocked" } as const;
    const results = [mkMap({ allBallsLocked: true }), mkMap({ allBallsLocked: false }), mkMap({ allBallsLocked: true })];
    expect(assignmentMetric(track, results)).toBe(2);
  });
});

describe("eligibleTierUpgrades", () => {
  const upgrades = [
    { id: "a1", tier: "Senior" },
    { id: "a2", tier: "Senior", choiceGroup: "g" },
    { id: "a3", tier: "Senior", choiceGroup: "g" },
    { id: "b1", tier: "Principal" },
  ] as unknown as UpgradeConfig[];

  it("excludes owned upgrades and choice-group siblings of owned picks", () => {
    const eligible = eligibleTierUpgrades(upgrades, "Senior" as UpgradeConfig["tier"], ["a2"]);
    // a2 owned -> excluded; a3 shares group g with a2 -> excluded; a1 remains.
    expect(eligible.map(u => u.id)).toEqual(["a1"]);
  });
});
