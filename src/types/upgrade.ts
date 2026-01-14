export interface UpgradeModifiers {
  ballSpeed?: number;
  ballSize?: number;
  reducedSize?: number;
  wallGenerationSpeed?: number;
}

export interface UpgradeConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  levelAvailability: number;
  levelRemoved?: number;
  priceMin: number;
  priceMax: number;
  modifiers: UpgradeModifiers;
}

export interface UpgradeData {
  upgrades: UpgradeConfig[];
}
