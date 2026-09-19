/**
 * The two lights nothing was treating as a light.
 *
 * THE CAUSTIC. A ball is drawn as a translucent bulb and shaded as one, and
 * then it casts the flat opaque shadow of a stone. That is the one place the
 * ball's own material contradicts itself. Light going THROUGH a rounded
 * translucent body does not just fail to be blocked, it is focused: the shadow
 * of a glass marble has a bright core in the marble's own colour, often
 * brighter than the floor beside it. One small pool inside the existing shadow
 * ellipse says "this thing is made of glass" more convincingly than anything
 * that could be added to the ball itself, and it costs one emitter.
 *
 * THE LOCK FLASH. fxLayer.ts already says of it: "for the second it burns it is
 * the brightest thing on the board and takes no ambient dimming, because it is
 * the payoff for the whole loop." It was a fill, though - a bright patch that
 * lit nothing. Registering it as a real emitter for its duration means every
 * fence around the pocket throws a long shadow that appears and fades with it,
 * which is what the brightest thing on the board is supposed to do to a room.
 * The occlusion machinery is already built; this is one more entry in the loop,
 * for under a second at a time.
 *
 * Both are pure: they return where a light is and how strong, and the pass
 * places it.
 */

import type { Ball, LockFlashState } from "@/types/game";
import type { LightScope } from "./light";
import { shadowFor } from "./light";

/**
 * How far a ball's own shadow is dragged toward the ball's colour.
 *
 * THIS is the visible half of the caustic, and the bright core below is the
 * one that nearly was not worth shipping. A self-lit ball washes the floor
 * exactly where its monitor shadow falls, which is why SELF_LIT_SHADOW is only
 * 0.35 in the first place - so there is barely a dark ellipse for a bright core
 * to sit inside, and measured on screen the core lifts one small patch by about
 * half against a background that is already bright.
 *
 * A coloured shadow needs no contrast to read, because it is not competing with
 * the pool: it changes the HUE of the one shape the pool has not already
 * flooded. It is also the more honest picture. Light through a red marble does
 * not leave a grey shadow with a red dot in it; the whole shadow goes red.
 */
export const CAUSTIC_TINT = 0.55;

/**
 * Radius of the caustic, in ball radii.
 *
 * Smaller than the shadow it sits in, and that containment is the whole read:
 * a bright core INSIDE a dark ellipse is a focused beam, while the same core
 * spilling past the edge is just another glow that happens to be offset.
 */
export const CAUSTIC_RADII = 0.62;

/** Peak intensity of the caustic, as a fraction of the ball's own pool. */
export const CAUSTIC_GAIN = 0.85;

/**
 * How far along the monitor's throw the caustic sits, as a fraction of the
 * shadow's own length.
 *
 * Past the middle. Light entering a sphere is bent toward the axis and crosses
 * it BEYOND the body, so the focus lands further out than the geometric shadow
 * centre - which is also the version that reads, because a core exactly under
 * the ball is hidden by the ball.
 */
export const CAUSTIC_THROW = 1.35;

/**
 * How long a lock flash lasts, and how long a superior one does.
 *
 * Here rather than in fxLayer.ts, which draws them, because the light pass
 * needs the same numbers and importing a thousand-line layer to learn a
 * duration is the wrong direction for that dependency to run.
 */
export const LOCK_FLASH_MS = 900;
export const SUPERIOR_FLASH_MS = 1500;

/** How far a lock flash's light reaches, in multiples of the pocket's size. */
export const FLASH_REACH = 2.1;

/** Smallest and largest reach a flash may have, in world units. */
export const FLASH_REACH_MIN = 90;
export const FLASH_REACH_MAX = 420;

/** Peak intensity of a lock flash as a light. */
export const FLASH_INTENSITY = 0.95;

/**
 * The colour a ball's cast shadow takes, given how translucent it is being
 * drawn as. `gain` 0 gives back the plain shadow colour unchanged.
 */
export function causticShadow(
  shadow: number, body: number, gain: number, mix: (a: number, b: number, t: number) => number,
): number {
  if (gain <= 0.001) return shadow;
  return mix(shadow, body, CAUSTIC_TINT * gain);
}

/**
 * How long an impact's flash lasts, in ms.
 *
 * Much shorter than the bulge it rides on (520ms). A bounce is instantaneous;
 * the fence taking a moment to stop wobbling is the AFTERMATH, and a light
 * that outstayed the event would turn every bounce into a lingering lamp on a
 * board where bounces never stop happening.
 */
export const IMPACT_FLASH_MS = 190;

/** Reach of an impact flash, in ball radii, at full strength. */
export const IMPACT_REACH_RADII = 3.6;

/** Peak intensity of an impact flash. */
export const IMPACT_INTENSITY = 0.8;

/**
 * The shape of a hit: all attack, no sustain.
 *
 * Full brightness on the frame of contact and a fast power decay, because that
 * IS the event. Anything with a rise reads as the fence lighting up in
 * anticipation of a ball that already arrived.
 */
export function impactEnvelope(t: number): number {
  if (t < 0 || t >= 1) return 0;
  return Math.pow(1 - t, 2.2);
}

export interface PlacedLight {
  /** Screen position. */
  x: number;
  y: number;
  /** Screen radius. */
  reach: number;
  intensity: number;
  color: number;
  /**
   * The emitter's own screen radius, for the penumbra in shadowQuad. Absent
   * means a point source and therefore a hard shadow, which is what every
   * light placed through this interface is: a lock flash has no body, a
   * caustic is a focused core rather than a disc, and a fence tip is a point
   * by construction. Only a ball's own pool (BallLight) fills it in.
   */
  source?: number;
}

/**
 * The bright core inside a ball's own shadow, or null when it has none.
 *
 * A DORMANT ball has no shadow to put one in (ballLayer skips its cast
 * entirely), and a ball with no light of its own has nothing to focus.
 */
export function causticFor(
  ball: Ball, screen: { x: number; y: number }, radius: number,
  color: number, intensity: number, monitor: LightScope,
): PlacedLight | null {
  if (ball.state === "dormant") return null;
  if (intensity <= 0.001) return null;
  const cast = shadowFor(monitor, screen.x, screen.y, radius);
  return {
    x: screen.x + cast.dx * cast.length * CAUSTIC_THROW,
    y: screen.y + cast.dy * cast.length * CAUSTIC_THROW,
    reach: radius * CAUSTIC_RADII,
    // Scaled by how dark the shadow it is sitting in actually is, so a caustic
    // never outlives its own shadow: the two are one object.
    intensity: intensity * CAUSTIC_GAIN * (cast.alpha / 0.72),
    color,
  };
}

/**
 * How bright a lock flash burns at `now`, 0 outside its life.
 *
 * The same envelope fxLayer.ts draws the flash itself with - slam on over the
 * first 15%, then a long drain - because a light that peaked on a different
 * schedule from the flare it belongs to would read as two events.
 */
export function flashEnvelope(t: number): number {
  if (t < 0 || t > 1) return 0;
  return t < 0.15 ? t / 0.15 : Math.pow(1 - (t - 0.15) / 0.85, 1.6);
}

/** How far a pocket's flash throws, from the size of the pocket. */
export function flashReach(flash: LockFlashState, cellSize: number): number {
  const area = Math.max(1, flash.cellIndices.length) * cellSize * cellSize;
  const size = Math.sqrt(area);
  return Math.min(FLASH_REACH_MAX, Math.max(FLASH_REACH_MIN, size * FLASH_REACH));
}
