/**
 * useHallOfFame — the all-time run ledger (HIGHSCORES.md Phase A).
 *
 * Persists the Top 10 runs plus the #1 run's per-map score trajectory
 * (localStorage HALL_STORAGE_KEY). recordRun() files a finished run and
 * reports its rank / near-miss gaps for the result screen; the trajectory only
 * updates when the run takes the #1 spot, so Record Pace always races the
 * reigning best.
 */
import { useCallback, useRef, useState } from 'react';
import {
  HallOfFameState,
  RunLedgerEntry,
  HALL_STORAGE_KEY,
  DEFAULT_HALL_STATE,
} from '@/types/hallOfFame';
import { insertRun, RunRankInfo } from '@/lib/runLedger';

function loadHall(): HallOfFameState {
  try {
    const raw = localStorage.getItem(HALL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_HALL_STATE };
    const parsed = JSON.parse(raw);
    return {
      topRuns: Array.isArray(parsed?.topRuns)
        ? parsed.topRuns.filter((r: RunLedgerEntry) => typeof r?.score === 'number' && r.score > 0)
        : [],
      bestRunTrajectory: Array.isArray(parsed?.bestRunTrajectory)
        ? parsed.bestRunTrajectory.filter((n: unknown) => typeof n === 'number' && Number.isFinite(n))
        : [],
    };
  } catch {
    return { ...DEFAULT_HALL_STATE };
  }
}

function saveHall(state: HallOfFameState): void {
  try {
    localStorage.setItem(HALL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors (quota / private mode)
  }
}

export function useHallOfFame() {
  const [hall, setHall] = useState<HallOfFameState>(() => loadHall());
  // Ref mirror so recordRun can read-modify-write synchronously (its rank
  // return feeds the result screen in the same tick) without stale closures.
  const hallRef = useRef(hall);

  /**
   * File a finished run. Returns its rank/gap info synchronously (before React
   * re-renders) so the caller can hand it straight to the result screen.
   */
  const recordRun = useCallback((entry: RunLedgerEntry, trajectory: number[]): RunRankInfo => {
    const prev = hallRef.current;
    const result = insertRun(prev.topRuns, entry);
    const next: HallOfFameState = {
      topRuns: result.topRuns,
      // Record Pace races the reigning #1: only a new best replaces the ghost.
      bestRunTrajectory: result.info.rank === 1 ? [...trajectory] : prev.bestRunTrajectory,
    };
    hallRef.current = next;
    setHall(next);
    saveHall(next);
    return result.info;
  }, []);

  return {
    topRuns: hall.topRuns,
    bestRunTrajectory: hall.bestRunTrajectory,
    /** The all-time #1 score, or null before any run has banked. */
    bestScore: hall.topRuns[0]?.score ?? null,
    recordRun,
  };
}
