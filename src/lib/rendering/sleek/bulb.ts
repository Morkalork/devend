/**
 * The gradients that make a ball read as a lamp rather than as a lit sphere.
 *
 * Split out of ballLayer's canvas bakes for the reason the rest of this
 * renderer splits its arithmetic out (ballTrail, lockImpact, gravityCue,
 * compassRing): a curve that is subtly wrong is invisible in review and obvious
 * in play. It matters more here than usual, because a 2D canvas context does
 * not exist in a test environment, so anything left inside the bake cannot be
 * checked at all.
 *
 * Two curves, and the properties that make them work are not obvious from the
 * numbers, so they are pinned in bulb.test.ts:
 *
 *   THE BODY has no dark side. The old bake ended at PALETTE.shadow, the
 *     terminator of a sphere turning away from the monitor, which put the
 *     darkest pixels in the scene on the one object the player is tracking. A
 *     lamp has no shaded limb, so every stop here stays brighter than the board
 *     it sits on.
 *   THE CORONA is zero in the middle. It is drawn ADDITIVELY OVER the body, so
 *     brightness at the centre would blow the ball out to white and throw away
 *     the colour that says which ball it is. It peaks exactly at the ball's
 *     edge and returns to zero before its own, so it bleeds rather than
 *     stopping in a ring.
 */

/** Corona radius as a multiple of the ball's, so the bloom sits at the rim. */
export const CORONA_RADII = 2.4;

export interface Stop {
  /** 0 at the centre, 1 at the outer edge of the gradient. */
  offset: number;
  /** Packed RGB. */
  color: number;
  alpha: number;
}

/** Blend two packed colours, `t` = 0 gives `a`. */
export function mixRgb(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Rough perceived lightness, for comparing a stop against the board. */
export function luma(c: number): number {
  return 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
}

/**
 * The body: white-hot filament in the middle, the ball's colour through it,
 * still lit at the rim.
 *
 * The last stop is the whole point. It used to be the shadow colour at 0.88
 * alpha; it is now the ball's colour warmed slightly, so the glass edge catches
 * its own light instead of turning away from a light that is no longer shining
 * on it.
 */
export function bulbStops(color: number): Stop[] {
  return [
    // Small and near-white: the ball has an obvious source inside it rather
    // than being a flat disc of colour.
    { offset: 0, color: 0xffffff, alpha: 0.95 },
    { offset: 0.22, color: mixRgb(color, 0xffffff, 0.55), alpha: 1 },
    { offset: 0.55, color, alpha: 1 },
    // Subtle enough not to read as a drawn ring, hot enough not to read as an
    // edge falling into shadow.
    { offset: 1, color: mixRgb(color, 0xffffff, 0.14), alpha: 1 },
  ];
}

/**
 * The corona, as offsets through a texture of radius `CORONA_RADII` ball radii.
 * White; the sprite is tinted per ball.
 */
export function coronaStops(): { offset: number; alpha: number }[] {
  const edge = 1 / CORONA_RADII;
  return [
    { offset: 0, alpha: 0 },
    { offset: edge * 0.86, alpha: 0.05 },
    // The peak lands exactly on the ball's outline.
    { offset: edge, alpha: 0.55 },
    { offset: edge * 1.45, alpha: 0.22 },
    { offset: edge * 2.1, alpha: 0.05 },
    { offset: 1, alpha: 0 },
  ];
}
