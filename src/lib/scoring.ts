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
import { ScoringConfig, ScoreBreakdown, ShipEarlyThreshold, AxisCeilings, BankedAxes } from '@/types/scoring';
import { bankAxes } from '@/lib/scoreAxes';
import { launchPayMultiplier } from "@/lib/launcher";
import { withheldFromPay } from "@/lib/coloredAreaShare";

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
  config: ScoringConfig,
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
 * The Performance Review axis ceilings from the loaded config, with a fallback
 * so a malformed `axes:` block degrades to the shipped balance rather than
 * paying nothing at all.
 */
export function getAxisCeilings(config: ScoringConfig = loadedConfig): AxisCeilings & {
  thriftFullAtParFraction: number; greedFullAtSlackFraction: number;
} {
  const a = config?.scoring?.axes;
  const d = DEFAULT_SCORING_CONFIG.scoring.axes;
  const num = (v: unknown, fallback: number) =>
    Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : fallback;
  return {
    delivery: num(a?.delivery, d.delivery),
    craft: num(a?.craft, d.craft),
    tempo: num(a?.tempo, d.tempo),
    thrift: num(a?.thrift, d.thrift),
    greed: num(a?.greed, d.greed),
    demolition: num(a?.demolition, d.demolition),
    thriftFullAtParFraction: num(a?.thriftFullAtParFraction, d.thriftFullAtParFraction),
    greedFullAtSlackFraction: num(a?.greedFullAtSlackFraction, d.greedFullAtSlackFraction),
  };
}

/** Every axis ceiling added up: the part of the backstop the axes account for. */
export function axisCeilingTotal(config: ScoringConfig = loadedConfig): number {
  const c = getAxisCeilings(config);
  return c.delivery + c.craft + c.tempo + c.thrift + c.greed;
}

/** The top rung of the Ship Early ladder: Tempo's denominator. */
export function getShipEarlyMaxPercent(config: ScoringConfig = loadedConfig): number {
  const m = config?.scoring?.shipEarly?.maxPercent;
  return Number.isFinite(m) && m > 0 ? m : DEFAULT_SCORING_CONFIG.scoring.shipEarly.maxPercent;
}

/**
 * Calculate the Ship Early tempo reward as a PERCENT (0-100) of the map's
 * earned overtime, paid ABOVE the per-map cap (so finishing fast is a real,
 * visible bonus rather than 3 flat hours the cap swallows). A config-driven
 * ladder keyed to how fast the win condition was first met, in ACTIVE-play
 * seconds (pauses, menus and the push prompt do not count). Windows are PER
 * BALL, so a busy map gets proportionally more time. Awards the best rung whose
 * window was met, clamped at `maxPercent`; null/undefined = "no clear time
 * recorded" and pays nothing.
 */
export function calculateShipEarlyPercent(
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
  // Hard Deadline door: scales the payout AFTER the maxPercent clamp (the door
  // widens what the ladder pays, it does not unlock higher rungs).
  const mult = Number.isFinite(bonusMultiplier) && bonusMultiplier > 0 ? bonusMultiplier : 1;

  const { maxPercent, thresholds } = config.scoring.shipEarly;
  let percent = 0;
  for (const step of thresholds) {
    if (clearedActiveSeconds <= (step.withinSecondsPerBall + extra) * balls) {
      percent = Math.max(percent, step.percent);
    }
  }
  return Math.min(percent, maxPercent) * mult;
}

/** Ship Early reward percent (0-100) from the preloaded config. */
export function getShipEarlyPercent(
  clearedActiveSeconds: number | null | undefined,
  ballCount: number,
  extraSecondsPerBall: number = 0,
  bonusMultiplier: number = 1,
): number {
  return calculateShipEarlyPercent(clearedActiveSeconds, ballCount, loadedConfig, extraSecondsPerBall, bonusMultiplier);
}

/** The Ship Early ladder from the preloaded config (drives the countdown bar). */
export function getShipEarlyThresholds(): ShipEarlyThreshold[] {
  return loadedConfig.scoring.shipEarly.thresholds;
}

