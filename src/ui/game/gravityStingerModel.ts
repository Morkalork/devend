/**
 * The Full Gravity stinger: what it does at each moment (GravityStinger draws
 * it). A map under full-map gravity opens with the board held still and the
 * rule shouted over it, so the first fall is never mistaken for a physics
 * bug: the hazard chip above the board was reported as too easy to miss, and
 * a rule that changes where every ball goes deserves one loud second.
 *
 * Pure, so the timeline can be tested without a canvas.
 */

/** How long the board is held under the stinger, seconds. */
export const STINGER_SECONDS = 1.6;
/** Reduced motion: a shorter, still card. */
export const STINGER_SECONDS_STILL = 1.1;

export interface StingerState {
  /** 0..1 for the whole card. */
  alpha: number;
  /** Scale of the headline: slams in large, settles to 1. */
  scale: number;
  /** The violet edge flash round the board, 0..1. */
  edge: number;
  /** The arrow's drop, 0..1 of its travel, looping. */
  drop: number;
  /** Headline glow, 0..1, breathing. */
  glow: number;
  /** Past the end: the parent releases the board. */
  done: boolean;
}

function easeOutBack(t: number): number {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

export function stingerState(elapsed: number, reducedMotion = false): StingerState {
  const total = reducedMotion ? STINGER_SECONDS_STILL : STINGER_SECONDS;
  const t = Math.max(0, elapsed);
  if (reducedMotion) {
    const alpha = t < 0.15 ? t / 0.15 : t > total - 0.25 ? Math.max(0, (total - t) / 0.25) : 1;
    return { alpha, scale: 1, edge: alpha * 0.6, drop: 0.5, glow: 0.6, done: t >= total };
  }
  // In: a slam over the first 0.25s. Out: a fade over the last 0.3s.
  const inT = Math.min(1, t / 0.25);
  const outT = t > total - 0.3 ? Math.max(0, (total - t) / 0.3) : 1;
  const alpha = Math.min(inT, outT);
  const scale = 1.6 - 0.6 * easeOutBack(inT);
  // The edge flashes hard at the slam and settles to a breath.
  const edge = outT * (inT < 1 ? 1 : 0.45 + 0.25 * Math.sin(t * 9));
  const drop = ((t * 1.4) % 1);
  const glow = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 8));
  return { alpha, scale, edge, drop, glow, done: t >= total };
}
