/**
 * mapObjectives — per-map optional objectives (issue #55).
 *
 * A module-level catalogue loaded from public/objectives.yml (mirrors
 * doorDraft.ts / mapMutators.ts), a deterministic 0-or-1 per-map selector, and
 * a PURE evaluator over a snapshot of existing per-map counters. Graceful
 * fallback: a missing/broken file leaves an empty pool, so maps play without an
 * objective.
 *
 * The reward folds under the per-map cap via applyCut's `extraBonus` (issue
 * #43); the objective is optional and non-failing (primary clear unchanged).
 */
import { MapObjective, ActiveMapObjective, ObjectiveSnapshot, ObjectiveProgress } from "@/types/objective";
import { fetchYamlCatalogue } from "@/lib/yamlCatalogue";
import { PROCEDURAL_MIN_LEVEL } from "@/lib/mapSlots";
import { eligibleByLevel, weightedPick, finiteOrUndefined } from "@/lib/mapPools";
import type { Rng } from "@/lib/runRng";

const VALID_KINDS = new Set(["lockCount", "superiorLocks", "underPar", "speedClear", "defeatBoss"]);

let liveObjectives: MapObjective[] = [];
/** Odds weight of "no objective this map" (objectives are a spice, not every map). */
let liveNoneWeight = 3;

export function getMapObjectives(): MapObjective[] {
  return liveObjectives;
}
export function getObjectiveNoneWeight(): number {
  return liveNoneWeight;
}

/** Coerce one raw YAML entry into a MapObjective, or null if unusable. */
function parseObjectiveEntry(raw: unknown): MapObjective | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.description !== "string") return null;
  if (typeof r.kind !== "string" || !VALID_KINDS.has(r.kind)) return null;
  const reward = Number(r.reward);
  if (!Number.isFinite(reward)) return null;
  const params: Record<string, number> = {};
  if (r.params && typeof r.params === "object") {
    for (const [k, v] of Object.entries(r.params as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) params[k] = n;
    }
  }
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    clarify: typeof r.clarify === "string" ? r.clarify : undefined,
    kind: r.kind as MapObjective["kind"],
    minLevel: finiteOrUndefined(r.minLevel),
    maxLevel: finiteOrUndefined(r.maxLevel),
    weight: finiteOrUndefined(r.weight),
    params,
    reward: Math.max(0, reward),
  };
}

/**
 * Load the objective pool from public/objectives.yml. Returns true on success;
 * failure keeps the previous pool (initially empty) so a broken file never gates
 * play.
 */
export async function loadMapObjectives(): Promise<boolean> {
  try {
    const { entries, doc } = await fetchYamlCatalogue("/objectives.yml", "objectives", parseObjectiveEntry);
    liveObjectives = entries;
    const none = Number(doc.noneWeight);
    liveNoneWeight = Number.isFinite(none) && none >= 0 ? none : 3;
    return true;
  } catch (err) {
    console.warn("[mapObjectives] pool unavailable, playing without objectives:", err);
    return false;
  }
}

/** Objectives eligible at this level number (range gate + procedural band). */
export function eligibleObjectives(levelNumber: number, pool: MapObjective[] = liveObjectives): MapObjective[] {
  return eligibleByLevel(levelNumber, pool, PROCEDURAL_MIN_LEVEL);
}

/**
 * Pick 0 or 1 objective for a map, deterministically from `rng`. A synthetic
 * "none" bucket of weight `noneWeight` leaves most maps objective-free. Returns
 * null below the procedural band or when nothing is eligible / none is drawn.
 */
export function selectMapObjective(
  levelNumber: number,
  rng: Rng,
  pool: MapObjective[] = liveObjectives,
  noneWeight: number = liveNoneWeight,
): ActiveMapObjective | null {
  return weightedPick(eligibleObjectives(levelNumber, pool), noneWeight, rng);
}

// ── Pure evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate an objective against a snapshot of live counters. `met` is provisional
 * for cut/time objectives (they can flip as the map plays) and final at clear,
 * where applyCut re-evaluates to award the reward.
 */
export function evaluateObjective(obj: ActiveMapObjective, snap: ObjectiveSnapshot): ObjectiveProgress {
  switch (obj.kind) {
    case "lockCount": {
      const target = Math.max(1, Math.round(obj.params?.count ?? 1));
      return { kind: obj.kind, mode: "accumulate", current: snap.lockedBalls, target, met: snap.lockedBalls >= target };
    }
    case "superiorLocks": {
      const target = Math.max(1, Math.round(obj.params?.count ?? 1));
      return { kind: obj.kind, mode: "accumulate", current: snap.superiorLocks, target, met: snap.superiorLocks >= target };
    }
    case "underPar": {
      const target = Math.max(1, snap.par + Math.round(obj.params?.delta ?? 0));
      return { kind: obj.kind, mode: "limit", current: snap.cuts, target, met: snap.cuts <= target };
    }
    case "speedClear": {
      const target = Math.max(1, Math.round(obj.params?.seconds ?? 30));
      return { kind: obj.kind, mode: "limit", current: Math.floor(snap.activeSeconds), target, met: snap.activeSeconds <= target };
    }
    case "defeatBoss": {
      const done = !!snap.bossDefeated;
      return { kind: obj.kind, mode: "accumulate", current: done ? 1 : 0, target: 1, met: done };
    }
    default:
      // Unreachable for pool objectives (parse validates kind); guards an
      // authored boss objective (#56) with a bad kind against a crash, treating
      // it as not-yet-met (a loud, obvious failure) rather than silently passing.
      return { kind: obj.kind, mode: "accumulate", current: 0, target: 1, met: false };
  }
}

/**
 * Overtime hours to award on clear for an objective: its `reward` when met,
 * else 0. Folded UNDER the per-map cap by the caller (applyCut extraBonus).
 */
export function objectiveClearReward(obj: ActiveMapObjective | null, snap: ObjectiveSnapshot): number {
  if (!obj) return 0;
  const reward = Number.isFinite(obj.reward) && obj.reward > 0 ? obj.reward : 0;
  return evaluateObjective(obj, snap).met ? reward : 0;
}
