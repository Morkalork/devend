import { UnlockCondition } from './metaProgression';

export interface SuperUpgradeEffect {
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

export interface SuperUpgrade {
  id: string;
  name: string;
  description: string;
  cost: number;
  icon?: string;
  effect: SuperUpgradeEffect;
  /** If true, this upgrade must be unlocked before it can be purchased */
  locked?: boolean;
  /** The condition that must be met to unlock this upgrade */
  unlockCondition?: UnlockCondition;
}

export interface SuperUpgradeConfig {
  superUpgrades: SuperUpgrade[];
}

export interface ActiveSuperUpgrade {
  upgrade: SuperUpgrade;
  purchasedAt: string; // ISO timestamp
}
