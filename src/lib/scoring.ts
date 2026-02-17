import { ScoringConfig, ScoreBreakdown } from '@/types/scoring';

/**
 * Get the overtime reward cap for a given level number.
 * Levels 1-3: max 14h, 4-6: max 24h, 7-10: max 32h, 11+: max 44h
 */
export function getOvertimeCap(levelNumber: number): number {
  if (levelNumber <= 3) return 14;
  if (levelNumber <= 6) return 24;
  if (levelNumber <= 10) return 32;
  return 44;
}

/**
 * Get performance multiplier based on fences vs par (step-based).
 * Under/at par: 1.0, 1 over: 0.75, 2 over: 0.6, 3+: 0.4
 */
export function getPerformanceMultiplier(
  usedFences: number,
  parFences: number,
  config: ScoringConfig
): { multiplier: number; fencesOverPar: number; fencesUnderPar: number } {
  const fencesOverPar = Math.max(0, usedFences - parFences);
  const fencesUnderPar = Math.max(0, parFences - usedFences);
  const perf = config.scoring.performanceMultiplier;

  let multiplier: number;
  if (fencesOverPar === 0) {
    multiplier = fencesUnderPar > 0 ? perf.underPar : perf.atPar;
  } else if (fencesOverPar === 1) {
    multiplier = perf.overPar1;
  } else if (fencesOverPar === 2) {
    multiplier = perf.overPar2;
  } else {
    multiplier = perf.overPar3Plus;
  }

  return { multiplier, fencesOverPar, fencesUnderPar };
}

/**
 * Calculate under-par bonus: +1h if under par, 0 otherwise.
 */
export function calculateUnderParBonus(
  usedFences: number,
  parFences: number,
  _config: ScoringConfig
): number {
  return usedFences < parFences ? 1 : 0;
}

/**
 * Calculate space bonus: +1h if removed significantly more than required, 0 otherwise.
 * Disabled when 3+ over par.
 */
export function calculateSpaceBonus(
  actualRemovedRatio: number,
  requiredRemovedRatio: number,
  fencesOverPar: number,
  _config: ScoringConfig
): { bonus: number; bonusRaw: number; extraPercent: number } {
  if (requiredRemovedRatio <= 0) return { bonus: 0, bonusRaw: 0, extraPercent: 0 };

  const extraRemovedRatio = Math.max(0, actualRemovedRatio - requiredRemovedRatio);
  const extraPercent = extraRemovedRatio / requiredRemovedRatio;

  // +1h if extra removal is >= 10% of required
  const bonusRaw = extraPercent >= 0.10 ? 1 : 0;

  // Disabled when 3+ over par
  const bonus = fencesOverPar >= 3 ? 0 : bonusRaw;

  return { bonus, bonusRaw, extraPercent };
}

/**
 * Calculate complete score breakdown for a level completion.
 */
export function calculateScoreBreakdown(
  usedFences: number,
  parFences: number,
  actualRemovedRatio: number,
  requiredRemovedRatio: number,
  config: ScoringConfig
): ScoreBreakdown {
  const { multiplier: performanceMultiplier, fencesOverPar, fencesUnderPar } =
    getPerformanceMultiplier(usedFences, parFences, config);

  const underParBonus = calculateUnderParBonus(usedFences, parFences, config);
  const { bonus: spaceBonus, bonusRaw: spaceBonusRaw, extraPercent } =
    calculateSpaceBonus(actualRemovedRatio, requiredRemovedRatio, fencesOverPar, config);

  const lockBonus = 0; // Calculated separately in game logic
  const totalBonus = underParBonus + spaceBonus + lockBonus;

  return {
    underParBonus,
    spaceBonus,
    spaceBonusRaw,
    performanceMultiplier,
    totalBonus,
    fencesUnderPar,
    fencesOverPar,
    extraPercent,
    lockBonus,
  };
}

/**
 * Generate preview scenarios for the admin panel.
 */
export function generateScoringPreview(
  parFences: number,
  requiredRemovedRatio: number,
  config: ScoringConfig,
  basePoints: number = 20
): Array<{
  label: string;
  usedFences: number;
  actualRemovedRatio: number;
  breakdown: ScoreBreakdown;
  earnedScore: number;
}> {
  const scenarios = [
    { label: 'Under par (-2), +20% extra', fenceOffset: -2, extraPercent: 0.20 },
    { label: 'At Par, +15% extra', fenceOffset: 0, extraPercent: 0.15 },
    { label: 'Par +1, +10% extra', fenceOffset: 1, extraPercent: 0.10 },
    { label: 'Par +2, +10% extra', fenceOffset: 2, extraPercent: 0.10 },
    { label: 'Par +3, +20% extra', fenceOffset: 3, extraPercent: 0.20 },
  ];

  return scenarios.map((scenario) => {
    const usedFences = Math.max(1, parFences + scenario.fenceOffset);
    const actualRemovedRatio = requiredRemovedRatio * (1 + scenario.extraPercent);
    const breakdown = calculateScoreBreakdown(usedFences, parFences, actualRemovedRatio, requiredRemovedRatio, config);
    const earnedScore = Math.floor(basePoints * breakdown.performanceMultiplier) + breakdown.totalBonus;
    return { label: scenario.label, usedFences, actualRemovedRatio, breakdown, earnedScore };
  });
}
