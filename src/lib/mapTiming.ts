/**
 * Map time limit — a hard per-map deadline measured in active-play seconds
 * (game.activePlaySeconds, which pauses during shops/menus/holds/recovery).
 *
 * When the clock reaches the limit the map is lost regardless of remaining
 * lives (see evaluateWinConditions). The on-screen readout reuses the Ship
 * Early countdown bar (ShipEarlyBar), which drains over this same limit.
 *
 * Levels 1..TIME_LIMIT_EXEMPT_MAX_LEVEL are the tutorial band: no time limit,
 * and (deliberately) no Ship Early bonus either, so early play stays pressure
 * free while the game is still teaching the basics.
 */
import type { LevelConfig } from '@/types/level';

export const DEFAULT_MAP_TIME_LIMIT = 60;
/** Levels with number <= this are exempt from the time limit and Ship Early. */
export const TIME_LIMIT_EXEMPT_MAX_LEVEL = 3;

/** Difficulty ramp: cut this many seconds off the DEFAULT timer... */
export const TIMER_RAMP_STEP_SECONDS = 10;
/** ...after every this many maps (level number). */
export const TIMER_RAMP_EVERY_MAPS = 10;
/** The ramp never drops the default timer below this floor. */
export const MIN_MAP_TIME_LIMIT = 30;

/** True for the tutorial band that ignores both the time limit and Ship Early. */
export function isTimingExempt(levelNumber: number): boolean {
  return levelNumber <= TIME_LIMIT_EXEMPT_MAX_LEVEL;
}

/**
 * Effective time limit (active-play seconds) for a map, or null when the level
 * is exempt.
 *
 * An explicit per-map `timeLimit` is honored AS AUTHORED (boss timers, a
 * deliberately generous map). The DEFAULT timer instead ramps DOWN with depth:
 * TIMER_RAMP_STEP_SECONDS is cut after every TIMER_RAMP_EVERY_MAPS maps
 * (10s per 10 maps), floored at MIN_MAP_TIME_LIMIT, so later maps get tighter.
 */
export function getMapTimeLimit(
  level: Pick<LevelConfig, 'timeLimit'>,
  levelNumber: number,
): number | null {
  if (isTimingExempt(levelNumber)) return null;
  const t = level.timeLimit;
  if (typeof t === 'number' && t > 0) return t; // authored timer, used as-is
  const steps = Math.floor((levelNumber - 1) / TIMER_RAMP_EVERY_MAPS);
  return Math.max(MIN_MAP_TIME_LIMIT, DEFAULT_MAP_TIME_LIMIT - steps * TIMER_RAMP_STEP_SECONDS);
}
