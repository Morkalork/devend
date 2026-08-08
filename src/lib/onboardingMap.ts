/**
 * The onboarding map: a first-run-only "learn the loop" board.
 *
 * A brand new player's very first map is this one: an empty board with a single
 * ball and nothing else, so the only thing to learn is the core loop (draw a
 * fence, fence the ball into a smaller and smaller pocket). It is NOT authored
 * in public/map.yml, because it is not part of the level rotation: it takes over
 * slot 1 of the sequence exactly once, and from the player's second run onwards
 * the real level-1 map is played instead. That frees L1-3 to be proper (if
 * gentle) maps rather than three teaching set-pieces every single run.
 *
 * Wiring:
 * - useLevelManager swaps it into the first sequence slot while
 *   `shouldShowOnboarding` is true (it is excluded from the normal variant pool).
 * - It keeps level number 1, so everything keyed on the level number (the
 *   interactive fence tutorial, the no-time-limit tutorial band, music, pickup
 *   gates, assignment cadence) behaves exactly as it does for a normal level 1.
 * - useGameSession marks it seen when it is COMPLETED, so quitting part way
 *   through still gets the lesson next time.
 * - The flag lives with the other one-time tutorials, so "Re-enable All
 *   Tutorials" in Options brings this map back too.
 */
import type { LevelConfig } from '@/types/level';

/** Sequence/save id of the onboarding map (never appears in map.yml). */
export const ONBOARDING_MAP_ID = 'onboarding';

/**
 * The map itself: empty board, one ball, generous clear target, no random
 * mini-obstacles (the default is 20%) and no pickups, so the first minute of
 * the game has exactly one idea in it.
 */
export const ONBOARDING_MAP: LevelConfig = {
  id: ONBOARDING_MAP_ID,
  level: 1,
  sizeThreshold: 40, // win at <= 40% of the board remaining
  expectedCuts: 2,
  points: 20,
  variety: 0,
  randomShapes: 0,
  pickupChance: 0,
  maxBalls: 1,
  entities: [],
};

/** True when a level config is the onboarding map. */
export function isOnboardingMap(level: Pick<LevelConfig, 'id'> | null | undefined): boolean {
  return level?.id === ONBOARDING_MAP_ID;
}
