/**
 * Assignments (issue #60) — the every-5th-level "Next Assignment" draft, reworked
 * from flat 5-map buff doors into multi-map MISSIONS.
 *
 * Accepting an assignment takes on a CONSTRAINT (a modifier curse and/or a
 * behavioral rule like disabling Push Your Luck) for the whole 5-map block, and
 * sets a MISSION: a task tracked across those maps. Clearing a mission tier pays
 * a REWARD. Skipping is neutral (no constraint, no mission, no reward), which is
 * what makes the pick a real decision.
 *
 * Condition kinds reuse the per-map objective evaluator (src/lib/mapObjectives.ts,
 * ObjectiveKind) so no new physics wiring is needed: they read the same per-map
 * counters (locks, superior locks, cuts vs par, clear seconds, ball count).
 *
 * Defined in public/assignments.yml; constraint `modifiers` use the same
 * GameModifiers keys as upgrades/loadouts/doors. English is the source of truth
 * (locale files may override via content.assignments.<id>.*). No em-dashes in
 * displayed strings.
 */
import type { ObjectiveKind } from '@/types/objective';
import type { UpgradeTier } from '@/types/upgrade';

/** Per-map condition a mission tracks. Subset of ObjectiveKind that reads a live counter. */
export type AssignmentConditionKind =
  | Extract<
      ObjectiveKind,
      'lockCount' | 'superiorLocks' | 'underPar' | 'speedClear' | 'allBallsLocked'
    >
  /**
   * Seal a NAMED ball type. Deliberately not part of ObjectiveKind: a boss
   * objective draws from a shared pool with its own eligibility rules, and this
   * only makes sense once something has picked a type for the block.
   */
  | 'ballType'
  /** Clear the map without sealing a single ball. */
  | 'noLocks'
  /** Breakables destroyed, summed over the block. */
  | 'smashCount'
  /**
   * Finish the map without losing a life.
   *
   * The first mission about SURVIVING rather than producing. Every other kind
   * rewards throughput, which pushes toward aggressive cuts; this one pays for
   * backing off, so it argues with the rest of a build instead of stacking
   * with it.
   */
  | 'noLivesLost'
  /**
   * Buy nothing from the store in the visit that follows this map.
   *
   * The only condition that is not about the board at all. Spend is recorded
   * against the map it follows, because that is the visit the player earned
   * with it. Note a five-map block only offers FOUR visits: its last map is the
   * assignment level, whose store is replaced by the contract phase, so that
   * map passes for free.
   */
  | 'noSpend'
  /**
   * Push Your Luck bets won, summed over the block.
   *
   * A whole decision layer no mission touched. Two assignments FORBID pushing
   * as a constraint; none made it the point.
   */
  | 'pushesWon';

/** How a condition is tracked across the 5-map block. */
export type AssignmentTrack =
  // Sum a metric over the block (e.g. total locks across 5 maps). `params` tunes
  // the per-map condition when `everyMap`, and is ignored here except `count`.
  | { mode: 'cumulative'; kind: AssignmentConditionKind; params?: Record<string, number>; ballType?: string }
  // Pass the per-map condition in at least `minMaps` of the block (default 5).
  | { mode: 'everyMap'; kind: AssignmentConditionKind; params?: Record<string, number>; minMaps?: number; ballType?: string };

/**
 * A reward paid when a mission tier is reached at block end:
 * - `lives`     grant N extra lives immediately.
 * - `overtime`  bank N overtime hours immediately.
 * - `modifiers` add a good/bad bundle for the rest of the `run` or the next
 *               `block`; `requiresUpgradeId` gates "enhance an owned upgrade"
 *               rewards so they only pay when the base upgrade is owned.
 * - `tierDraft` interrupt for a 1-of-3 upgrade pick of `tier` (the tough reward).
 */
export type AssignmentReward =
  | { type: 'lives'; count: number }
  | { type: 'overtime'; hours: number }
  | { type: 'modifiers'; blessing: string; modifiers: Record<string, number>; scope: 'run' | 'block'; requiresUpgradeId?: string }
  | { type: 'tierDraft'; tier: UpgradeTier };

/** One threshold on the mission ladder. Tiers ascend by `threshold`. */
export interface AssignmentTier {
  /** cumulative: total metric needed; everyMap: maps-passed needed. */
  threshold: number;
  /** Short displayed reward label (e.g. "+2 lives"); English source of truth. */
  label: string;
  reward: AssignmentReward;
}

/** The constraint taken on by ACCEPTING an assignment (skip avoids it). */
export interface AssignmentConstraint {
  /** Red curse text shown on the card. */
  text: string;
  /** GameModifiers bundle applied for the whole block (like a door's curse). */
  modifiers?: Record<string, number>;
  /** Behavioral: Push Your Luck is disabled on every map of the block. */
  disablePushYourLuck?: boolean;
}

/** The multi-map task. */
export interface AssignmentMission {
  /** One-line task text (e.g. "Lock at least 2 balls each map"). */
  text: string;
  track: AssignmentTrack;
  /** 1+ ascending tiers; a single tier is a simple pass/fail mission. */
  tiers: AssignmentTier[];
}

/** One authored assignment (public/assignments.yml). English source of truth. */
export interface AssignmentConfig {
  id: string;
  name: string;
  /** Optional; a pure-upside assignment has no constraint (skip is then rarely worth it). */
  constraint?: AssignmentConstraint;
  mission: AssignmentMission;
  /** Longer hold-to-clarify explainer text. */
  clarify?: string;
}

export interface AssignmentData {
  assignments: AssignmentConfig[];
  /** Completed-level threshold at/past which assignments start (cadence N). */
  offeredAfterLevel?: number;
}

/** One finished map's metrics, captured at clear for multi-map mission evaluation. */
export interface AssignmentMapResult {
  locks: number;
  superiorLocks: number;
  /** cuts used minus par (<= 0 means at/under par). */
  cutsDelta: number;
  clearSeconds: number;
  ballCount: number;
  allBallsLocked: boolean;
  /** Balls sealed this map by ball type id, for a `ballType` bounty. */
  lockedByType?: Record<string, number>;
  /** Breakables destroyed this map, smashed or toppled. */
  smashes?: number;
  /** Lives lost during this map (0 on a clean one). */
  livesLost?: number;
  /** Overtime spent in the store visit that FOLLOWED this map. */
  spent?: number;
  /** True when a Push Your Luck bet was taken on this map and banked. */
  pushWon?: boolean;
}
