/** What the boss nameplate shows (canvas BossBanner). */

export interface BossBannerState {
  /** Whole seconds left on the deadline, or null on a boss with none. */
  remaining: number | null;
  /** The final ten seconds: red and pulsing. */
  urgent: boolean;
  /** One entry per HP pip, true while that hit is still standing; null for none. */
  pips: boolean[] | null;
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
