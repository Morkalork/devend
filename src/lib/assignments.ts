/**
 * assignments — pure evaluation of a multi-map assignment MISSION (issue #60).
 *
 * A mission tracks a per-map condition across the 5-map block in one of two ways:
 * - `cumulative`: a running metric summed over the block (total locks, or the
 *   number of maps that met a per-map condition) compared against ascending tier
 *   thresholds. A single-tier cumulative mission is a simple "hit N total" task.
 * - `everyMap`: the count of maps whose per-map condition was met, compared
 *   against tier thresholds expressed as maps-passed.
 *
 * Everything here is a pure read over captured per-map results (AssignmentMapResult),
 * so it drives both the live HUD (completed maps + the in-progress map) and the
 * block-end reward grant (completed maps only). No side effects.
 */
import type {
  AssignmentConfig,
  AssignmentConditionKind,
  AssignmentMapResult,
  AssignmentReward,
  AssignmentTrack,
} from '@/types/assignment';
import type { UpgradeConfig, UpgradeTier } from '@/types/upgrade';

/** Whether one finished (or live) map satisfied the per-map condition. */
export function conditionMetForMap(
  kind: AssignmentConditionKind,
  params: Record<string, number> | undefined,
  r: AssignmentMapResult,
  /** The named type, for a `ballType` bounty. Resolved per block at draft time. */
  ballType?: string,
): boolean {
  switch (kind) {
    case 'ballType': {
      // No type resolved means no bounty was ever set, and a mission that
      // passes on every map would pay the top tier for nothing.
      if (!ballType) return false;
      const sealed = r.lockedByType?.[ballType] ?? 0;
      return sealed >= Math.max(1, Math.round(params?.count ?? 1));
    }
    case 'lockCount':
      return r.locks >= Math.max(1, Math.round(params?.count ?? 1));
    case 'superiorLocks':
      return r.superiorLocks >= Math.max(1, Math.round(params?.count ?? 1));
    case 'underPar':
      return r.cutsDelta <= Math.round(params?.delta ?? 0);
    case 'speedClear':
      return r.clearSeconds <= Math.max(1, Math.round(params?.seconds ?? 30));
    case 'allBallsLocked':
      return r.allBallsLocked;
    case 'noLocks':
      // Every recorded result is a map that was WON - results are captured on
      // level complete - so "no locks" already means "cleared it clean".
      return r.locks === 0;
    case 'smashCount':
      return (r.smashes ?? 0) >= Math.max(1, Math.round(params?.count ?? 1));
    case 'noLivesLost':
      // Absent means the map predates the field, and an old result must not
      // silently pass a mission it was never measured against.
      return (r.livesLost ?? 0) === 0;
    case 'noSpend':
      return (r.spent ?? 0) === 0;
    case 'pushesWon':
      // Per-map form: did this map bank a push. The cumulative form sums these.
      return r.pushWon === true;
    default:
      return false;
  }
}

/** Whether a metric is a summed quantity (locks) vs a count of qualifying maps. */
function isSummedKind(kind: AssignmentConditionKind): boolean {
  return kind === 'lockCount' || kind === 'superiorLocks' || kind === 'smashCount';
  // pushesWon is deliberately NOT here: one map banks at most one push, so
  // counting qualifying maps and summing the metric are the same number, and
  // the generic path below already does it.
}

/**
 * The mission's current metric over the given results:
 * - cumulative + summed kind → total of the raw per-map counts.
 * - cumulative + other kinds → number of maps that met the condition.
 * - everyMap                 → number of maps that met the per-map condition.
 */
export function assignmentMetric(track: AssignmentTrack, results: AssignmentMapResult[]): number {
  if (track.mode === 'cumulative' && isSummedKind(track.kind)) {
    if (track.kind === 'smashCount') {
      return results.reduce((sum, r) => sum + (r.smashes ?? 0), 0);
    }
    const key = track.kind === 'lockCount' ? 'locks' : 'superiorLocks';
    return results.reduce((sum, r) => sum + r[key], 0);
  }
  // everyMap, or cumulative over a pass/fail condition: count qualifying maps.
  return results.reduce((n, r) => n + (conditionMetForMap(track.kind, track.params, r, track.ballType) ? 1 : 0), 0);
}

export interface AssignmentTierProgress {
  threshold: number;
  label: string;
  reward: AssignmentReward;
  reached: boolean;
}

export interface AssignmentProgress {
  mode: AssignmentTrack['mode'];
  /** Metric value over the results supplied. */
  current: number;
  /** Top tier threshold (for a progress bar). */
  target: number;
  /** Next unreached threshold, or null when the top tier is reached. */
  nextThreshold: number | null;
  tiers: AssignmentTierProgress[];
  /** Index of the highest reached tier, or -1 if none. */
  highestReachedIndex: number;
}

/** Tiers sorted ascending by threshold (defensive; authoring should already be sorted). */
function sortedTiers(a: AssignmentConfig) {
  return [...a.mission.tiers].sort((x, y) => x.threshold - y.threshold);
}

/**
 * Evaluate mission progress over `results`. Pass completed maps only for the
 * block-end grant; pass completed + the in-progress map for a live HUD readout.
 */
export function evaluateAssignment(a: AssignmentConfig, results: AssignmentMapResult[]): AssignmentProgress {
  const tiers = sortedTiers(a);
  const current = assignmentMetric(a.mission.track, results);
  const tierProgress: AssignmentTierProgress[] = tiers.map(t => ({
    threshold: t.threshold,
    label: t.label,
    reward: t.reward,
    reached: current >= t.threshold,
  }));
  let highestReachedIndex = -1;
  for (let i = 0; i < tierProgress.length; i++) if (tierProgress[i].reached) highestReachedIndex = i;
  const nextTier = tierProgress.find(t => !t.reached) ?? null;
  const target = tiers.length > 0 ? tiers[tiers.length - 1].threshold : 0;
  return {
    mode: a.mission.track.mode,
    current,
    target,
    nextThreshold: nextTier ? nextTier.threshold : null,
    tiers: tierProgress,
    highestReachedIndex,
  };
}

/**
 * Upgrades eligible for a tier-draft reward: of the given `tier`, not already
 * owned, and not locked out by an owned member of the same `choiceGroup`. The
 * caller draws up to 3 from this list for the 1-of-3 pick.
 */
export function eligibleTierUpgrades(
  upgrades: UpgradeConfig[],
  tier: UpgradeTier,
  ownedUpgradeIds: string[],
): UpgradeConfig[] {
  const owned = new Set(ownedUpgradeIds);
  const ownedGroups = new Set(
    upgrades.filter(u => owned.has(u.id) && u.choiceGroup).map(u => u.choiceGroup),
  );
  return upgrades.filter(u =>
    u.tier === tier && !owned.has(u.id) && !(u.choiceGroup && ownedGroups.has(u.choiceGroup)),
  );
}

/**
 * The reward for the highest tier reached at block end (completed maps only), or
 * null if the mission fell short of even the first tier.
 */
export function assignmentRewardForBlock(
  a: AssignmentConfig,
  completed: AssignmentMapResult[],
): { tierIndex: number; reward: AssignmentReward } | null {
  const progress = evaluateAssignment(a, completed);
  if (progress.highestReachedIndex < 0) return null;
  return { tierIndex: progress.highestReachedIndex, reward: progress.tiers[progress.highestReachedIndex].reward };
}
