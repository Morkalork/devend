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

/**
 * A map's light, 1 = normal and lower = darker. `MIN_MAP_LIGHT` is as dark as a
 * map may be authored.
 *
 * The bound is not timidity. Below it the board stops being readable at all,
 * and a map you cannot read is not a hard map, it is a broken one. What makes
 * the range safe as far as it goes is that the wash is a MULTIPLY: it scales
 * live and captured space by the same factor, so the ratio between them stays
 * exactly 1.74 at every darkness. A dark map costs you absolute visibility, and
 * never the ability to tell what you have already taken - which is the one read
 * the game cannot be played without.
 */
export const MIN_MAP_LIGHT = 0.35;

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

/** The same two at MIN_MAP_LIGHT: the darkest a map is allowed to be. */
export const DARK_FLOOR = 0.55;
export const DARK_FAR = 0.68;

/**
 * How much darker than its idle value the flicker may drive the wash.
 *
 * Also the gap between the far stop and the sprite's nominal alpha, so the far
 * stop is always below 1 and can never silently clamp inside the bake.
 */
const FLICKER_HEADROOM = 0.08;

export interface WashProfile {
  /** Effective multiply alpha at the light. */
  floor: number;
  /** Effective multiply alpha at the far corner. */
  far: number;
  /** Sprite alpha at the monitor's idle level; the baked stops assume it. */
  nominal: number;
  /** The most the wash may darken a pixel, whatever the flicker is doing. */
  max: number;
}

/**
 * The wash for a map's light setting. `light` absent or 1 is the default map.
 *
 * Everything is derived from the two endpoints rather than tuned per setting,
 * so a designer turning one dial cannot produce a combination nobody checked.
 */
export function washProfile(light = 1): WashProfile {
  // NaN is the one that matters: this comes from a number field an author types
  // into, and an empty or half-typed value would otherwise carry NaN through
  // every alpha below and paint the board with a gradient of nothing.
  const asked = Number.isFinite(light) ? light : 1;
  // ONE clamp, on the normalised position. Clamping `light` to the range first
  // as well was redundant - anything outside it normalises outside [0, 1] and
  // is caught here - and a mutation test caught the second guard doing nothing.
  const t = Math.max(0, Math.min(1, (asked - MIN_MAP_LIGHT) / (1 - MIN_MAP_LIGHT)));
  const floor = DARK_FLOOR + (WASH_FLOOR - DARK_FLOOR) * t;
  const far = DARK_FAR + (WASH_FAR - DARK_FAR) * t;
  const nominal = far + FLICKER_HEADROOM;
  return { floor, far, nominal, max: nominal };
}

/** Where the middle stop sits between floor and far, keeping the old curve. */
const MID_FRACTION = 0.24;
/** Gradient position of that middle stop. */
const MID_STOP = 0.45;

/**
 * The gradient, as {offset, alpha} pairs for the baked texture.
 *
 * Divided by the profile's nominal alpha, because the sprite multiplies the
 * whole texture: a stop of 0.58 under a 0.45 sprite is the 0.26 floor above.
 */
export function washStops(light = 1): { offset: number; alpha: number }[] {
  const p = washProfile(light);
  const a = (effective: number) => effective / p.nominal;
  return [
    { offset: 0, alpha: a(p.floor) },
    { offset: MID_STOP, alpha: a(p.floor + (p.far - p.floor) * MID_FRACTION) },
    { offset: 1, alpha: a(p.far) },
  ];
}

/**
 * The sprite's alpha for a given monitor level.
 *
 * Brighter monitor, less darkening: the wash is subtractive, so it has to move
 * opposite to the light. The ceiling is what keeps the flicker's downswing from
 * driving the board past `max`, and it is applied to the SPRITE rather than to
 * the modelled result - clamping the model alone would let the render drift
 * past a limit its own test believed was being enforced.
 */
export function washSpriteAlpha(level: number, light = 1): number {
  const p = washProfile(light);
  const ceiling = Math.min(1, (p.max * p.nominal) / p.far);
  return Math.max(0, Math.min(ceiling, 1 + p.nominal - level));
}

/**
 * The effective multiply alpha at gradient position `t` (0 at the light, 1 at
 * the far corner), for a monitor level and a map light.
 *
 * This is the number that actually darkens a pixel, and the reason this module
 * exists: it is what a brightness test has to model, and it is not readable
 * from either the stops or the sprite alpha alone.
 */
export function washAlphaAt(t: number, level = 1, light = 1): number {
  const stops = washStops(light);
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
  return Math.max(0, Math.min(1, stopAlpha * washSpriteAlpha(level, light)));
}
