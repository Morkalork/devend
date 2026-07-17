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
import { ScoringConfig, ScoreBreakdown, ShipEarlyThreshold } from '@/types/scoring';

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
 * Calculate the Ship Early tempo bonus: a config-driven ladder that pays more
 * overtime the faster the win condition was first met, measured in ACTIVE-play
 * seconds (pauses, menus and the push prompt do not count). Windows are PER
 * BALL, so a busy map earns proportionally more time than a one-ball map.
 * Awards the best rung whose window was met, clamped at `maxBonus`;
 * null/undefined means "no clear time recorded" and pays nothing. Mirrors
 * calculateSpaceBonus so instinctive speed and tactical precision are
 * parallel, competing payoffs.
 */
export function calculateShipEarlyBonus(
  clearedActiveSeconds: number | null | undefined,
  ballCount: number,
  config: ScoringConfig,
  extraSecondsPerBall: number = 0,
  bonusMultiplier: number = 1,
): number {
  if (clearedActiveSeconds == null || !Number.isFinite(clearedActiveSeconds) || clearedActiveSeconds < 0) return 0;
  const balls = Number.isFinite(ballCount) && ballCount > 0 ? ballCount : 1;
  // Deadline Extension: extra per-ball seconds added to every window.
  const extra = Number.isFinite(extraSecondsPerBall) && extraSecondsPerBall > 0 ? extraSecondsPerBall : 0;
  // Hard Deadline door: scales the payout AFTER the maxBonus clamp (the door
  // doubles what the ladder pays, it does not unlock higher rungs).
  const mult = Number.isFinite(bonusMultiplier) && bonusMultiplier > 0 ? bonusMultiplier : 1;

  const { maxBonus, thresholds } = config.scoring.shipEarly;
  let bonus = 0;
  for (const step of thresholds) {
    if (clearedActiveSeconds <= (step.withinSecondsPerBall + extra) * balls) {
      bonus = Math.max(bonus, step.bonus);
    }
  }
  return Math.round(Math.min(bonus, maxBonus) * mult);
}

/** Ship Early bonus from the preloaded config (see loadScoringConfig). */
export function getShipEarlyBonus(
  clearedActiveSeconds: number | null | undefined,
  ballCount: number,
  extraSecondsPerBall: number = 0,
  bonusMultiplier: number = 1,
): number {
  return calculateShipEarlyBonus(clearedActiveSeconds, ballCount, loadedConfig, extraSecondsPerBall, bonusMultiplier);
}

/** The Ship Early ladder from the preloaded config (drives the countdown bar). */
export function getShipEarlyThresholds(): ShipEarlyThreshold[] {
  return loadedConfig.scoring.shipEarly.thresholds;
}

/**
 * Calculate complete score breakdown for a level completion.
 */
