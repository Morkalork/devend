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
    fencePenaltyMultiplier: {
      overPar0: number;
      overPar1: number;
      overPar2: number;
      overPar3Plus: number;
    };
  };
}

export interface ScoreBreakdown {
  fenceBonus: number;
  spaceBonus: number;
  spaceBonusRaw: number; // Before penalty multiplier
  penaltyMultiplier: number;
  totalBonus: number;
  fencesUnderPar: number;
  fencesOverPar: number;
  extraPercent: number;
}

export interface ScoringPreviewScenario {
  label: string;
  usedFences: number;
  actualRemovedRatio: number;
  breakdown: ScoreBreakdown;
}