/**
 * Bank a level's five axes and shape the result into a ScoreBreakdown.
 *
 * `underParBonus` and `spaceBonus` keep their old names because the
 * level-complete payload, the highscore ledger and the results overlay all
 * read them; they are now simply Thrift's and Greed's payouts. The full
 * banking, with per-axis ratios and ceilings, rides along in `axes`.
 */
export function calculateScoreBreakdown(
  usedFences: number,
  parFences: number,
  actualRemovedRatio: number,
  requiredRemovedRatio: number,
  config: ScoringConfig,
  spaceBonusMultiplier: number = 1,
  underParBonusMultiplier: number = 1,
  axisInput: Partial<LockAxisInput> & {
    shipEarlyPercent?: number;
    tempoCeilingMultiplier?: number;
    lockPayoutMultiplier?: number;
    flatGreedBonus?: number;
    smashedHits?: number;
    totalSmashableHits?: number;
  } = {},
): ScoreBreakdown {
  const { multiplier: performanceMultiplier, fencesOverPar, fencesUnderPar } =
    getPerformanceMultiplier(usedFences, parFences, config);

  const ceilings = getAxisCeilings(config);
  const axes = bankAxes({
    lockedCapacity: axisInput.lockedCapacity ?? 0,
    totalCapacity: axisInput.totalCapacity ?? 0,
    premiumEarned: axisInput.premiumEarned ?? 0,
    premiumAvailable: axisInput.premiumAvailable ?? 0,
    usedFences, parFences, actualRemovedRatio, requiredRemovedRatio,
    shipEarlyPercent: axisInput.shipEarlyPercent ?? 0,
    shipEarlyMaxPercent: getShipEarlyMaxPercent(config),
    flatGreedBonus: axisInput.flatGreedBonus ?? 0,
    smashedHits: axisInput.smashedHits ?? 0,
    totalSmashableHits: axisInput.totalSmashableHits ?? 0,
    thriftCeilingMultiplier: underParBonusMultiplier,
    greedCeilingMultiplier: spaceBonusMultiplier,
    tempoCeilingMultiplier: axisInput.tempoCeilingMultiplier ?? 1,
    lockPayoutMultiplier: axisInput.lockPayoutMultiplier ?? 1,
    fencesOverPar,
    thriftFullAtParFraction: ceilings.thriftFullAtParFraction,
    greedFullAtSlackFraction: ceilings.greedFullAtSlackFraction,
  }, ceilings);

  // Greed before the 3-over-par gate, so the overlay can still show what the
  // clearing WOULD have paid (the old spaceBonusRaw, same job).
  const spaceBonusRaw = fencesOverPar >= 3
    ? Math.round(axes.ceilings.greed
        * Math.min(1, Math.max(0, (actualRemovedRatio - requiredRemovedRatio))
          / Math.max(1e-9, (1 - requiredRemovedRatio) * ceilings.greedFullAtSlackFraction)))
    : axes.greed;

  return {
    underParBonus: axes.thrift,
    spaceBonus: axes.greed,
    spaceBonusRaw,
    performanceMultiplier,
    totalBonus: axes.total,
    fencesUnderPar,
    fencesOverPar,
    // Kept for the overlay's "+N% extra" readout: now the share of the leftover
    // slack consumed, which is the figure Greed is actually scored on.
    extraPercent: requiredRemovedRatio >= 1 ? 0
      : Math.max(0, actualRemovedRatio - requiredRemovedRatio) / (1 - requiredRemovedRatio),
    lockBonus: axes.delivery + axes.craft,
    axes,
  };
}

