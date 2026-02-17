// Scoring System Types

export interface FenceEfficiencyStep {
  fencesUnder: number;
  bonus: number;
}

export interface SpaceThreshold {
  extraPercent: number;
  bonus: number;
}

export interface ScoringConfig {
  scoring: {
    fenceEfficiency: {
      maxBonus: number;
      steps: FenceEfficiencyStep[];
    };
    spaceOptimization: {
      maxBonus: number;
      thresholds: SpaceThreshold[];
    };
    performanceMultiplier: {
      underPar: number;
      atPar: number;
      overPar1: number;
      overPar2: number;
      overPar3Plus: number;
    };
  };
}

export interface ScoreBreakdown {
  underParBonus: number;
  spaceBonus: number;
  spaceBonusRaw: number; // Before performance gating
  performanceMultiplier: number;
  totalBonus: number;
  fencesUnderPar: number;
  fencesOverPar: number;
  extraPercent: number;
  lockBonus: number; // Bonus from locking balls
}

export interface ScoringPreviewScenario {
  label: string;
  usedFences: number;
  actualRemovedRatio: number;
  breakdown: ScoreBreakdown;
}
