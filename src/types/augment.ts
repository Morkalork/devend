import { UnlockCondition } from './metaProgression';

export interface AugmentEffect {
  type: 
    | 'ballSpeedMultiplier'
    | 'fenceSpeedMultiplier'
    | 'parFenceBonus'
    | 'requiredAreaMultiplier'
    | 'scoreInterest'
    | 'bounceDamping'
    | 'wallThicknessMultiplier'
    | 'previewSpeedMultiplier'
    | 'startingLivesBonus'
    | 'varietyMultiplier';
  value: number;
}

export interface Augment {
  id: string;
  name: string;
  description: string;
  cost: number;
  icon?: string;
  effect: AugmentEffect;
  /** If true, this augment must be unlocked before it can be purchased */
  locked?: boolean;
  /** The condition that must be met to unlock this augment */
  unlockCondition?: UnlockCondition;
}

export interface AugmentConfig {
  augments: Augment[];
}

/** Persistent state for the augment system */
export interface AugmentPersistence {
  /** Total accumulated score balance across all runs */
  totalScoreBalance: number;
  /** IDs of augments that have been permanently purchased */
  ownedAugmentIds: string[];
}

export const AUGMENT_STORAGE_KEY = 'jezzball_augments';
export const SCORE_BALANCE_STORAGE_KEY = 'jezzball_score_balance';
