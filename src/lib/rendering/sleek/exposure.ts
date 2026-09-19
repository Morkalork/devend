/**
 * Local exposure: what stops five pools in one corner from becoming one sheet.
 *
 * THE PROBLEM THIS SOLVES, stated the way the code states it elsewhere. The
 * ball light is composited onto the board with blendMode "add", so it adds the
 * SAME amount to cut space and to live space, and the ratio between those two
 * is the read the whole game runs on. ballLight.ts pins BASE_INTENSITY at 0.55
 * for exactly that reason and says so: much past there and the board goes flat
 * where the balls are. But the number that actually flattens it is not one
 * ball's peak, it is the SUM where several overlap, and nothing was watching
 * that sum. One ball at 0.55 is fine; four in a corner at 0.55 each is a white
 * patch with no contrast left in it, and that is the case a boss map or a
 * launcher salvo produces constantly.
 *
 * So the lights are tone-mapped: each one's output is scaled down by how
 * crowded the board is where it stands, on a curve that is exactly identity
 * below a knee and rolls off toward a ceiling above it. A lone ball in a dark
 * corner is untouched, to the last decimal - this must not be a global dimmer,
 * or it would be the flat board again with an extra step.
 *
 * WHY IN THE LIGHT DOMAIN AND NOT AS A SHADER ON THE BUFFER, which is the
 * textbook place for a tone map:
 *
 * 1. A per-pixel curve compresses the gradient INSIDE each pool as well as
 *    between pools, and that gradient is how a player reads how close a ball
 *    is. Scaling whole lights leaves every pool's own falloff exactly as it
 *    was and only changes how much board each one claims, which is the part
 *    that was wrong.
 * 2. The buffer is over-blended and therefore already saturates at 1, so a
 *    curve applied there could only take light away after the information
 *    about who contributed what had been thrown away. Here the crowding is
 *    still addressable per emitter.
 * 3. It is pure arithmetic, so it is pinned by ordinary tests rather than by
 *    looking at a screenshot, and it cannot black-screen a phone whose driver
 *    dislikes a filter.
 *
 * The cost is one O(n squared) sweep over the ball lights, which is single
 * digits squared. Flashes, tips and caustics are not in the field: they are
 * brief and they are meant to blow out, that being what a flash is.
 */

/**
 * Exposure below which nothing is touched at all.
 *
 * Just above BASE_INTENSITY (0.55), so a single ball - however fast, and
 * whatever the tell is doing - is never in the curve. The rolloff is for
 * crowds, and a mechanism that quietly dimmed the ordinary case would be a
 * worse version of simply lowering the base.
 */
export const EXPOSURE_KNEE = 0.62;

/**
 * What the total rolls off toward, however many lights pile up.
 *
 * Above 1 on purpose: 1 would mean the brightest a corner can get is one
 * saturated pool, and a crowd SHOULD be brighter than a single ball. It just
 * must not be four times brighter.
 */
export const EXPOSURE_CEIL = 1.45;

/** One emitter, as the exposure field sees it. Screen units throughout. */
export interface ExposureLight {
  x: number;
  y: number;
  reach: number;
  intensity: number;
}

/**
 * The curve: identity up to the knee, then an exponential approach to the
 * ceiling.
 *
 * Continuous in value AND in slope at the knee (both are 1 there), which is
 * what keeps a ball drifting into a crowd from stepping brighter or darker at
 * the moment it crosses. A curve with a corner in it reads as a bug in exactly
 * the situation it exists to handle.
 */
export function exposureKnee(e: number): number {
  if (!(e > EXPOSURE_KNEE)) return e;
  const head = EXPOSURE_CEIL - EXPOSURE_KNEE;
  return EXPOSURE_KNEE + head * (1 - Math.exp(-(e - EXPOSURE_KNEE) / head));
}

/**
 * The gain each light should be scaled by, given the company it is keeping.
 *
 * The neighbour term is squared falloff of the OTHER light's pool sampled at
 * this light's centre: two balls touching count each other almost in full, two
 * at arm's length barely at all, and two a pool apart not at all. That is the
 * same shape the pools themselves have, which is the point - the field is
 * meant to approximate what the buffer is about to accumulate, not to be a
 * second opinion about it.
 *
 * `strength` is the dial. 0 returns all ones, exactly, so the board with the
 * slider down is the board before this file existed.
 */
export function toneMapLights(
  lights: readonly ExposureLight[], strength: number, out: number[] = [],
): number[] {
  out.length = lights.length;
  if (!(strength > 0.001)) {
    out.fill(1);
    return out;
  }
  for (let i = 0; i < lights.length; i++) {
    const a = lights[i];
    let e = a.intensity;
    for (let j = 0; j < lights.length; j++) {
      if (j === i) continue;
      const b = lights[j];
      if (!(b.reach > 1e-6)) continue;
      const overlap = 1 - Math.min(1, Math.hypot(b.x - a.x, b.y - a.y) / b.reach);
      if (overlap <= 0) continue;
      e += b.intensity * overlap * overlap;
    }
    const full = e > 1e-6 ? exposureKnee(e) / e : 1;
    // Mixed toward 1 by the dial rather than applied whole, so the slider is a
    // continuous before/after and not an on/off in a slider's clothing.
    out[i] = 1 + (full - 1) * strength;
  }
  return out;
}
