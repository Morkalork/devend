/**
 * Run-ledger helpers (HIGHSCORES.md Phase A). Pure functions shared by the
 * persistence hook (useHallOfFame) and the run session (useGameSession), so the
 * "where did this run rank, and how far was the miss" logic lives in one
 * tested place — same pattern as highscore.ts for map records.
 */
import { RunLedgerEntry, MAX_TOP_RUNS } from '@/types/hallOfFame';

export interface RunRankInfo {
  /** 1-based position on the ladder, or null when the run missed it. */
  rank: number | null;
  /** Hours short of the run one rank up (null at #1 or when unranked). */
  gapToNext: number | null;
  /** Hours short of the last ladder spot (null when the run ranked). */
  gapToTop10: number | null;
}

/**
 * Insert a finished run into the ladder (highest score first, ties keep the
 * earlier run ahead). Returns the updated ladder plus where the run landed and
 * the near-miss gaps. The input array is not mutated.
 */
export function insertRun(
  topRuns: RunLedgerEntry[],
  entry: RunLedgerEntry,
  max: number = MAX_TOP_RUNS,
): { topRuns: RunLedgerEntry[]; info: RunRankInfo } {
  // First index the new run beats outright; equal scores keep seniority.
  let index = topRuns.findIndex(r => entry.score > r.score);
  if (index === -1) index = topRuns.length;

  if (index >= max) {
    // Missed the ladder: report the distance to the last spot.
    const lastScore = topRuns[max - 1]?.score ?? 0;
    return {
      topRuns,
      info: { rank: null, gapToNext: null, gapToTop10: Math.max(1, lastScore - entry.score) },
    };
  }

  const updated = [...topRuns.slice(0, index), entry, ...topRuns.slice(index)].slice(0, max);
  const rank = index + 1;
  return {
    topRuns: updated,
    info: {
      rank,
      gapToNext: rank > 1 ? Math.max(1, topRuns[index - 1].score - entry.score) : null,
      gapToTop10: null,
    },
  };
}

/**
 * Record Pace: the current run's cumulative overtime after `mapsCompleted`
 * maps, minus the best run at the same point. Beyond the best run's length the
 * comparison target is its final score (bonus territory: positive = new PB
 * ground). null when there is no best run to race, or nothing completed yet.
 */
export function paceDelta(
  cumulativeScore: number,
  mapsCompleted: number,
  bestTrajectory: number[],
  bestScore: number | null,
): number | null {
  if (bestScore === null || mapsCompleted <= 0) return null;
  const target = mapsCompleted <= bestTrajectory.length
    ? bestTrajectory[mapsCompleted - 1]
    : bestScore;
  return cumulativeScore - target;
}

/**
 * The near-miss epitaph: how deep this run stayed ahead of the best run's
 * trajectory before ultimately finishing below it. Returns the 1-based map
 * count it was last ahead at, or null when it never led, there is no best run,
 * or the run actually beat the record (no epitaph on a victory lap).
 */
export function aheadThroughMaps(
  trajectory: number[],
  bestTrajectory: number[],
  finalScore: number,
  bestScore: number | null,
): number | null {
  if (bestScore === null || finalScore >= bestScore) return null;
  let ahead: number | null = null;
  const shared = Math.min(trajectory.length, bestTrajectory.length);
  for (let i = 0; i < shared; i++) {
    if (trajectory[i] > bestTrajectory[i]) ahead = i + 1;
  }
  return ahead;
}
