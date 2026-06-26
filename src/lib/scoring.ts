/**
 * Scoring system — computes the "overtime hours" reward when a level is
 * completed (or partially, on game over).
 *
 * Tunable numbers live in public/scoring-config.yml and are fetched once at
 * startup (see loadScoringConfig at the bottom of this file); the hard-coded
 * defaults below are only a fallback if that file fails to load.
 *
 * Main entry point: calculateScore(). The admin scoring preview panel uses
 * generateScoringPreview() via the useScoringConfig hook.
 */
import yaml from 'js-yaml';
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

// ── Config loading ─────────────────────────────────────────────────────────

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  scoring: {
    fenceEfficiency: {
      maxBonus: 1,
      steps: [{ fencesUnder: 1, bonus: 1 }],
    },
    spaceOptimization: {
      maxBonus: 1,
      thresholds: [{ extraPercent: 0.10, bonus: 1 }],
    },
    performanceMultiplier: {
      underPar: 1.0,
      atPar: 1.0,
      overPar1: 0.75,
      overPar2: 0.6,
      overPar3Plus: 0.4,
    },
  },
};

let configPromise: Promise<ScoringConfig> | null = null;
let loadedConfig: ScoringConfig = DEFAULT_SCORING_CONFIG;

/** Fetch public/scoring-config.yml once; later calls reuse the same promise. */
export function loadScoringConfig(): Promise<ScoringConfig> {
  if (configPromise) return configPromise;
  configPromise = fetch('/scoring-config.yml')
    .then((res) => res.text())
    .then((text) => {
      const parsed = yaml.load(text) as ScoringConfig;
      if (parsed?.scoring) {
        loadedConfig = {
          scoring: {
            fenceEfficiency: { ...DEFAULT_SCORING_CONFIG.scoring.fenceEfficiency, ...parsed.scoring.fenceEfficiency },
            spaceOptimization: { ...DEFAULT_SCORING_CONFIG.scoring.spaceOptimization, ...parsed.scoring.spaceOptimization },
            performanceMultiplier: { ...DEFAULT_SCORING_CONFIG.scoring.performanceMultiplier, ...parsed.scoring.performanceMultiplier },
          },
        };
      }
      return loadedConfig;
    })
    .catch((err) => {
      console.warn('Failed to load scoring config, using defaults:', err);
      return DEFAULT_SCORING_CONFIG;
    });
  return configPromise;
}

/** Await this before calling calculateScore() to guarantee the YAML config is in. */
export async function ensureScoringConfigLoaded(): Promise<void> {
  await loadScoringConfig();
}

/**
 * Calculate the overtime reward for a level, synchronously, using the
 * preloaded config. Performance multiplier scales the base reward,
 * scoreMultiplier (from upgrades) applies on top, and the result is capped
 * per level tier (see getOvertimeCap).
 */
export function calculateScore(
  usedFences: number,
  parFences: number,
  remainingPercent: number,
  thresholdPercent: number,
  basePoints: number,
  scoreMultiplier: number = 1,
  levelNumber: number = 1,
): {
  levelScore: number;
  breakdown: ScoreBreakdown;
} {
  const requiredRemovedRatio = (100 - thresholdPercent) / 100;
  const actualRemovedRatio = (100 - remainingPercent) / 100;

  const breakdown = calculateScoreBreakdown(
    usedFences, parFences, actualRemovedRatio, requiredRemovedRatio, loadedConfig
  );

  // Guard against a NaN/negative scoreMultiplier leaking in from bad config.
  const safeMultiplier = Number.isFinite(scoreMultiplier) && scoreMultiplier > 0 ? scoreMultiplier : 1;
  const multipliedBase = Math.floor(basePoints * breakdown.performanceMultiplier * safeMultiplier);
  const rawScore = multipliedBase + breakdown.totalBonus;
  const cap = getOvertimeCap(levelNumber);
  const levelScore = Math.max(0, Math.min(rawScore, cap));

  return { levelScore, breakdown };
}