/** The lock-capacity half of the axis input, shared by the call sites. */
export interface LockAxisInput {
  lockedCapacity: number;
  totalCapacity: number;
  premiumEarned: number;
  premiumAvailable: number;
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
  // `slackTaken` is the share of the leftover board consumed, which is what the
  // Greed axis is actually scored on. The old preview varied "percent over the
  // requirement", a figure that stopped meaning anything once requirements got
  // past about 90%: at level 29 the entire remaining slack is 7% of the board.
  const scenarios = [
    { label: 'Under par (-2), most of the slack', fenceOffset: -2, slackTaken: 0.70 },
    { label: 'At Par, half the slack', fenceOffset: 0, slackTaken: 0.50 },
    { label: 'Par +1, a third of the slack', fenceOffset: 1, slackTaken: 0.33 },
    { label: 'Par +2, a third of the slack', fenceOffset: 2, slackTaken: 0.33 },
    { label: 'Par +3, most of the slack (Greed off)', fenceOffset: 3, slackTaken: 0.70 },
  ];

  return scenarios.map((scenario) => {
    const usedFences = Math.max(1, parFences + scenario.fenceOffset);
    const slack = Math.max(0, 1 - requiredRemovedRatio);
    const actualRemovedRatio = Math.min(1, requiredRemovedRatio + slack * scenario.slackTaken);
    const breakdown = calculateScoreBreakdown(usedFences, parFences, actualRemovedRatio, requiredRemovedRatio, config);
    const rawScore = Math.floor(basePoints * breakdown.performanceMultiplier) + breakdown.totalBonus;
    const cap = getOvertimeCap(basePoints, config.scoring.overtimeCapHeadroom) + axisCeilingTotal(config);
    const earnedScore = Math.max(0, Math.min(rawScore, cap));
    return { label: scenario.label, usedFences, actualRemovedRatio, breakdown, earnedScore };
  });
}

