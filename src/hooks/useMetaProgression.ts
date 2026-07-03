/**
 * useMetaProgression — lifetime player stats (fences drawn, highest level,
 * lives lost, …) persisted in localStorage across runs.
 *
 * Stats feed achievement requirements and the unlock conditions of locked
 * 'super' upgrades. See src/types/metaProgression.ts for the stat list.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  MetaProgressionStats,
  UnlockState,
  UnlockCondition,
  DEFAULT_META_STATS,
  META_STATS_STORAGE_KEY,
  UNLOCK_STATE_STORAGE_KEY,
} from '@/types/metaProgression';

/**
 * Load meta stats from localStorage
 */
function loadMetaStats(): MetaProgressionStats {
  try {
    const stored = localStorage.getItem(META_STATS_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_META_STATS };
    
    const parsed = JSON.parse(stored);
    // Spread defaults first so any stat key added later defaults to its
    // default instead of becoming undefined; coerce each to a finite number.
    const merged: MetaProgressionStats = { ...DEFAULT_META_STATS };
    for (const key of Object.keys(merged) as (keyof MetaProgressionStats)[]) {
      const v = parsed[key];
      if (typeof v === 'number' && Number.isFinite(v)) merged[key] = v;
    }
    return merged;
  } catch {
    return { ...DEFAULT_META_STATS };
  }
}

/**
 * Save meta stats to localStorage
 */
function saveMetaStats(stats: MetaProgressionStats): void {
  try {
    localStorage.setItem(META_STATS_STORAGE_KEY, JSON.stringify(stats));
  } catch (e) {
    console.warn('Failed to persist meta stats', e);
  }
}

/**
 * Load unlock state from localStorage
 */
function loadUnlockState(): UnlockState {
  try {
    const stored = localStorage.getItem(UNLOCK_STATE_STORAGE_KEY);
    if (!stored) return { unlockedIds: [], wonLoadoutIds: [], loadoutsIntroduced: false };

    const parsed = JSON.parse(stored);
    return {
      unlockedIds: Array.isArray(parsed.unlockedIds) ? parsed.unlockedIds : [],
      wonLoadoutIds: Array.isArray(parsed.wonLoadoutIds) ? parsed.wonLoadoutIds : [],
      loadoutsIntroduced: parsed.loadoutsIntroduced === true,
    };
  } catch {
    return { unlockedIds: [], wonLoadoutIds: [], loadoutsIntroduced: false };
  }
}

/**
 * Save unlock state to localStorage
 */
