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
}

export interface SuperUpgradeConfig {
  superUpgrades: SuperUpgrade[];
}

export interface ActiveSuperUpgrade {
  upgrade: SuperUpgrade;
  purchasedAt: string; // ISO timestamp
}