// ── Config loading ─────────────────────────────────────────────────────────

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  scoring: {
    overtimeCapHeadroom: 4.0,
    axes: {
      delivery: 30, craft: 30, tempo: 24, thrift: 20, greed: 25, demolition: 35,
      thriftFullAtParFraction: 0.40,
      greedFullAtSlackFraction: 0.60,
    },
    lockValue: 12,
    lockQuality: {
      superiorThresholdFraction: 0.4,
      superiorMultiplier: 2.0,
    },
    lampLockMultiplier: 1.5,
    highscoreBonusMultiplier: 1.25,
    shipEarly: {
      maxPercent: 30,
      thresholds: [
        { withinSecondsPerBall: 6, percent: 30 },
        { withinSecondsPerBall: 10, percent: 20 },
        { withinSecondsPerBall: 15, percent: 10 },
      ],
    },
    performanceMultiplier: {
      underPar: 1.0,
      atPar: 1.0,
      overPar1: 0.6,
      overPar2: 0.4,
      overPar3Plus: 0.2,
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
            axes: { ...DEFAULT_SCORING_CONFIG.scoring.axes, ...parsed.scoring.axes },
            lockQuality: { ...DEFAULT_SCORING_CONFIG.scoring.lockQuality, ...parsed.scoring.lockQuality },
            lampLockMultiplier: parsed.scoring.lampLockMultiplier ?? DEFAULT_SCORING_CONFIG.scoring.lampLockMultiplier,
            highscoreBonusMultiplier: parsed.scoring.highscoreBonusMultiplier ?? DEFAULT_SCORING_CONFIG.scoring.highscoreBonusMultiplier,
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

/**
 * What sealing the lit ball pays, on top of everything else (scoring-config).
 *
 * Guarded to 1 on a bad config rather than NaN: the lamp is a bonus, so the
 * failure mode has to be "no bonus", never "no pay".
 */
export function getLampLockMultiplier(): number {
  const m = loadedConfig.scoring?.lampLockMultiplier;
  return Number.isFinite(m) && m > 0 ? m : DEFAULT_SCORING_CONFIG.scoring.lampLockMultiplier;
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
  /** Upgrade/loadout/door score multiplier. Scales the flat map base only,
   *  as it always has: the axes are bounded by their own ceilings. */
  scoreMultiplier?: number;
  /** The map's lock capacity and the quality premium earned against it: the
   *  raw material for the Delivery and Craft axes. */
  locks?: LockAxisInput;
  /** Push-your-luck hours, which bank into Greed: the same bet as clearing
   *  past the requirement, staying on a cleared board for more of it.
   *  Demolition hours USED to ride along here and no longer do - Greed's pot
   *  is shared with clearing, so on any map where you also cleared they were
   *  swallowed. See the demolition axis. */
  greedBonus?: number;
  /** Authored hits of the map's breakables, smashed and offered: the Demolition
   *  axis. Read with demolitionProgress(game.destructibles). */
  demolition?: { smashedHits: number; totalSmashableHits: number };
  /** Hours that belong to no axis and are simply owed: the map mutator's
   *  hazard premium, an objective's reward, and the Stock Options capstone,
   *  which used to raise a ceiling that no longer binds anything. */
  flatBonus?: number;
  /** Overdelivery: raises the THRIFT ceiling (default 1). */
  underParBonusMultiplier?: number;
  /** Tech Evangelist: raises the GREED ceiling (default 1). */
  spaceBonusMultiplier?: number;
  /** Hard Deadline: raises the TEMPO ceiling (default 1). */
  tempoCeilingMultiplier?: number;
  /** Pickup overtime tokens: paid outside the axes, like flatBonus, so a
   *  claimed token always pays exactly what it said it would (default 0). */
  postCapBonus?: number;
  /** The Ship Early ladder's awarded percent, which Tempo is scored on. */
  shipEarlyPercent?: number;
  /**
   * The power the map's launcher was fired at, multiplying the flat base.
   *
   * Absent or 1 on every map without a launcher, which is what keeps the other
   * 34 maps scoring exactly as they did.
   */
  launchPower?: number;
  /**
   * The map's win premium, in percent, from the win conditions it actually met
   * (see winSpec.ts). Scales the map's EARNED pay - the flat base plus the five
   * axes - and nothing else: pickups, objective rewards and the mutator's
   * hazard premium are owed for their own reasons and are not made more
   * valuable by the map having asked something hard.
   *
   * This is the first thing in the economy that makes one map worth more than
   * another. Every map carries `points: 20`, so a genuinely harder win has
   * always paid exactly what an easy one did.
   */
  winBonusPercent?: number;
  /**
   * Demolition multiplier (issue #38): x1.15 per break, compounding. It scales
   * DELIVERY and CRAFT rather than the whole payout, because lock income is
   * what stopping to smash things actually costs you - the time came out of
   * Tempo, so the offset belongs on the axes you traded it for.
   */
  payoutMultiplier?: number;
  /**
   * Share of the map's pay withheld because its colored areas were not taken,
   * 0..1. See lib/coloredAreaShare: 0.4 x the fraction of areas missed.
   */
  zoneShareMissed?: number;
}

/**
 * Calculate the overtime reward for a level, using the preloaded config.
 *
 * The five axes each bank ceiling x ratio independently (see scoreAxes.ts),
 * the flat map base rides on top scaled by the performance multiplier, and
 * `overtimeCapHeadroom` sits far above all of it as a backstop against a
 * runaway upgrade stack. It is deliberately no longer the binding constraint:
 * as a binding cap it discarded most of what a skilled run earned and left
 * Ship Early - the one bonus paid above it - as the only thing that decided a
 * score.
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
  /** Tempo's payout, under its old name for the call sites and the overlay. */
  shipEarlyBonus: number;
  /** What each axis banked, for the results screen. */
  axes: BankedAxes;
  /** Hours the map's win conditions added on top of its earned pay. */
  winBonus: number;
} {
  const {
    scoreMultiplier = 1, locks, greedBonus = 0, demolition, flatBonus = 0, postCapBonus = 0,
    payoutMultiplier = 1, shipEarlyPercent = 0, underParBonusMultiplier = 1,
    spaceBonusMultiplier = 1, tempoCeilingMultiplier = 1, winBonusPercent = 0,
  } = options;
  const requiredRemovedRatio = (100 - thresholdPercent) / 100;
  const actualRemovedRatio = (100 - remainingPercent) / 100;

  const breakdown = calculateScoreBreakdown(
    usedFences, parFences, actualRemovedRatio, requiredRemovedRatio, loadedConfig,
    spaceBonusMultiplier, underParBonusMultiplier,
    {
      lockedCapacity: locks?.lockedCapacity ?? 0,
      totalCapacity: locks?.totalCapacity ?? 0,
      premiumEarned: locks?.premiumEarned ?? 0,
      premiumAvailable: locks?.premiumAvailable ?? 0,
      shipEarlyPercent,
      tempoCeilingMultiplier,
      lockPayoutMultiplier: payoutMultiplier,
      flatGreedBonus: greedBonus,
      smashedHits: demolition?.smashedHits ?? 0,
      totalSmashableHits: demolition?.totalSmashableHits ?? 0,
    },
  );

  // Guard against a NaN/negative scoreMultiplier leaking in from bad config.
  const { zoneShareMissed = 0, launchPower = 1 } = options;
  const safeMultiplier = Number.isFinite(scoreMultiplier) && scoreMultiplier > 0 ? scoreMultiplier : 1;
  // A launcher map is bought at the power it was fired at. It multiplies the
  // BASE and nothing else, which is the one term no axis ceiling can swallow:
  // routed through lock quality it would bank into Craft, and Craft is capped
  // with several routes to the same ceiling, so a hard shot on a map where
  // superior locks were already available would have paid exactly nothing.
  // See src/lib/launcher.ts. 1 on every map without a launcher.
  const launchMult = launchPayMultiplier(launchPower);
  const multipliedBase = Math.floor(
    basePoints * breakdown.performanceMultiplier * safeMultiplier * launchMult,
  );
  const safeFlat = Number.isFinite(flatBonus) && flatBonus > 0 ? Math.round(flatBonus) : 0;
  const safePostCap = Number.isFinite(postCapBonus) && postCapBonus > 0 ? Math.round(postCapBonus) : 0;

  // The win premium scales the map's own earned pay. Applied before the
  // backstop, so a runaway authored percent is still caught by it.
  const safeWinPct = Number.isFinite(winBonusPercent) && winBonusPercent > 0 ? winBonusPercent : 0;
  // Colored areas carry a share of what the MAP pays, which is the base plus
  // the axes - not basePoints alone. basePoints feeds only the first term:
  // on a level-3 run it was 20h of a 130h payout, so withholding 40% of it
  // cost 8h, about 6% of the map, and the change was invisible in play. The
  // share has to come off mapPay or it does not mean what the number says.
  //
  // Only ever off a POSITIVE pay. A map where Tempo has driven the total
  // negative must not have its penalty softened by ignoring the zones.
  const grossMapPay = multipliedBase + breakdown.axes.total;
  const zoneShareWithheld = withheldFromPay(grossMapPay, zoneShareMissed);
  breakdown.multipliedBase = multipliedBase;
  // What the map could have paid: the base plus every lane at its own ceiling.
  // The player's ceiling multipliers are already inside axes.ceilings, so this
  // is THEIR maximum on this map rather than a generic one.
  const c = breakdown.axes.ceilings;
  breakdown.mapCeiling =
    multipliedBase + c.delivery + c.craft + c.tempo + c.thrift + c.greed;
  const mapPay = grossMapPay - zoneShareWithheld;
  breakdown.zoneShareWithheld = zoneShareWithheld;
  const winBonus = Math.round(mapPay * safeWinPct / 100);
  const earned = mapPay + winBonus + safeFlat + safePostCap;
  // The backstop bounds the BASE and the flat bonuses, never the axes: the five
  // ceilings already bound those, and they are absolute hours while the base is
  // per-map. Clamping the sum against a multiple of basePoints would clip axis
  // income on any map with a low `points:` value, which is precisely the bug
  // this rework exists to remove - a skilled run losing what it earned.
  const backstop = getOvertimeCap(basePoints, loadedConfig.scoring.overtimeCapHeadroom)
    + axisCeilingTotal(loadedConfig);
  const levelScore = Math.max(0, Math.min(earned, backstop));

  return {
    levelScore, breakdown, shipEarlyBonus: breakdown.axes.tempo,
    axes: breakdown.axes, winBonus,
  };
}
