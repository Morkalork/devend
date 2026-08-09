/**
 * Lock decision diagnostics.
 *
 * A lock that "shouldn't have been a lock" is nearly impossible to diagnose
 * after the fact: the pocket is gone, the tint on screen is ordinary capture
 * shading, and the only lasting evidence is a counter that went up by one. This
 * records the inputs to every lock decision at the moment it is made.
 *
 * It records REJECTED candidates too. "Why did that lock?" and "why did that
 * NOT lock?" are the same question asked from either side, and a rejection with
 * its numbers attached is often the more informative of the two.
 *
 * Findings are kept in a ring buffer rather than logged: this fires on a phone
 * against a deployed build, where there is no console to read.
 */

export const LOCK_DEBUG_KEY = 'devend:lockDebug';

/** Why a candidate did or did not become a lock. */
export type LockOutcome =
  /** Passed every gate and locked. */
  | 'locked'
  /** Region small enough, but the pocket still opened onto living space. */
  | 'rejected-unsealed'
  /** Region too large to be a candidate at all (the common, boring case). */
  | 'below-gate';

export interface LockDecision {
  ballId: string;
  ballColor: string;
  isBoss: boolean;
  /** Cells in the ball's region: the pocket size actually being judged. */
  regionCells: number;
  /**
   * What regionCells is measured against. Grows as balls lock (it is
   * `max(currentActive, initialActive / activeBalls)`), so an unchanged pocket
   * size gets progressively easier to lock as a map empties out - the prime
   * suspect whenever a late lock feels unearned.
   */
  denominator: number;
  /** regionCells as a percentage of denominator. */
  percentage: number;
  /** The bar `percentage` had to clear. */
  thresholdPercent: number;
  lockedByPercent: boolean;
  /** Absolute cell-count floor, independent of the percentage. */
  lockedBySliver: boolean;
  /** Sealed within a colored area, which locks regardless of size. */
  containedInArea: boolean;
  /**
   * isRegionTrulySealed's verdict, or null when no pre-capture snapshot was
   * passed and the check was skipped entirely.
   */
  trulySealed: boolean | null;
  outcome: LockOutcome;
}

const RING_SIZE = 40;
const ring: LockDecision[] = [];
let enabled: boolean | null = null;

function readFlag(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(LOCK_DEBUG_KEY) === '1';
  } catch {
    return false; // private mode / blocked storage: never break the game loop
  }
}

/**
 * Cached, because this is consulted per ball per cut and localStorage reads are
 * not free. Flipping the flag calls setLockDebugEnabled, which refreshes it.
 */
export function isLockDebugEnabled(): boolean {
  if (enabled === null) enabled = readFlag();
  return enabled;
}

export function setLockDebugEnabled(on: boolean): void {
  enabled = on;
  try {
    if (on) localStorage.setItem(LOCK_DEBUG_KEY, '1');
    else localStorage.removeItem(LOCK_DEBUG_KEY);
  } catch {
    /* storage blocked: the in-memory flag still holds for this session */
  }
  if (!on) ring.length = 0;
}

export function recordLockDecision(decision: LockDecision): void {
  if (!isLockDebugEnabled()) return;
  ring.push(decision);
  if (ring.length > RING_SIZE) ring.shift();
}

/** Newest first, so an overlay can render the top N without reversing. */
export function getLockDecisions(): LockDecision[] {
  return [...ring].reverse();
}

export function clearLockDecisions(): void {
  ring.length = 0;
}

/** Test seam: forget the cached flag so a fresh localStorage value is read. */
export function resetLockDebugCache(): void {
  enabled = null;
}
