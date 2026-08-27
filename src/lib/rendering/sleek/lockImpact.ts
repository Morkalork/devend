/**
 * The moment a lock lands, as geometry.
 *
 * Sealing a ball is the whole economy: a plain clear pays almost nothing beside
 * it, and the map is a race to set one up. But an ordinary lock announced
 * itself with a pocket tint that fades and a puff of dust, which is the same
 * weight the game gives a wall bounce. Only a SUPERIOR lock got rings, so the
 * payoff you land most often is the one that lands softest.
 *
 * This is the thump underneath it: a core that snaps bright at the catch point
 * and a single ring driven out of it. Not the superior rings - those stay,
 * bigger and tripled and struck from the pocket's centre, so a superior lock
 * still reads as the better thing. This is the floor, so that every lock has a
 * physical moment rather than only the good ones.
 *
 * At the CATCH POINT rather than the pocket's centre, because that is where the
 * eye already is: the player has been watching that ball, and the acknowledgement
 * should arrive where they are looking rather than somewhere they have to find.
 */

/** The whole thump is over in this fraction of the flash: it is a hit, not a glow. */
export const IMPACT_FRACTION = 0.55;

export interface LockImpact {
  /** Expanding shockwave, in screen pixels from the catch point. */
  ringRadius: number;
  ringAlpha: number;
  ringWidth: number;
  /** The bright core at the instant of the catch. Zero once it has snapped out. */
  coreRadius: number;
  coreAlpha: number;
}

/**
 * The impact at `t` (0 to 1 through the flash), or null once it is spent.
 *
 * `scale` is the board's world-to-screen scale, so the thump is the same size
 * on the board whatever the screen.
 */
export function lockImpact(t: number, scale: number): LockImpact | null {
  if (!(t >= 0) || t >= IMPACT_FRACTION) return null;

  // Its own clock, running 0 to 1 across just the impact window, so the ring
  // completes early in the flash and the pocket tint is left to drain alone.
  const k = t / IMPACT_FRACTION;

  // Out fast, then decelerating: an expanding ring at constant speed reads as a
  // circle being drawn, and a decelerating one reads as something struck.
  const eased = 1 - Math.pow(1 - k, 2.2);

  return {
    ringRadius: eased * 58 * scale,
    ringAlpha: Math.pow(1 - k, 1.7) * 0.7,
    ringWidth: Math.max(1, (1 - k * 0.6) * 2.6 * scale),
    // The core is the first sixth of the impact only: a hard flash at the catch
    // point that is gone before the ring has travelled.
    coreRadius: k < 0.16 ? (0.35 + k / 0.16) * 9 * scale : 0,
    coreAlpha: k < 0.16 ? (1 - k / 0.16) * 0.9 : 0,
  };
}
