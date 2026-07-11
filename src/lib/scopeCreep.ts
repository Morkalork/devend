/**
 * Scope Creep — the anti-stall time pressure.
 *
 * After a grace window of ACTIVE play (physics steps only; pause, menus and
 * the push prompt do not count), ball speed surges in discrete steps until it
 * caps. It punishes indefinite waiting with risk rather than score: a player
 * who plans and executes within the grace window never sees it, while sitting
 * out the clock for a perfect alignment makes the board progressively hotter.
 * The factor scales the per-step ball DISPLACEMENT (see updateBall), never the
 * stored velocity, so it cannot compound and ball abilities that rescale
 * velocity to absolute targets (grey wind-down, yellow variable speed, the
 * minimum-speed floor) are untouched.
 *
 * Tuning lives in public/game-config.yml under `scope_creep`.
 */

export interface ScopeCreepConfig {
  /** Seconds of active play before the first surge (the first surge lands AT this mark). */
  graceSeconds: number;
  /** Seconds between surges after the grace window. */
  stepSeconds: number;
  /** Ball speed added per surge, in percent. */
  stepPercent: number;
  /** Maximum number of surges (0 disables the mechanic entirely). */
  maxSteps: number;
}

export const DEFAULT_SCOPE_CREEP: ScopeCreepConfig = {
  graceSeconds: 45,
  stepSeconds: 15,
  stepPercent: 8,
  maxSteps: 4,
};

/** True when every config field is a usable finite number. */
function isUsable(cfg: ScopeCreepConfig): boolean {
  return (
    Number.isFinite(cfg.graceSeconds) && cfg.graceSeconds >= 0 &&
    Number.isFinite(cfg.stepSeconds) && cfg.stepSeconds > 0 &&
    Number.isFinite(cfg.stepPercent) && cfg.stepPercent > 0 &&
    Number.isFinite(cfg.maxSteps) && cfg.maxSteps > 0
  );
}

/**
 * Number of surges that have landed after `activeSeconds` of active play.
 * 0 before the grace mark; the first surge lands exactly AT graceSeconds,
 * then one more per stepSeconds, capped at maxSteps.
 */
export function creepStep(activeSeconds: number, cfg: ScopeCreepConfig): number {
  if (!isUsable(cfg) || !Number.isFinite(activeSeconds) || activeSeconds < cfg.graceSeconds) return 0;
  return Math.min(cfg.maxSteps, Math.floor((activeSeconds - cfg.graceSeconds) / cfg.stepSeconds) + 1);
}

/** Displacement multiplier for the current creep step (1 = no creep). */
export function creepFactor(activeSeconds: number, cfg: ScopeCreepConfig): number {
  const step = creepStep(activeSeconds, cfg);
  if (step === 0) return 1; // also shields against NaN config (0 * NaN = NaN)
  return 1 + (step * cfg.stepPercent) / 100;
}
