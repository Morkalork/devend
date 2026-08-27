// Scoring System Types

export interface ShipEarlyThreshold {
  /** Window in ACTIVE-play seconds PER BALL (a 4-ball map gets 4x this). */
  withinSecondsPerBall: number;
  /** Reward as a PERCENT (0-100) of the map's earned overtime, paid above the
   *  per-map cap. Finishing in the tightest window pays the most. */
  percent: number;
}

/** The five Performance Review axes, in overtime hours at full ratio. */
export interface AxisCeilings {
  delivery: number;
  craft: number;
  tempo: number;
  thrift: number;
  greed: number;
}

/** Everything bankAxes needs, gathered so call sites stay readable. */
export interface ScoreAxisInput {
  /** Lock capacity actually banked: sum of lockMultiplier x lockValue over the
   *  balls that finished locked, with no quality multipliers applied. */
  lockedCapacity: number;
  /** The same sum over the map's whole roster: what a clean sweep is worth. */
  totalCapacity: number;
  /** Hours the quality stack added on top of raw capacity (superior, zone,
   *  simultaneous, money, frozen, gravity). */
  premiumEarned: number;
  /** What the premium would be if every lock were superior and nothing else
   *  stacked: the denominator that makes a clean all-superior run a full axis. */
  premiumAvailable: number;
  usedFences: number;
  parFences: number;
  actualRemovedRatio: number;
  requiredRemovedRatio: number;
  /** The Ship Early ladder's awarded percent, and its top rung. */
  shipEarlyPercent: number;
  shipEarlyMaxPercent: number;
  /** Push-your-luck and demolition hours, which bank into Greed. */
  flatGreedBonus?: number;
  /** Upgrade multipliers, applied to axis CEILINGS rather than payouts. */
  thriftCeilingMultiplier?: number;
  greedCeilingMultiplier?: number;
  tempoCeilingMultiplier?: number;
  /** Demolition (issue #38): scales Delivery and Craft, the axes whose time
   *  you spent smashing things. */
  lockPayoutMultiplier?: number;
  /** 3+ over par switches Greed off, as the old space bonus did. */
  fencesOverPar?: number;
  thriftFullAtParFraction?: number;
  greedFullAtSlackFraction?: number;
}

/** What each axis paid, how full it is, and what it could have paid. */
export interface BankedAxes extends AxisCeilings {
  total: number;
  ratios: AxisCeilings;
  ceilings: AxisCeilings;
}

export interface ScoringConfig {
  scoring: {
    // Per-level overtime cap = round(basePoints × overtimeCapHeadroom).
    // Headroom > 1 leaves room for multiplier builds to pay off while still
    // softly bounding degenerate multiplier stacks.
    // Absolute backstop only. The axis ceilings below are the real balance;
    // this exists to catch a config or upgrade stack that runs away, and is set
    // high enough that ordinary play never reaches it.
    overtimeCapHeadroom: number;
    // The Performance Review axes. Each banks ceiling x ratio independently, so
    // maxing one never spends another's headroom - which is what stops a single
    // route dominating the way Ship Early used to.
    axes: AxisCeilings & {
      /** Under par by this fraction of par banks the whole Thrift axis. */
      thriftFullAtParFraction: number;
      /** Consuming this much of the leftover slack banks the whole Greed axis. */
      greedFullAtSlackFraction: number;
    };
    // Overtime hours per lock-multiplier point when a ball is locked away
    // (a red ball's lockMultiplier is 1, black's is 4). Locking is the main
    // income; the flat map base is deliberately below the cheapest upgrade.
    lockValue: number;
    // Superior locks: a lock whose pocket is at most superiorThresholdFraction
    // of the BASE lock threshold pays lockValue x superiorMultiplier. Keyed to
    // the base threshold so lock-threshold upgrades don't also widen this bar.
    lockQuality: {
      superiorThresholdFraction: number;
      superiorMultiplier: number;
    };
    /**
     * The Lamp: what sealing the ball currently lighting the board pays, on
     * top of everything else. Stacks with superiorMultiplier. See
     * src/lib/lampBall.ts and the note in scoring-config.yml for why this is
     * safe to tune: all of it lands in the capped Craft axis.
     */
    lampLockMultiplier: number;
    // Multiplier applied to a map's score when the player beats that map's
    // existing highscore (#45). Applied AFTER the per-map cap, so it genuinely
    // rewards a record instead of being clamped away.
    highscoreBonusMultiplier: number;
    // Ship Early tempo bonus: ladder of active-play seconds to first meet the
    // win condition, scaled by the map's ball count (windows are per ball, so
    // busy maps get proportionally more time). The clock stops when the push
    // prompt opens (or the last ball locks), so push-your-luck time is never
    // taxed. Folds under the cap.
    shipEarly: {
      /** Cap on the percent (0-100) any window can pay. */
      maxPercent: number;
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
  /** Thrift's payout. Kept under the old name so the results screen, the
   *  level-complete payload and the highscore ledger stay source-compatible. */
  underParBonus: number;
  /** Greed's payout, under its old name for the same reason. */
  spaceBonus: number;
  spaceBonusRaw: number; // Greed before the 3-over-par gate
  performanceMultiplier: number;
  totalBonus: number;
  fencesUnderPar: number;
  fencesOverPar: number;
  extraPercent: number;
  lockBonus: number; // Bonus from locking balls
  /** The full axis banking behind the numbers above. */
  axes: BankedAxes;
}

export interface ScoringPreviewScenario {
  label: string;
  usedFences: number;
  actualRemovedRatio: number;
  breakdown: ScoreBreakdown;
}
