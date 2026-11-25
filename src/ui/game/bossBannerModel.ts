/** What the boss nameplate shows (canvas BossBanner). */

export interface BossBannerState {
  /** Whole seconds left on the deadline, or null on a boss with none. */
  remaining: number | null;
  /** The final ten seconds: red and pulsing. */
  urgent: boolean;
  /** One entry per HP pip, true while that hit is still standing; null for none. */
  pips: boolean[] | null;
}

/**
 * How wide one pip is, and the gap after it. A boss ball has a handful of
 * lives and gets fat pips; a Legacy System's Core (BOSS_PLAN.md) has sixteen
 * hits or more, and the row must still fit a small phone, so the pips narrow
 * to keep the whole row near PIP_ROW_MAX.
 */
export const PIP_ROW_MAX = 220;
export function pipSize(count: number): { width: number; gap: number } {
  if (count <= 10) {
    return { width: 16, gap: 4 };
  }
  const gap = count > 24 ? 2 : 3;
  return { width: Math.max(2, Math.floor((PIP_ROW_MAX - gap * (count - 1)) / count)), gap };
}

export function bossBannerState(
  timeLimit: number | null, activeSeconds: number, hp: number, maxHp: number, defeated: boolean,
): BossBannerState {
  const remaining = timeLimit != null ? Math.max(0, Math.ceil(timeLimit - activeSeconds)) : null;
  return {
    remaining,
    urgent: remaining != null && remaining <= 10,
    // No HP pips for a single-life boss (e.g. a Colored-Area boss you just
    // fence into the zone); the health bar only shows for multi-hit bosses.
    pips: !defeated && maxHp > 1 ? Array.from({ length: maxHp }, (_, i) => i < hp) : null,
  };
}
