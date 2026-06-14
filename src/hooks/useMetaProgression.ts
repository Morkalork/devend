/**
 * useMetaProgression — lifetime player stats (fences drawn, highest level,
 * lives lost, …) persisted in localStorage across runs.
 *
 * Stats feed achievement requirements and the unlock conditions of locked
 * 'super' upgrades. See src/types/metaProgression.ts for the stat list.
 */
import { useState, useCallback, useEffect } from 'react';
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
    return {
      highestLevelReached: parsed.highestLevelReached ?? 0,
      totalFencesDrawn: parsed.totalFencesDrawn ?? 0,
      totalLevelsCompletedWithoutLoss: parsed.totalLevelsCompletedWithoutLoss ?? 0,
      totalLivesLost: parsed.totalLivesLost ?? 0,
      deepestAscension: parsed.deepestAscension ?? 0,
      pushBonusesBanked: parsed.pushBonusesBanked ?? 0,
    };
  } catch {
    return { ...DEFAULT_META_STATS };
  }
}

/**
 * Save meta stats to localStorage
 */
function saveMetaStats(stats: MetaProgressionStats): void {
  localStorage.setItem(META_STATS_STORAGE_KEY, JSON.stringify(stats));
}

/**
 * Load unlock state from localStorage
 */
function loadUnlockState(): UnlockState {
  try {
    const stored = localStorage.getItem(UNLOCK_STATE_STORAGE_KEY);
    if (!stored) return { unlockedIds: [] };
    
    const parsed = JSON.parse(stored);
    return {
      unlockedIds: Array.isArray(parsed.unlockedIds) ? parsed.unlockedIds : [],
    };
  } catch {
    return { unlockedIds: [] };
  }
}

/**
 * Save unlock state to localStorage
 */
function saveUnlockState(state: UnlockState): void {
  localStorage.setItem(UNLOCK_STATE_STORAGE_KEY, JSON.stringify(state));
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
  const [isLoaded, setIsLoaded] = useState(false);

  // Load on mount
  useEffect(() => {
    const loadedStats = loadMetaStats();
    const loadedUnlocks = loadUnlockState();
    setStats(loadedStats);
    setUnlockedIds(loadedUnlocks.unlockedIds);
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
   * Reset all progression (for debugging)
   */
  const resetProgression = useCallback(() => {
    setStats({ ...DEFAULT_META_STATS });
    setUnlockedIds([]);
    saveMetaStats({ ...DEFAULT_META_STATS });
    saveUnlockState({ unlockedIds: [] });
  }, []);

  return {
    stats,
    isLoaded,
    updateStats,
    recordLevelReached,
    recordFencesDrawn,
    recordPerfectLevel,
    recordLivesLost,
    recordAscensionDepth,
    recordPushBonusBanked,
    resetProgression,
  };
}
