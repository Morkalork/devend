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
}

/**
 * Tracks which super upgrades have been permanently unlocked
 */
export interface UnlockState {
  unlockedIds: string[];
}

export const DEFAULT_META_STATS: MetaProgressionStats = {
  highestLevelReached: 0,
  totalFencesDrawn: 0,
  totalLevelsCompletedWithoutLoss: 0,
  totalLivesLost: 0,
  deepestAscension: 0,
};

export const META_STATS_STORAGE_KEY = 'jezzball_meta_stats';
export const UNLOCK_STATE_STORAGE_KEY = 'jezzball_unlock_state';
