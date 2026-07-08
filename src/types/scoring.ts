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
    // Per-level overtime cap = round(basePoints × overtimeCapHeadroom).
    // Headroom > 1 leaves room for multiplier builds to pay off while still
    // softly bounding degenerate multiplier stacks.
    overtimeCapHeadroom: number;
    // Multiplier applied to a map's score when the player beats that map's
    // existing highscore (#45). Applied AFTER the per-map cap, so it genuinely
    // rewards a record instead of being clamped away.
    highscoreBonusMultiplier: number;
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
