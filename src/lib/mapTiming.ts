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

/** True for the tutorial band that ignores both the time limit and Ship Early. */
export function isTimingExempt(levelNumber: number): boolean {
  return levelNumber <= TIME_LIMIT_EXEMPT_MAX_LEVEL;
}

/**
 * Effective time limit (active-play seconds) for a map, or null when the level
 * is exempt. A map may set a larger `timeLimit`; absent/invalid falls back to
 * DEFAULT_MAP_TIME_LIMIT.
 */
export function getMapTimeLimit(
  level: Pick<LevelConfig, 'timeLimit'>,
  levelNumber: number,
): number | null {
  if (isTimingExempt(levelNumber)) return null;
  const t = level.timeLimit;
  return typeof t === 'number' && t > 0 ? t : DEFAULT_MAP_TIME_LIMIT;
}
