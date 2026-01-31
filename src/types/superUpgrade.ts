export interface SuperUpgradeEffect {
  type: 
    | 'bonus_lives'
    | 'score_multiplier'
    | 'ball_speed_modifier'
    | 'fence_speed_modifier'
    | 'starting_area_bonus'
    | 'immunity_charge';
  value: number;
}

export interface SuperUpgrade {
  id: string;
  name: string;
  description: string;
  cost: number;
  effect: SuperUpgradeEffect;
}

export interface SuperUpgradeConfig {
  super_upgrades: SuperUpgrade[];
}

export interface ActiveSuperUpgrade {
  upgrade: SuperUpgrade;
  purchasedAt: string; // ISO timestamp
}
