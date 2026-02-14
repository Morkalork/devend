import { ScoringConfig, ScoreBreakdown } from '@/types/scoring';

/**
 * Get the overtime reward cap for a given level number.
 * Levels 1-3: max 5h, 4-6: max 7h, 7-10: max 9h, 11+: max 12h
 */
export function getOvertimeCap(levelNumber: number): number {
  if (levelNumber <= 3) return 5;
  if (levelNumber <= 6) return 7;
  if (levelNumber <= 10) return 9;
  return 12;
}

/**
 * Calculate fence bonus: +1h if under par, 0 otherwise.
 */
export function calculateFenceBonus(
  usedFences: number,
  parFences: number,
  _config: ScoringConfig
): { bonus: number; fencesUnderPar: number } {
  const fencesUnderPar = Math.max(0, parFences - usedFences);
  return {
    bonus: fencesUnderPar > 0 ? 1 : 0,
    fencesUnderPar,
  };
}

/**
 * Calculate penalty multiplier based on fences over par.
 * 0 over: no penalty, 1-2 over: space bonus halved, 3+: space bonus disabled.
 */
export function getPenaltyMultiplier(
  usedFences: number,
  parFences: number,
  _config: ScoringConfig
): { multiplier: number; fencesOverPar: number } {
  const fencesOverPar = Math.max(0, usedFences - parFences);
  let multiplier: number;
  if (fencesOverPar === 0) multiplier = 1;
  else if (fencesOverPar <= 2) multiplier = 0.5;
  else multiplier = 0;
  return { multiplier, fencesOverPar };
}

/**
 * Calculate space bonus: +1h if removed significantly more than required, 0 otherwise.
 */
export function calculateSpaceBonus(
  actualRemovedRatio: number,
  requiredRemovedRatio: number,
  _config: ScoringConfig
): { bonus: number; extraPercent: number } {
  if (requiredRemovedRatio <= 0) return { bonus: 0, extraPercent: 0 };
  
  const extraRemovedRatio = Math.max(0, actualRemovedRatio - requiredRemovedRatio);
  const extraPercent = extraRemovedRatio / requiredRemovedRatio;
  
  // +1h if extra removal is >= 10% of required
  const bonus = extraPercent >= 0.10 ? 1 : 0;
  
  return { bonus, extraPercent };
}

/**
 * Calculate complete score breakdown for a level completion.
 * All values are in Overtime hours (small integers).
 */
export function calculateScoreBreakdown(
  usedFences: number,
  parFences: number,
  actualRemovedRatio: number,
  requiredRemovedRatio: number,
  config: ScoringConfig
): ScoreBreakdown {
  const { bonus: fenceBonus, fencesUnderPar } = calculateFenceBonus(usedFences, parFences, config);
  const { multiplier: penaltyMultiplier, fencesOverPar } = getPenaltyMultiplier(usedFences, parFences, config);
  const { bonus: spaceBonusRaw, extraPercent } = calculateSpaceBonus(actualRemovedRatio, requiredRemovedRatio, config);

  // Apply penalty to space bonus
  const spaceBonus = penaltyMultiplier > 0 ? spaceBonusRaw : 0;
  const lockBonus = 0; // Calculated separately in game logic
  const totalBonus = fenceBonus + spaceBonus + lockBonus;

  return {
    fenceBonus,
    spaceBonus,
    spaceBonusRaw,
    penaltyMultiplier,
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
  config: ScoringConfig
): Array<{
  label: string;
  usedFences: number;
  actualRemovedRatio: number;
  breakdown: ScoreBreakdown;
}> {
  const scenarios = [
    { label: 'Par -2, +20% extra', fenceOffset: -2, extraPercent: 0.20 },
    { label: 'Par -1, +15% extra', fenceOffset: -1, extraPercent: 0.15 },
    { label: 'At Par, +10% extra', fenceOffset: 0, extraPercent: 0.10 },
    { label: 'Par +1, +10% extra', fenceOffset: 1, extraPercent: 0.10 },
    { label: 'Par +3, +20% extra', fenceOffset: 3, extraPercent: 0.20 },
  ];

  return scenarios.map((scenario) => {
    const usedFences = Math.max(1, parFences + scenario.fenceOffset);
    const actualRemovedRatio = requiredRemovedRatio * (1 + scenario.extraPercent);
    const breakdown = calculateScoreBreakdown(usedFences, parFences, actualRemovedRatio, requiredRemovedRatio, config);
    return { label: scenario.label, usedFences, actualRemovedRatio, breakdown };
  });
}