function saveUnlockState(state: UnlockState): void {
  try {
    localStorage.setItem(UNLOCK_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to persist unlock state', e);
  }
}

/**
 * Check if a condition is met based on current stats
 */
function isConditionMet(condition: UnlockCondition, stats: MetaProgressionStats): boolean {
  const currentValue = stats[condition.type];
  return currentValue >= condition.threshold;
}

/**
 * Get current progress for a condition
 */
function getConditionProgress(condition: UnlockCondition, stats: MetaProgressionStats): number {
  return stats[condition.type];
}

export function useMetaProgression() {
  const [stats, setStats] = useState<MetaProgressionStats>(DEFAULT_META_STATS);
  const [unlockedIds, setUnlockedIds] = useState<string[]>([]);
  const [wonLoadoutIds, setWonLoadoutIds] = useState<string[]>([]);
  const [loadoutsIntroduced, setLoadoutsIntroduced] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Refs mirror the persisted unlock state so recordLoadoutWin /
  // introduceLoadouts can read/write it synchronously without stale state.
  const unlockedIdsRef = useRef<string[]>([]);
  const wonLoadoutIdsRef = useRef<string[]>([]);
  const loadoutsIntroducedRef = useRef(false);

  // Load on mount
  useEffect(() => {
    const loadedStats = loadMetaStats();
    const loadedUnlocks = loadUnlockState();
    setStats(loadedStats);
    setUnlockedIds(loadedUnlocks.unlockedIds);
    setWonLoadoutIds(loadedUnlocks.wonLoadoutIds);
    setLoadoutsIntroduced(loadedUnlocks.loadoutsIntroduced);
    unlockedIdsRef.current = loadedUnlocks.unlockedIds;
    wonLoadoutIdsRef.current = loadedUnlocks.wonLoadoutIds;
    loadoutsIntroducedRef.current = loadedUnlocks.loadoutsIntroduced;
    setIsLoaded(true);
  }, []);

  /**
   * Update stats and persist
   */
  const updateStats = useCallback((updates: Partial<MetaProgressionStats>) => {
    setStats(prev => {
      const newStats = { ...prev };
      
      // For highestLevelReached, only update if new value is higher
      if (updates.highestLevelReached !== undefined) {
        newStats.highestLevelReached = Math.max(prev.highestLevelReached, updates.highestLevelReached);
      }
      
      // For cumulative stats, add to existing values
      if (updates.totalFencesDrawn !== undefined) {
        newStats.totalFencesDrawn = prev.totalFencesDrawn + updates.totalFencesDrawn;
      }
      if (updates.totalLevelsCompletedWithoutLoss !== undefined) {
        newStats.totalLevelsCompletedWithoutLoss = prev.totalLevelsCompletedWithoutLoss + updates.totalLevelsCompletedWithoutLoss;
      }
      if (updates.totalLivesLost !== undefined) {
        newStats.totalLivesLost = prev.totalLivesLost + updates.totalLivesLost;
      }

      // Like highestLevelReached, deepestAscension only ever increases
      if (updates.deepestAscension !== undefined) {
        newStats.deepestAscension = Math.max(prev.deepestAscension, updates.deepestAscension);
      }

      if (updates.pushBonusesBanked !== undefined) {
        newStats.pushBonusesBanked = prev.pushBonusesBanked + updates.pushBonusesBanked;
      }

      saveMetaStats(newStats);
      return newStats;
    });
  }, []);

  /**
   * Record reaching a level
   */
  const recordLevelReached = useCallback((level: number) => {
    updateStats({ highestLevelReached: level });
  }, [updateStats]);

  /**
   * Record fences drawn in a level
   */
  const recordFencesDrawn = useCallback((count: number) => {
    updateStats({ totalFencesDrawn: count });
  }, [updateStats]);

  /**
   * Record completing a level without losing a life
   */
  const recordPerfectLevel = useCallback(() => {
    updateStats({ totalLevelsCompletedWithoutLoss: 1 });
  }, [updateStats]);

  /**
   * Record lives lost
   */
  const recordLivesLost = useCallback((count: number) => {
    updateStats({ totalLivesLost: count });
  }, [updateStats]);

  /**
   * Record reaching an ascension depth (Ascension mode)
   */
  const recordAscensionDepth = useCallback((depth: number) => {
    updateStats({ deepestAscension: depth });
  }, [updateStats]);

  /**
   * Record successfully banking a push-your-luck bonus
   */
  const recordPushBonusBanked = useCallback(() => {
    updateStats({ pushBonusesBanked: 1 });
  }, [updateStats]);

  /**
   * Record a win with a run-start loadout. Adds the id to the unique-win set
   * only if new, persists, and returns the win-count transition so callers can
   * compute which loadouts just unlocked. Idempotent for a repeat loadout.
   */
  const recordLoadoutWin = useCallback((loadoutId: string): { added: boolean; prevCount: number; newCount: number } => {
    const prev = wonLoadoutIdsRef.current;
    const prevCount = prev.length;
    if (prev.includes(loadoutId)) {
      return { added: false, prevCount, newCount: prevCount };
    }
    const next = [...prev, loadoutId];
    wonLoadoutIdsRef.current = next;
    setWonLoadoutIds(next);
    saveUnlockState({ unlockedIds: unlockedIdsRef.current, wonLoadoutIds: next, loadoutsIntroduced: loadoutsIntroducedRef.current });
    return { added: true, prevCount, newCount: next.length };
  }, []);

  /**
   * Reveal the loadout system (called on the first win). Returns true only the
   * first time, so the caller can show a one-time "loadouts unlocked" modal.
   */
  const introduceLoadouts = useCallback((): boolean => {
    if (loadoutsIntroducedRef.current) return false;
    loadoutsIntroducedRef.current = true;
    setLoadoutsIntroduced(true);
    saveUnlockState({ unlockedIds: unlockedIdsRef.current, wonLoadoutIds: wonLoadoutIdsRef.current, loadoutsIntroduced: true });
    return true;
  }, []);

  /**
   * Reset all progression (for debugging)
   */
  const resetProgression = useCallback(() => {
    setStats({ ...DEFAULT_META_STATS });
    setUnlockedIds([]);
    setWonLoadoutIds([]);
    setLoadoutsIntroduced(false);
    unlockedIdsRef.current = [];
    wonLoadoutIdsRef.current = [];
    loadoutsIntroducedRef.current = false;
    saveMetaStats({ ...DEFAULT_META_STATS });
    saveUnlockState({ unlockedIds: [], wonLoadoutIds: [], loadoutsIntroduced: false });
  }, []);

  return {
    stats,
    isLoaded,
    wonLoadoutIds,
    loadoutsIntroduced,
    updateStats,
    recordLevelReached,
    recordFencesDrawn,
    recordPerfectLevel,
    recordLivesLost,
    recordAscensionDepth,
    recordPushBonusBanked,
    recordLoadoutWin,
    introduceLoadouts,
    resetProgression,
  };
}
