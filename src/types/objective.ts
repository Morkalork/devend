/**
 * Per-map objectives (issue #55): an optional secondary goal rolled per eligible
 * map (level >= PROCEDURAL_MIN_LEVEL) from the run seed. It changes the optimal
 * line of play on a familiar board and pays a small overtime bonus, folded UNDER
 * the per-map cap (issue #43). Optional and NON-failing this iteration: the
 * primary clear condition is unchanged; missing the objective just skips the
 * bonus.
 *
 * Objectives are PURE evaluations of existing per-map counters (locks, superior
 * locks, cuts used, active seconds), so no new physics event wiring is needed:
 * the evaluator reads the state those events already maintain. See
 * src/lib/mapObjectives.ts.
 */

/**
 * What an objective measures:
 * - `lockCount`     lock at least `count` balls this map.
 * - `superiorLocks` land at least `count` SUPERIOR locks (tight pockets).
 * - `underPar`      clear using at most `par + delta` cuts (delta defaults 0).
 * - `speedClear`    clear within `seconds` of active play.
 */
export type ObjectiveKind = "lockCount" | "superiorLocks" | "underPar" | "speedClear";

/** One authored objective entry (public/objectives.yml). English source of truth. */
export interface MapObjective {
  id: string;
  name: string;
  description: string;
  /** Longer hold-to-clarify explainer text. */
  clarify?: string;
  kind: ObjectiveKind;
  /** Eligible level range (inclusive). Defaults: min = PROCEDURAL_MIN_LEVEL, max = ∞. */
  minLevel?: number;
  maxLevel?: number;
  /** Relative pick weight among eligible objectives (default 1). */
  weight?: number;
  /** Tuning: `count` (lockCount/superiorLocks), `delta` (underPar), `seconds` (speedClear). */
  params?: Record<string, number>;
  /** Overtime hours awarded on clear when met, folded UNDER the per-map cap. */
  reward: number;
}

/** An objective resolved for a specific map (no per-map rolled fields yet). */
export type ActiveMapObjective = MapObjective;

/** A snapshot of the counters an objective reads. Built from live game state. */
export interface ObjectiveSnapshot {
  lockedBalls: number;
  superiorLocks: number;
  cuts: number;
  par: number;
  activeSeconds: number;
}

/** The evaluated state of an objective against a snapshot (for the HUD + award). */
export interface ObjectiveProgress {
  kind: ObjectiveKind;
  current: number;
  target: number;
  met: boolean;
}
