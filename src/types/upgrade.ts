export type UpgradeGrade = 'common' | 'uncommon' | 'rare' | 'legendary' | 'godlike';

export interface UpgradeModifiers {
  // Multiplicative modifiers (applied as product)
  ballSpeed?: number;
  ballSize?: number;
  wallGenerationSpeed?: number;
  
  // Additive modifiers
  reducedSize?: number;
  
  // New modifiers
  wallGrace?: number;
  swipeSensitivity?: number;
  cutPreview?: boolean;
  scoreMultiplier?: number;
  expectedCutsBonus?: number;
  highlightFastestBall?: boolean;
  wallShield?: number;
  shopSlots?: number;
  priceMultiplier?: number;
  lives?: number; // Adds to max lives and current lives when purchased
  
  // Non-linear line drawing (allows curved cuts)
  nonLinearLines?: boolean;
  
  // Dead balls: stationary ball-obstacles that spawn at level start
  minDeadBalls?: number;
  maxDeadBalls?: number;
  
  // Ball collision speed modifier (bouncer effect)
  ballCollissionSpeedIncrease?: number;
  
  // Yin Yang: affect random other ball speed (negative = slow down)
  randomBallSpeed?: number;
}

export interface UpgradeConfig {
  id: string;
  name: string;
  grade: UpgradeGrade;
  icon: string;
  description: string;
  levelAvailability: number;
  levelRemoved?: number;
  priceMin: number;
  priceMax: number;
  maxCount?: number; // Maximum copies of this upgrade player can own (default: 1)
  modifiers: UpgradeModifiers;
}

export interface UpgradeData {
  upgrades: UpgradeConfig[];
}

// Grade weights for weighted random selection
export const GRADE_WEIGHTS: Record<UpgradeGrade, number> = {
  common: 55,
  uncommon: 28,
  rare: 12,
  legendary: 4,
  godlike: 1,
};

// Grade colors for visual display
export const GRADE_COLORS: Record<UpgradeGrade, { bg: string; text: string; border: string }> = {
  common: { bg: 'bg-slate-500/20', text: 'text-slate-300', border: 'border-slate-500/50' },
  uncommon: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/50' },
  rare: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/50' },
  legendary: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/50' },
  godlike: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/50' },
};
