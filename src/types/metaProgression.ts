/**
 * Types for the meta progression system that tracks persistent player stats
 * and unlocks for locked super upgrades.
 */

export type UnlockConditionType = 
  | 'highestLevelReached'
  | 'totalFencesDrawn'
  | 'totalLevelsCompletedWithoutLoss'
  | 'totalLivesLost';

export interface UnlockCondition {
  type: UnlockConditionType;
  threshold: number;
  description: string;
}

export interface LockedSuperUpgradeConfig {
  locked: true;
  unlockCondition: UnlockCondition;
}

/**
 * Persistent stats tracked across all runs
 */
export interface MetaProgressionStats {
  highestLevelReached: number;
  totalFencesDrawn: number;
  totalLevelsCompletedWithoutLoss: number;
  totalLivesLost: number;
  deepestAscension: number;
  pushBonusesBanked: number;
}

/**
 * Tracks permanent unlocks: legacy super-upgrade ids, plus the run-start
 * loadouts the player has won a run with (their count drives loadout unlocks).
 */
export interface UnlockState {
  unlockedIds: string[];
  /** Distinct run-start loadout ids the player has beaten a run with. */
  wonLoadoutIds: string[];
  /**
   * Whether the loadout system has been revealed. The very first run has no
   * loadout draft (tutorial only); loadouts are introduced after the first win.
   */
  loadoutsIntroduced: boolean;
  /**
   * Best score ever achieved on each map, keyed by map id (LevelConfig.id).
   * Beating a map's existing highscore grants a bonus score multiplier (#45).
   * A map absent from the record has never been completed.
   */
  mapHighscores: Record<string, number>;
}

export const DEFAULT_META_STATS: MetaProgressionStats = {
  highestLevelReached: 0,
  totalFencesDrawn: 0,
  totalLevelsCompletedWithoutLoss: 0,
  totalLivesLost: 0,
  deepestAscension: 0,
  pushBonusesBanked: 0,
};

export const META_STATS_STORAGE_KEY = 'jezzball_meta_stats';
export const UNLOCK_STATE_STORAGE_KEY = 'jezzball_unlock_state';
