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
import { seedLegacyFeatureUnlocks } from '@/lib/features';

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
    // Saves written before lastRunShopLevel existed still owe Tenure a reward
    // for the run they remember. Assume that run ended the common way, by
    // dying, so its last shop was one level back. Erring low costs at most the
    // single card that unlocks exactly at the depth reached, where erring high
    // would hand over an upgrade that run never had on sale.
    if (merged.lastRunDepth > 0 && typeof parsed.lastRunShopLevel !== 'number') {
      merged.lastRunShopLevel = Math.max(0, merged.lastRunDepth - 1);
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
function emptyUnlockState(): UnlockState {
  return {
    unlockedIds: [], metArchetypes: [], loadoutsIntroduced: false,
    encounteredBallTypeIds: [], unlockedFeatureIds: [],
    lastRunUpgradeIds: [],
  };
}

function loadUnlockState(): UnlockState {
  try {
    const stored = localStorage.getItem(UNLOCK_STATE_STORAGE_KEY);
    if (!stored) return emptyUnlockState();

    const parsed = JSON.parse(stored);
    // Migrate legacy unlock flags into the general feature list so players who
    // already earned a feature (e.g. loadouts, via the old first-win flag) keep
    // it under the new "Feature Unlocked" system.
    const featureIds = seedLegacyFeatureUnlocks(
      Array.isArray(parsed.unlockedFeatureIds) ? parsed.unlockedFeatureIds : [],
      parsed.loadoutsIntroduced === true,
    );
    return {
      unlockedIds: Array.isArray(parsed.unlockedIds) ? parsed.unlockedIds : [],
      metArchetypes: Array.isArray(parsed.metArchetypes) ? parsed.metArchetypes.filter((t: unknown) => typeof t === 'string') : [],
      loadoutsIntroduced: parsed.loadoutsIntroduced === true,
      encounteredBallTypeIds: Array.isArray(parsed.encounteredBallTypeIds) ? parsed.encounteredBallTypeIds : [],
      unlockedFeatureIds: featureIds,
      lastRunUpgradeIds: Array.isArray(parsed.lastRunUpgradeIds) ? parsed.lastRunUpgradeIds : [],
    };
  } catch {
    return emptyUnlockState();
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
  const [metArchetypes, setMetArchetypes] = useState<string[]>([]);
  const [loadoutsIntroduced, setLoadoutsIntroduced] = useState(false);
  const [encounteredBallTypeIds, setEncounteredBallTypeIds] = useState<string[]>([]);
  const [lastRunUpgradeIds, setLastRunUpgradeIds] = useState<string[]>([]);
  const [unlockedFeatureIds, setUnlockedFeatureIds] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Refs mirror the persisted unlock state so recordArchetypeMet /
  // introduceLoadouts / recordBallTypeEncountered can
  // read/write it synchronously without stale state.
  const unlockedIdsRef = useRef<string[]>([]);
  const metArchetypesRef = useRef<string[]>([]);
  const loadoutsIntroducedRef = useRef(false);
  const encounteredBallTypeIdsRef = useRef<string[]>([]);
  const lastRunUpgradeIdsRef = useRef<string[]>([]);
  const unlockedFeatureIdsRef = useRef<string[]>([]);

  // Persist the full unlock state from the refs (single source, so no save site
  // can forget a field).
  const persistUnlockState = useCallback(() => {
    saveUnlockState({
      unlockedIds: unlockedIdsRef.current,
      metArchetypes: metArchetypesRef.current,
      loadoutsIntroduced: loadoutsIntroducedRef.current,
      encounteredBallTypeIds: encounteredBallTypeIdsRef.current,
      unlockedFeatureIds: unlockedFeatureIdsRef.current,
      lastRunUpgradeIds: lastRunUpgradeIdsRef.current,
    });
  }, []);

  // Load on mount
  useEffect(() => {
    const loadedStats = loadMetaStats();
    const loadedUnlocks = loadUnlockState();
    setStats(loadedStats);
    setUnlockedIds(loadedUnlocks.unlockedIds);
    setMetArchetypes(loadedUnlocks.metArchetypes);
    setLoadoutsIntroduced(loadedUnlocks.loadoutsIntroduced);
    setEncounteredBallTypeIds(loadedUnlocks.encounteredBallTypeIds);
    setUnlockedFeatureIds(loadedUnlocks.unlockedFeatureIds);
    setLastRunUpgradeIds(loadedUnlocks.lastRunUpgradeIds);
    unlockedIdsRef.current = loadedUnlocks.unlockedIds;
    metArchetypesRef.current = loadedUnlocks.metArchetypes;
    loadoutsIntroducedRef.current = loadedUnlocks.loadoutsIntroduced;
    lastRunUpgradeIdsRef.current = loadedUnlocks.lastRunUpgradeIds;
    encounteredBallTypeIdsRef.current = loadedUnlocks.encounteredBallTypeIds;
    unlockedFeatureIdsRef.current = loadedUnlocks.unlockedFeatureIds;
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


      if (updates.pushBonusesBanked !== undefined) {
        newStats.pushBonusesBanked = prev.pushBonusesBanked + updates.pushBonusesBanked;
      }

      // REPLACED, not maxed or summed: the Tenure reward is meant to decay
      // when a run ends short, so these must be able to go down.
      if (updates.lastRunDepth !== undefined) {
        newStats.lastRunDepth = updates.lastRunDepth;
      }
      if (updates.lastRunShopLevel !== undefined) {
        newStats.lastRunShopLevel = updates.lastRunShopLevel;
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
   * Record how deep a run got, at the moment it ENDED (issue #75). Only called
   * from the single run-end path, so quitting to the menu leaves the previous
   * result standing instead of zeroing the next run's Tenure.
   *
   * `shoppedThrough` is the deepest level whose shop the run reached, which is
   * a level lower than `levelsReached` when the run ended in a death. It is
   * what limits which upgrades Tenure may offer, so it is recorded separately
   * rather than derived: only the caller knows how the run ended.
   */
  const recordRunEnded = useCallback((levelsReached: number, shoppedThrough: number) => {
    updateStats({ lastRunDepth: levelsReached, lastRunShopLevel: Math.max(0, shoppedThrough) });
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
   * Record successfully banking a push-your-luck bonus
   */
  const recordPushBonusBanked = useCallback(() => {
    updateStats({ pushBonusesBanked: 1 });
  }, [updateStats]);

  /**
   * Remember what the finishing run was built out of, for Tenure's guaranteed
   * offer. REPLACES rather than accumulates: it describes one run, not a career.
   */
  const recordRunUpgrades = useCallback((upgradeIds: string[]): void => {
    lastRunUpgradeIdsRef.current = [...upgradeIds];
    setLastRunUpgradeIds(lastRunUpgradeIdsRef.current);
    persistUnlockState();
  }, [persistUnlockState]);

  /**
   * Remember that a tag's set bonus fired in some run: it unlocks that tag's
   * Specialisation for Sprint Planning (offers.yml `archetypeMet`). Returns
   * true only the first time, so the caller can announce it.
   */
  const recordArchetypeMet = useCallback((tag: string): boolean => {
    if (metArchetypesRef.current.includes(tag)) return false;
    metArchetypesRef.current = [...metArchetypesRef.current, tag];
    setMetArchetypes(metArchetypesRef.current);
    persistUnlockState();
    return true;
  }, [persistUnlockState]);

  /**
   * Record that the player has LOCKED (captured) a ball of this type at least
   * once. Fired once per lock (see GameCanvas.onBallTypeLocked); idempotent for
   * a type already encountered. Drives the tutorial's ball-types section - see
   * UnlockState.encounteredBallTypeIds. Returns true iff this was the FIRST
   * time (a new id), so the caller can trigger the "Info Unlocked" flash.
   */
  const recordBallTypeEncountered = useCallback((typeId: string): boolean => {
    if (encounteredBallTypeIdsRef.current.includes(typeId)) return false;
    const next = [...encounteredBallTypeIdsRef.current, typeId];
    encounteredBallTypeIdsRef.current = next;
    setEncounteredBallTypeIds(next);
    persistUnlockState();
    return true;
  }, [persistUnlockState]);

  /**
   * Reveal the loadout system (called on the first win). Returns true only the
   * first time, so the caller can show a one-time "loadouts unlocked" modal.
   */
  const introduceLoadouts = useCallback((): boolean => {
    if (loadoutsIntroducedRef.current) return false;
    loadoutsIntroducedRef.current = true;
    setLoadoutsIntroduced(true);
    persistUnlockState();
    return true;
  }, [persistUnlockState]);

  /**
   * Permanently unlock a game feature (see features.ts). Returns true only the
   * first time a given id is unlocked, so the caller can surface the one-time
   * "Feature Unlocked" modal. Idempotent for an already-unlocked feature.
   */
  const unlockFeature = useCallback((id: string): boolean => {
    if (unlockedFeatureIdsRef.current.includes(id)) return false;
    const next = [...unlockedFeatureIdsRef.current, id];
    unlockedFeatureIdsRef.current = next;
    setUnlockedFeatureIds(next);
    persistUnlockState();
    return true;
  }, [persistUnlockState]);

  /** Whether a feature id has been permanently unlocked. */
  const isFeatureUnlocked = useCallback((id: string): boolean => {
    return unlockedFeatureIds.includes(id);
  }, [unlockedFeatureIds]);

  /**
   * Reset all progression (for debugging)
   */
  const resetProgression = useCallback(() => {
    setStats({ ...DEFAULT_META_STATS });
    setUnlockedIds([]);
    setMetArchetypes([]);
    setLoadoutsIntroduced(false);
    setEncounteredBallTypeIds([]);
    setUnlockedFeatureIds([]);
    unlockedIdsRef.current = [];
    metArchetypesRef.current = [];
    loadoutsIntroducedRef.current = false;
    encounteredBallTypeIdsRef.current = [];
    unlockedFeatureIdsRef.current = [];
    saveMetaStats({ ...DEFAULT_META_STATS });
    saveUnlockState(emptyUnlockState());
  }, []);

  return {
    stats,
    isLoaded,
    metArchetypes,
    loadoutsIntroduced,
    encounteredBallTypeIds,
    lastRunUpgradeIds,
    recordRunUpgrades,
    unlockedFeatureIds,
    updateStats,
    recordLevelReached,
    recordRunEnded,
    recordFencesDrawn,
    recordPerfectLevel,
    recordLivesLost,
    recordPushBonusBanked,
    recordArchetypeMet,
    recordBallTypeEncountered,
    introduceLoadouts,
    unlockFeature,
    isFeatureUnlocked,
    resetProgression,
  };
}
