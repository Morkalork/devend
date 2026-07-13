// Scoring System Types

export interface FenceEfficiencyStep {
  fencesUnder: number;
  bonus: number;
}

export interface SpaceThreshold {
  extraPercent: number;
  bonus: number;
}

export interface ShipEarlyThreshold {
  /** Window in ACTIVE-play seconds PER BALL (a 4-ball map gets 4x this). */
  withinSecondsPerBall: number;
  bonus: number;
}

export interface ScoringConfig {
  scoring: {
    // Per-level overtime cap = round(basePoints × overtimeCapHeadroom).
    // Headroom > 1 leaves room for multiplier builds to pay off while still
    // softly bounding degenerate multiplier stacks.
    overtimeCapHeadroom: number;
    // Overtime hours per lock-multiplier point when a ball is locked away
    // (a red ball's lockMultiplier is 1, black's is 4). Locking is the main
    // income; the flat map base is deliberately below the cheapest upgrade.
    lockValue: number;
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
    // Ship Early tempo bonus: ladder of active-play seconds to first meet the
    // win condition, scaled by the map's ball count (windows are per ball, so
    // busy maps get proportionally more time). The clock stops when the push
    // prompt opens (or the last ball locks), so push-your-luck time is never
    // taxed. Folds under the cap.
    shipEarly: {
      maxBonus: number;
      thresholds: ShipEarlyThreshold[];
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
