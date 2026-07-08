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
 * Get the overtime reward cap for a level, scaled from its own base points.
 *
 * cap = round(basePoints × headroom). Because it keys off the level's points
 * rather than its number, the cap grows with the pay curve (so later levels
 * pay more) and works for any number of levels — nothing is pinned to a fixed
 * level count. Headroom > 1 leaves room for multiplier builds (Performance
 * Bonus, Technical Debt, mutators) to pay off, while still softly bounding
 * degenerate multiplier stacks.
 */
export function getOvertimeCap(basePoints: number, headroom: number): number {
  const safeHeadroom = Number.isFinite(headroom) && headroom > 0 ? headroom : 1;
  return Math.round(basePoints * safeHeadroom);
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
 * Calculate space bonus: a config-driven ladder that pays more overtime the
 * further you clear past what the level required. `thresholds` is an ascending
 * ladder of `{ extraPercent, bonus }` rungs; we award the highest rung whose
 * extraPercent floor is met (capped at `maxBonus`). This rewards greedy,
 * push-your-luck removal: leaving less space on the board climbs to bigger
 * payouts instead of the old flat +1h. A single-rung config reproduces the
 * legacy binary behaviour. Disabled when 3+ over par.
 */
export function calculateSpaceBonus(
  actualRemovedRatio: number,
  requiredRemovedRatio: number,
  fencesOverPar: number,
  config: ScoringConfig
): { bonus: number; bonusRaw: number; extraPercent: number } {
  if (requiredRemovedRatio <= 0) return { bonus: 0, bonusRaw: 0, extraPercent: 0 };

  const extraRemovedRatio = Math.max(0, actualRemovedRatio - requiredRemovedRatio);
  const extraPercent = extraRemovedRatio / requiredRemovedRatio;

  const { maxBonus, thresholds } = config.scoring.spaceOptimization;

  // Highest rung whose extraPercent floor is cleared (order-independent), then
  // clamp to maxBonus. Below the first floor this stays 0.
  let bonusRaw = 0;
  for (const step of thresholds) {
    if (extraPercent >= step.extraPercent) {
      bonusRaw = Math.max(bonusRaw, step.bonus);
    }
  }
  bonusRaw = Math.min(bonusRaw, maxBonus);

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
    const rawScore = Math.floor(basePoints * breakdown.performanceMultiplier) + breakdown.totalBonus;
    const cap = getOvertimeCap(basePoints, config.scoring.overtimeCapHeadroom);
    const earnedScore = Math.max(0, Math.min(rawScore, cap));
    return { label: scenario.label, usedFences, actualRemovedRatio, breakdown, earnedScore };
  });
}

// ── Config loading ─────────────────────────────────────────────────────────

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  scoring: {
    overtimeCapHeadroom: 2.0,
    highscoreBonusMultiplier: 1.25,
    fenceEfficiency: {
      maxBonus: 1,
      steps: [{ fencesUnder: 1, bonus: 1 }],
    },
    spaceOptimization: {
      maxBonus: 3,
      thresholds: [
        { extraPercent: 0.10, bonus: 1 },
        { extraPercent: 0.30, bonus: 2 },
        { extraPercent: 0.55, bonus: 3 },
      ],
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
            overtimeCapHeadroom: parsed.scoring.overtimeCapHeadroom ?? DEFAULT_SCORING_CONFIG.scoring.overtimeCapHeadroom,
            highscoreBonusMultiplier: parsed.scoring.highscoreBonusMultiplier ?? DEFAULT_SCORING_CONFIG.scoring.highscoreBonusMultiplier,
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

/** The beat-the-highscore score multiplier from the loaded config (#45). */
export function getHighscoreBonusMultiplier(): number {
  const m = loadedConfig.scoring.highscoreBonusMultiplier;
  return Number.isFinite(m) && m > 0 ? m : 1;
}

/**
 * Calculate the overtime reward for a level, synchronously, using the
 * preloaded config. Performance multiplier scales the base reward,
 * scoreMultiplier (from upgrades) applies on top, and the result is capped
 * at basePoints × overtimeCapHeadroom (see getOvertimeCap). The levelNumber
 * arg is retained for the callers' breakdown/telemetry but no longer drives
 * the cap.
 *
 * `extraBonus` folds lock/push/break bonuses in BEFORE the cap so a single map
 * can never pay more than the cap (issue #43): together with the flat per-map
 * base points this keeps every map's reward in the same band and stops the
 * money-ball / push-your-luck stack from inflating the economy.
 */
export function calculateScore(
  usedFences: number,
  parFences: number,
  remainingPercent: number,
  thresholdPercent: number,
  basePoints: number,
  scoreMultiplier: number = 1,
  levelNumber: number = 1,
  extraBonus: number = 0,
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
  const safeExtra = Number.isFinite(extraBonus) && extraBonus > 0 ? extraBonus : 0;
  const multipliedBase = Math.floor(basePoints * breakdown.performanceMultiplier * safeMultiplier);
  const rawScore = multipliedBase + breakdown.totalBonus + safeExtra;
  const cap = getOvertimeCap(basePoints, loadedConfig.scoring.overtimeCapHeadroom);
  const levelScore = Math.max(0, Math.min(rawScore, cap));

  return { levelScore, breakdown };
}