export function calculateScoreBreakdown(
  usedFences: number,
  parFences: number,
  actualRemovedRatio: number,
  requiredRemovedRatio: number,
  config: ScoringConfig,
  spaceBonusMultiplier: number = 1,
): ScoreBreakdown {
  const { multiplier: performanceMultiplier, fencesOverPar, fencesUnderPar } =
    getPerformanceMultiplier(usedFences, parFences, config);

  const underParBonus = calculateUnderParBonus(usedFences, parFences, config);
  const { bonus: spaceBonusBase, bonusRaw: spaceBonusRaw, extraPercent } =
    calculateSpaceBonus(actualRemovedRatio, requiredRemovedRatio, fencesOverPar, config);
  // Tech Evangelist: scales the space-optimization payout (still under the
  // per-map cap, so it buys consistency rather than inflation).
  const safeSpaceMult = Number.isFinite(spaceBonusMultiplier) && spaceBonusMultiplier > 0 ? spaceBonusMultiplier : 1;
  const spaceBonus = Math.round(spaceBonusBase * safeSpaceMult);

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
    overtimeCapHeadroom: 4.0,
    lockValue: 12,
    lockQuality: {
      superiorThresholdFraction: 0.4,
      superiorMultiplier: 2.0,
    },
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
    shipEarly: {
      maxBonus: 3,
      thresholds: [
        { withinSecondsPerBall: 6, bonus: 3 },
        { withinSecondsPerBall: 10, bonus: 2 },
        { withinSecondsPerBall: 15, bonus: 1 },
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
            lockValue: parsed.scoring.lockValue ?? DEFAULT_SCORING_CONFIG.scoring.lockValue,
            lockQuality: { ...DEFAULT_SCORING_CONFIG.scoring.lockQuality, ...parsed.scoring.lockQuality },
            highscoreBonusMultiplier: parsed.scoring.highscoreBonusMultiplier ?? DEFAULT_SCORING_CONFIG.scoring.highscoreBonusMultiplier,
            fenceEfficiency: { ...DEFAULT_SCORING_CONFIG.scoring.fenceEfficiency, ...parsed.scoring.fenceEfficiency },
            spaceOptimization: { ...DEFAULT_SCORING_CONFIG.scoring.spaceOptimization, ...parsed.scoring.spaceOptimization },
            shipEarly: { ...DEFAULT_SCORING_CONFIG.scoring.shipEarly, ...parsed.scoring.shipEarly },
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
 * Overtime hours per lock-multiplier point, from the loaded config. This is
 * what makes locking the game's main income: a red lock pays lockValue × 1,
 * a black lock lockValue × 4 (before trap/money-ball multipliers).
 */
export function getLockValue(): number {
  const v = loadedConfig.scoring.lockValue;
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * Superior-lock tuning from the loaded config: a lock whose pocket is at most
 * `superiorThresholdFraction` of the BASE lock threshold pays its lock points
 * times `superiorMultiplier` (see checkBallWonState). Guarded so a bad config
 * degrades to "no superior tier" (fraction 0, multiplier 1) instead of NaN pay.
 */
export function getLockQuality(): { superiorThresholdFraction: number; superiorMultiplier: number } {
  const q = loadedConfig.scoring.lockQuality;
  const fraction = Number.isFinite(q?.superiorThresholdFraction) && q.superiorThresholdFraction > 0
    ? q.superiorThresholdFraction : 0;
  const multiplier = Number.isFinite(q?.superiorMultiplier) && q.superiorMultiplier > 0
    ? q.superiorMultiplier : 1;
  return { superiorThresholdFraction: fraction, superiorMultiplier: multiplier };
}

/** The beat-the-highscore score multiplier from the loaded config (#45). */
export function getHighscoreBonusMultiplier(): number {
  const m = loadedConfig.scoring.highscoreBonusMultiplier;
  return Number.isFinite(m) && m > 0 ? m : 1;
}

/**
 * Modifier-driven adjustments to a level's reward, normally sourced from the
 * run's GameModifiers. Gathered into one options object so call sites stay
 * readable as the modifier system grows (they were positional args before).
 */
export interface ScoreOptions {
  /** Upgrade/loadout/door score multiplier (default 1). */
  scoreMultiplier?: number;
  /** Lock/push/break bonuses, folded in UNDER the cap (default 0). */
  extraBonus?: number;
  /** Tech Evangelist: scales the space-optimization bonus (default 1). */
  spaceBonusMultiplier?: number;
  /** Stock Options capstone: flat raise on the per-map cap (default 0). */
  overtimeCapBonus?: number;
  /** Pickup overtime tokens: paid AFTER the cap clamp, like the highscore
   *  bonus, so a claimed token always pays even on a capped map (default 0). */
  postCapBonus?: number;
}

/**
 * Calculate the overtime reward for a level, synchronously, using the
 * preloaded config. Performance multiplier scales the base reward,
 * scoreMultiplier (from upgrades) applies on top, and the result is capped
 * at basePoints × overtimeCapHeadroom (see getOvertimeCap) plus any capstone
 * cap raise.
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
  options: ScoreOptions = {},
): {
  levelScore: number;
  breakdown: ScoreBreakdown;
} {
  const { scoreMultiplier = 1, extraBonus = 0, spaceBonusMultiplier = 1, overtimeCapBonus = 0, postCapBonus = 0 } = options;
  const requiredRemovedRatio = (100 - thresholdPercent) / 100;
  const actualRemovedRatio = (100 - remainingPercent) / 100;

  const breakdown = calculateScoreBreakdown(
    usedFences, parFences, actualRemovedRatio, requiredRemovedRatio, loadedConfig, spaceBonusMultiplier
  );

  // Guard against a NaN/negative scoreMultiplier leaking in from bad config.
  const safeMultiplier = Number.isFinite(scoreMultiplier) && scoreMultiplier > 0 ? scoreMultiplier : 1;
  const safeExtra = Number.isFinite(extraBonus) && extraBonus > 0 ? extraBonus : 0;
  const multipliedBase = Math.floor(basePoints * breakdown.performanceMultiplier * safeMultiplier);
  const rawScore = multipliedBase + breakdown.totalBonus + safeExtra;
  // Stock Options capstone: a flat raise on the per-map ceiling. Everything
  // still folds under a cap, it's just a higher one for the rest of the run.
  const safeCapBonus = Number.isFinite(overtimeCapBonus) && overtimeCapBonus > 0 ? overtimeCapBonus : 0;
  const cap = getOvertimeCap(basePoints, loadedConfig.scoring.overtimeCapHeadroom) + safeCapBonus;
  // Pickup overtime lands OUTSIDE the cap (a deliberate, small inflation valve:
  // tokens must feel rewarding even on a capped map — see game-config.yml).
  const safePostCap = Number.isFinite(postCapBonus) && postCapBonus > 0 ? Math.round(postCapBonus) : 0;
  const levelScore = Math.max(0, Math.min(rawScore, cap)) + safePostCap;

  return { levelScore, breakdown };
}
