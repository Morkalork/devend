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
import { insertRun, monthKey, RunRankInfo } from '@/lib/runLedger';
import { previousDayKey } from '@/lib/runRng';

function loadHall(): HallOfFameState {
  try {
    const raw = localStorage.getItem(HALL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_HALL_STATE };
    const parsed = JSON.parse(raw);
    const monthlyBests: Record<string, RunLedgerEntry> = {};
    if (parsed?.monthlyBests && typeof parsed.monthlyBests === 'object') {
      for (const [month, run] of Object.entries(parsed.monthlyBests)) {
        const r = run as RunLedgerEntry;
        if (typeof r?.score === 'number' && r.score > 0) monthlyBests[month] = r;
      }
    }
    const dailyBests: Record<string, RunLedgerEntry> = {};
    if (parsed?.dailyBests && typeof parsed.dailyBests === 'object') {
      for (const [day, run] of Object.entries(parsed.dailyBests)) {
        const r = run as RunLedgerEntry;
        if (typeof r?.score === 'number' && r.score > 0) dailyBests[day] = r;
      }
    }
    const dailyStreak =
      typeof parsed?.dailyStreak?.count === 'number' && typeof parsed?.dailyStreak?.lastKey === 'string'
        ? { count: Math.max(0, Math.floor(parsed.dailyStreak.count)), lastKey: parsed.dailyStreak.lastKey }
        : { ...DEFAULT_HALL_STATE.dailyStreak };
    return {
      topRuns: Array.isArray(parsed?.topRuns)
        ? parsed.topRuns.filter((r: RunLedgerEntry) => typeof r?.score === 'number' && r.score > 0)
        : [],
      bestRunTrajectory: Array.isArray(parsed?.bestRunTrajectory)
        ? parsed.bestRunTrajectory.filter((n: unknown) => typeof n === 'number' && Number.isFinite(n))
        : [],
      monthlyBests,
      dailyBests,
      dailyStreak,
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
   * `monthBest` = the run took (or founded) this calendar month's crown.
   * `dailyKey` marks a Daily Stand-up run: it additionally files on that day's
   * ledger (`dayBest`) and advances the attendance streak (`dailyStreak`).
   */
  const recordRun = useCallback((
    entry: RunLedgerEntry,
    trajectory: number[],
    dailyKey?: string | null,
  ): RunRankInfo & { monthBest: boolean; dayBest: boolean; dailyStreak: number } => {
    const prev = hallRef.current;
    const result = insertRun(prev.topRuns, entry);

    // Employee of the Month: one best run per calendar month.
    const month = monthKey(entry.savedAt);
    const monthBest = entry.score > (prev.monthlyBests[month]?.score ?? 0);
    const monthlyBests = monthBest
      ? { ...prev.monthlyBests, [month]: entry }
      : prev.monthlyBests;

    // Daily Stand-up: best-of-day ledger + attendance streak. Same-day repeats
    // keep the streak; a gap resets it to 1 (today counts as attended).
    let dayBest = false;
    let dailyBests = prev.dailyBests;
    let dailyStreak = prev.dailyStreak;
    if (dailyKey) {
      dayBest = entry.score > (prev.dailyBests[dailyKey]?.score ?? 0);
      if (dayBest) dailyBests = { ...prev.dailyBests, [dailyKey]: entry };
      if (prev.dailyStreak.lastKey !== dailyKey) {
        dailyStreak = {
          count: prev.dailyStreak.lastKey === previousDayKey(dailyKey) ? prev.dailyStreak.count + 1 : 1,
          lastKey: dailyKey,
        };
      }
    }

    const next: HallOfFameState = {
      topRuns: result.topRuns,
      // Record Pace races the reigning #1: only a new best replaces the ghost.
      bestRunTrajectory: result.info.rank === 1 ? [...trajectory] : prev.bestRunTrajectory,
      monthlyBests,
      dailyBests,
      dailyStreak,
    };
    hallRef.current = next;
    setHall(next);
    saveHall(next);
    // dailyStreak is only meaningful for daily runs (0 keeps the result
    // screen's streak line hidden on normal runs).
    return { ...result.info, monthBest, dayBest, dailyStreak: dailyKey ? dailyStreak.count : 0 };
  }, []);

  return {
    topRuns: hall.topRuns,
    bestRunTrajectory: hall.bestRunTrajectory,
    monthlyBests: hall.monthlyBests,
    dailyBests: hall.dailyBests,
    dailyStreak: hall.dailyStreak,
    /** The all-time #1 score, or null before any run has banked. */
    bestScore: hall.topRuns[0]?.score ?? null,
    recordRun,
  };
}
