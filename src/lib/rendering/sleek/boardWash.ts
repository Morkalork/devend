/**
 * The board's wash: how much light the room takes back off the surface.
 *
 * One multiply-blended sprite over the whole board. It has two jobs and they
 * were tangled together until the numbers below separated them:
 *
 *   THE FLOOR   a uniform darkening everywhere, so the board sits below the
 *     light the balls throw onto it. This is what makes a pool read as a POOL
 *     rather than as a slightly warmer patch of an already-bright surface. It
 *     used to be zero: the wash started at fully transparent in the middle, so
 *     the centre of the board got no darkening at all.
 *   THE FALLOFF an extra darkening toward the corner furthest from the room's
 *     light, which is what stops the surface reading as a flat sheet.
 *
 * Both are expressed as the EFFECTIVE multiply alpha the player actually sees,
 * rather than as gradient stops, because a gradient stop is meaningless without
 * the sprite alpha it gets multiplied by - and that sprite alpha moves with the
 * monitor's flicker. Splitting them was not tidying: boardBrightness.test.ts
 * had been modelling this layer with `ambientAt`, which the surface does not
 * use, and so could not have caught an over-darkening here at all.
 *
 * The ceiling on all of it is the brightness floor. Testers called this board
 * too dark three times; the darkest live pixel has to stay above what they were
 * reacting to, which is what boardBrightness.test.ts pins.
 */

/** Uniform darkening across the whole board, as an effective multiply alpha. */
export const WASH_FLOOR = 0.26;

/**
 * Total darkening at the corner furthest from the light, floor included.
 *
 * The difference between this and the floor is the directional character. Keep
 * some: with none, the surface is a flat sheet again, which is the thing the
 * wash was originally added to fix.
 */
export const WASH_FAR = 0.37;

/**
 * The sprite's alpha at the monitor's idle level, which the baked stops are
 * expressed against.
 *
 * It has to be at least WASH_FAR or the far stop would need an alpha above 1
 * to reach its target and would silently clamp instead.
 */
export const WASH_NOMINAL_ALPHA = 0.45;

/**
 * The most the wash may ever darken a pixel, whatever the flicker is doing.
 *
 * Found by the brightness test rather than chosen: raising the floor also
 * raised the gradient stops, and since the monitor's flicker multiplies the
 * WHOLE texture, the same swing in sprite alpha now moves the effective alpha
 * much further. At the flicker's deepest dip the far corner was landing at
 * luma 17.9, under the floor testers reacted to, in a state that only appears
 * for a fraction of a second and would never have been caught by eye.
 *
 * 0.45 leaves the darkest live pixel at luma ~22 against a floor of 20. The
 * cap is applied to the SPRITE alpha rather than to the modelled result,
 * because clamping the model alone would let the render drift past a limit its
 * own test believed was being enforced - which is exactly the class of bug
 * this file was extracted to end.
 */
const WASH_MAX = 0.45;

/** Where the middle stop sits between floor and far, keeping the old curve. */
const MID_FRACTION = 0.24;
/** Gradient position of that middle stop. */
const MID_STOP = 0.45;

/**
 * The gradient, as {offset, alpha} pairs for the baked texture.
 *
 * Divided by the nominal sprite alpha, because the sprite multiplies the whole
 * texture: a stop of 0.44 under a 0.45 sprite is the 0.20 floor above.
 */
export function washStops(): { offset: number; alpha: number }[] {
  const a = (effective: number) => effective / WASH_NOMINAL_ALPHA;
  return [
    { offset: 0, alpha: a(WASH_FLOOR) },
    { offset: MID_STOP, alpha: a(WASH_FLOOR + (WASH_FAR - WASH_FLOOR) * MID_FRACTION) },
    { offset: 1, alpha: a(WASH_FAR) },
  ];
}

/**
 * The sprite's alpha for a given monitor level.
 *
 * Brighter monitor, less darkening: the wash is subtractive, so it has to move
 * opposite to the light. Same slope as before (one unit of level to one unit of
 * alpha), so the flicker still reads exactly as it did; only the level it rides
 * around has moved up to make room for the floor.
 */
export function washSpriteAlpha(level: number): number {
  // The far stop is the one that hits the floor first, so the cap is expressed
  // against it: the alpha that keeps THAT stop at WASH_MAX.
  const ceiling = Math.min(1, (WASH_MAX * WASH_NOMINAL_ALPHA) / WASH_FAR);
  return Math.max(0, Math.min(ceiling, 1 + WASH_NOMINAL_ALPHA - level));
}

/**
 * The effective multiply alpha at gradient position `t` (0 at the light, 1 at
 * the far corner), for a given monitor level.
 *
 * This is the number that actually darkens a pixel, and the reason this module
 * exists: it is what a brightness test has to model, and it is not readable
 * from either the stops or the sprite alpha alone.
 */
export function washAlphaAt(t: number, level = 1): number {
  const stops = washStops();
  const x = Math.max(0, Math.min(1, t));
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (x >= stops[i].offset && x <= stops[i + 1].offset) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const span = hi.offset - lo.offset;
  const k = span <= 0 ? 0 : (x - lo.offset) / span;
  const stopAlpha = lo.alpha + (hi.alpha - lo.alpha) * k;
  return Math.max(0, Math.min(1, stopAlpha * washSpriteAlpha(level)));
}
