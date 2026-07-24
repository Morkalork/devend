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
import { bestHighscore, isHighscoreRecord } from '@/lib/highscore';
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
    unlockedIds: [], wonLoadoutIds: [], loadoutsIntroduced: false, mapHighscores: {},
    encounteredBallTypeIds: [], archetypeBests: {}, unlockedFeatureIds: [],
  };
}

function loadUnlockState(): UnlockState {
  try {
    const stored = localStorage.getItem(UNLOCK_STATE_STORAGE_KEY);
    if (!stored) return emptyUnlockState();

    const parsed = JSON.parse(stored);
    // Only accept finite positive numbers for the map-highscore record.
    const mapHighscores: Record<string, number> = {};
    if (parsed.mapHighscores && typeof parsed.mapHighscores === 'object') {
      for (const [id, v] of Object.entries(parsed.mapHighscores)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) mapHighscores[id] = v;
      }
    }
    // Same sanitising for the per-archetype bests.
    const archetypeBests: Record<string, number> = {};
    if (parsed.archetypeBests && typeof parsed.archetypeBests === 'object') {
      for (const [tag, v] of Object.entries(parsed.archetypeBests)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) archetypeBests[tag] = v;
      }
    }
    // Migrate legacy unlock flags into the general feature list so players who
    // already earned a feature (e.g. loadouts, via the old first-win flag) keep
    // it under the new "Feature Unlocked" system.
    const featureIds = seedLegacyFeatureUnlocks(
      Array.isArray(parsed.unlockedFeatureIds) ? parsed.unlockedFeatureIds : [],
      parsed.loadoutsIntroduced === true,
    );
    return {
      unlockedIds: Array.isArray(parsed.unlockedIds) ? parsed.unlockedIds : [],
      wonLoadoutIds: Array.isArray(parsed.wonLoadoutIds) ? parsed.wonLoadoutIds : [],
      loadoutsIntroduced: parsed.loadoutsIntroduced === true,
      mapHighscores,
      encounteredBallTypeIds: Array.isArray(parsed.encounteredBallTypeIds) ? parsed.encounteredBallTypeIds : [],
      archetypeBests,
      unlockedFeatureIds: featureIds,
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
  const [wonLoadoutIds, setWonLoadoutIds] = useState<string[]>([]);
  const [loadoutsIntroduced, setLoadoutsIntroduced] = useState(false);
  const [mapHighscores, setMapHighscores] = useState<Record<string, number>>({});
  const [encounteredBallTypeIds, setEncounteredBallTypeIds] = useState<string[]>([]);
  const [archetypeBests, setArchetypeBests] = useState<Record<string, number>>({});
  const [unlockedFeatureIds, setUnlockedFeatureIds] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Refs mirror the persisted unlock state so recordLoadoutWin /
  // introduceLoadouts / recordMapHighscore / recordBallTypeEncountered can
  // read/write it synchronously without stale state.
  const unlockedIdsRef = useRef<string[]>([]);
  const wonLoadoutIdsRef = useRef<string[]>([]);
  const loadoutsIntroducedRef = useRef(false);
  const mapHighscoresRef = useRef<Record<string, number>>({});
  const encounteredBallTypeIdsRef = useRef<string[]>([]);
  const archetypeBestsRef = useRef<Record<string, number>>({});
  const unlockedFeatureIdsRef = useRef<string[]>([]);

  // Persist the full unlock state from the refs (single source, so no save site
  // can forget a field).
  const persistUnlockState = useCallback(() => {
    saveUnlockState({
      unlockedIds: unlockedIdsRef.current,
      wonLoadoutIds: wonLoadoutIdsRef.current,
      loadoutsIntroduced: loadoutsIntroducedRef.current,
      mapHighscores: mapHighscoresRef.current,
      encounteredBallTypeIds: encounteredBallTypeIdsRef.current,
      archetypeBests: archetypeBestsRef.current,
      unlockedFeatureIds: unlockedFeatureIdsRef.current,
    });
  }, []);

  // Load on mount
  useEffect(() => {
    const loadedStats = loadMetaStats();
    const loadedUnlocks = loadUnlockState();
    setStats(loadedStats);
    setUnlockedIds(loadedUnlocks.unlockedIds);
    setWonLoadoutIds(loadedUnlocks.wonLoadoutIds);
    setLoadoutsIntroduced(loadedUnlocks.loadoutsIntroduced);
    setMapHighscores(loadedUnlocks.mapHighscores);
    setEncounteredBallTypeIds(loadedUnlocks.encounteredBallTypeIds);
    setArchetypeBests(loadedUnlocks.archetypeBests);
    setUnlockedFeatureIds(loadedUnlocks.unlockedFeatureIds);
    unlockedIdsRef.current = loadedUnlocks.unlockedIds;
    wonLoadoutIdsRef.current = loadedUnlocks.wonLoadoutIds;
    loadoutsIntroducedRef.current = loadedUnlocks.loadoutsIntroduced;
    mapHighscoresRef.current = loadedUnlocks.mapHighscores;
    encounteredBallTypeIdsRef.current = loadedUnlocks.encounteredBallTypeIds;
    archetypeBestsRef.current = loadedUnlocks.archetypeBests;
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
    persistUnlockState();
    return { added: true, prevCount, newCount: next.length };
  }, [persistUnlockState]);

  /**
   * Record a map's final score. Updates the stored best only if the new score is
   * higher, and reports whether it beat a PREVIOUS highscore (isRecord) - which
   * is what grants the beat-highscore bonus - vs. simply setting the first-ever
   * baseline (wasFirstPlay). Idempotent-safe to call once per map completion.
   */
  const recordMapHighscore = useCallback(
    (mapId: string, score: number): { previous: number | null; isRecord: boolean; wasFirstPlay: boolean } => {
      const prevAll = mapHighscoresRef.current;
      const previous = Object.prototype.hasOwnProperty.call(prevAll, mapId) ? prevAll[mapId] : null;
      const wasFirstPlay = previous === null;
      const isRecord = isHighscoreRecord(previous, score);
      const best = bestHighscore(previous, score);
      if (best !== previous) {
        const next = { ...prevAll, [mapId]: best };
        mapHighscoresRef.current = next;
        setMapHighscores(next);
        persistUnlockState();
      }
      return { previous, isRecord, wasFirstPlay };
    },
    [persistUnlockState],
  );

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
   * Record a finished run's banked overtime against its dominant build
   * archetype (see buildRecap.ts). Updates the stored best only when beaten,
   * and reports the previous best so the result screen can celebrate records.
   */
  const recordArchetypeBest = useCallback(
    (tag: string, score: number): { previous: number | null; isRecord: boolean } => {
      const prevAll = archetypeBestsRef.current;
      const previous = Object.prototype.hasOwnProperty.call(prevAll, tag) ? prevAll[tag] : null;
      const isRecord = score > 0 && (previous === null || score > previous);
      if (isRecord) {
        const next = { ...prevAll, [tag]: score };
        archetypeBestsRef.current = next;
        setArchetypeBests(next);
        persistUnlockState();
      }
      return { previous, isRecord };
    },
    [persistUnlockState],
  );

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
    setWonLoadoutIds([]);
    setLoadoutsIntroduced(false);
    setMapHighscores({});
    setEncounteredBallTypeIds([]);
    setArchetypeBests({});
    setUnlockedFeatureIds([]);
    unlockedIdsRef.current = [];
    wonLoadoutIdsRef.current = [];
    loadoutsIntroducedRef.current = false;
    mapHighscoresRef.current = {};
    encounteredBallTypeIdsRef.current = [];
    archetypeBestsRef.current = {};
    unlockedFeatureIdsRef.current = [];
    saveMetaStats({ ...DEFAULT_META_STATS });
    saveUnlockState(emptyUnlockState());
  }, []);

  return {
    stats,
    isLoaded,
    wonLoadoutIds,
    loadoutsIntroduced,
    mapHighscores,
    encounteredBallTypeIds,
    archetypeBests,
    unlockedFeatureIds,
    updateStats,
    recordLevelReached,
    recordFencesDrawn,
    recordPerfectLevel,
    recordLivesLost,
    recordAscensionDepth,
    recordPushBonusBanked,
    recordLoadoutWin,
    recordMapHighscore,
    recordBallTypeEncountered,
    recordArchetypeBest,
    introduceLoadouts,
    unlockFeature,
    isFeatureUnlocked,
    resetProgression,
  };
}
