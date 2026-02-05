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
    | 'varietyMultiplier'
    | 'startingLevelBonus';
  /** The effect value PER STACK (effects stack linearly) */
  value: number;
}

export interface Augment {
  id: string;
  name: string;
  description: string;
  /** Maximum number of stacks that can be purchased */
  maxStacks: number;
  /** Augment Point cost per stack */
  costPerStack: number;
  icon?: string;
  effect: AugmentEffect;
  /** If true, this augment must be unlocked before it can be purchased */
  locked?: boolean;
  /** The condition that must be met to unlock this augment */
  unlockCondition?: UnlockCondition;
  /** If true, this is a special golden augment with unique styling */
  special?: boolean;
}

export interface AugmentConfig {
  augments: Augment[];
}

/** Persistent state for the augment system */
export interface AugmentPersistence {
  /** Total accumulated Augment Points balance */
  totalAugmentPoints: number;
  /** Map of augment ID to owned stack count */
  augmentsOwned: Record<string, number>;
  /** Total levels completed (used to calculate earned points) */
  totalLevelsCompleted: number;
}

export const AUGMENT_STORAGE_KEY = 'jezzball_augments_v2';

/** Default persistence state */
export const DEFAULT_AUGMENT_PERSISTENCE: AugmentPersistence = {
  totalAugmentPoints: 0,
  augmentsOwned: {},
  totalLevelsCompleted: 0,
};
