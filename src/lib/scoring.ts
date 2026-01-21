import { ScoringConfig, ScoreBreakdown } from '@/types/scoring';

/**
 * Calculate the fence efficiency bonus based on fences under par.
 * Uses step-based cumulative bonus with a hard cap.
 */
export function calculateFenceBonus(
  usedFences: number,
  parFences: number,
  config: ScoringConfig
): { bonus: number; fencesUnderPar: number } {
  const fencesUnderPar = Math.max(0, parFences - usedFences);
  
  if (fencesUnderPar === 0) {
    return { bonus: 0, fencesUnderPar: 0 };
  }

  const { steps, maxBonus } = config.scoring.fenceEfficiency;
  
  // Sort steps by fencesUnder ascending
  const sortedSteps = [...steps].sort((a, b) => a.fencesUnder - b.fencesUnder);
  
  // Sum up bonuses for each fence under par
  let totalBonus = 0;
  for (const step of sortedSteps) {
    if (fencesUnderPar >= step.fencesUnder) {
      totalBonus += step.bonus;
    } else {
      break;
    }
  }

  return {
    bonus: Math.min(totalBonus, maxBonus),
    fencesUnderPar,
  };
}

/**
 * Calculate the penalty multiplier based on fences over par.
 */
export function getPenaltyMultiplier(
  usedFences: number,
  parFences: number,
  config: ScoringConfig
): { multiplier: number; fencesOverPar: number } {
  const fencesOverPar = Math.max(0, usedFences - parFences);
  const penalties = config.scoring.fencePenaltyMultiplier;

  let multiplier: number;
  if (fencesOverPar === 0) {
    multiplier = penalties.overPar0;
  } else if (fencesOverPar === 1) {
    multiplier = penalties.overPar1;
  } else if (fencesOverPar === 2) {
    multiplier = penalties.overPar2;
  } else {
    multiplier = penalties.overPar3Plus;
  }

  return { multiplier, fencesOverPar };
}

/**
 * Calculate the space optimization bonus using threshold-based diminishing returns.
 * extraPercent = (actualRemovedRatio - requiredRemovedRatio) / requiredRemovedRatio
 */
export function calculateSpaceBonus(
  actualRemovedRatio: number,
  requiredRemovedRatio: number,
  config: ScoringConfig
): { bonus: number; extraPercent: number } {
  const extraRemovedRatio = Math.max(0, actualRemovedRatio - requiredRemovedRatio);
  
  // Avoid division by zero
  if (requiredRemovedRatio <= 0) {
    return { bonus: 0, extraPercent: 0 };
  }
  
  const extraPercent = extraRemovedRatio / requiredRemovedRatio;
  
  if (extraPercent <= 0) {
    return { bonus: 0, extraPercent: 0 };
  }

  const { thresholds, maxBonus } = config.scoring.spaceOptimization;
  
  // Sort thresholds by extraPercent ascending
  const sortedThresholds = [...thresholds].sort((a, b) => a.extraPercent - b.extraPercent);
  
  // Find the highest threshold that we've exceeded
  let bonus = 0;
  for (const threshold of sortedThresholds) {
    if (extraPercent >= threshold.extraPercent) {
      bonus = threshold.bonus;
    } else {
      break;
    }
  }

  return {
    bonus: Math.min(bonus, maxBonus),
    extraPercent,
  };
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
  const { bonus: fenceBonus, fencesUnderPar } = calculateFenceBonus(
    usedFences,
    parFences,
    config
  );

  const { multiplier: penaltyMultiplier, fencesOverPar } = getPenaltyMultiplier(
    usedFences,
    parFences,
    config
  );

  const { bonus: spaceBonusRaw, extraPercent } = calculateSpaceBonus(
    actualRemovedRatio,
    requiredRemovedRatio,
    config
  );

  // Apply penalty multiplier to space bonus
  const spaceBonus = Math.floor(spaceBonusRaw * penaltyMultiplier);

  const totalBonus = fenceBonus + spaceBonus;

  return {
    fenceBonus,
    spaceBonus,
    spaceBonusRaw,
    penaltyMultiplier,
    totalBonus,
    fencesUnderPar,
    fencesOverPar,
    extraPercent,
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
  // Simulate different scenarios with varying removed ratios
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

    const breakdown = calculateScoreBreakdown(
      usedFences,
      parFences,
      actualRemovedRatio,
      requiredRemovedRatio,
      config
    );

    return {
      label: scenario.label,
      usedFences,
      actualRemovedRatio,
      breakdown,
    };
  });
}
