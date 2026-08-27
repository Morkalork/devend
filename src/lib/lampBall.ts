/**
 * The lamp: one ball at a time is the board's light source.
 *
 * The board is lit by a monitor off the bottom-right corner (light.ts) and that
 * light never moves, so it never means anything. Handing it to a BALL makes the
 * lighting a thing the player is playing with: shadows point away from the lit
 * ball, so you always know where it is, and sealing it pays extra.
 *
 * The whole appeal is that it needs no HUD. Every other "this ball matters"
 * mark in the game has to be drawn on (the fastest-ball ring, an assignment's
 * bounty type). This one is the brightest object on the board and every shadow
 * in the scene points at it, so the mechanic and the rendering are the same
 * thing.
 *
 * THREE DECISIONS, and the reasons matter more than the numbers:
 *
 * 1. THE PICK IS BIASED, NOT UNIFORM. A uniformly random lamp is a lottery:
 *    half the time it lands on the ball you were sealing anyway (free money)
 *    and half the time it is across the board behind an obstacle (ignore it).
 *    Choosing the ball with the most open space around it makes it always a
 *    stretch and never free, while staying unpredictable to the player, who
 *    cannot see the region sizes.
 *
 * 2. IT ONLY RE-PICKS WHEN IT HAS TO. Re-running the choice every frame would
 *    make the lamp flicker between balls as regions change size, which would be
 *    unreadable and would make the bonus impossible to plan for. The lamp holds
 *    until the ball holding it stops being eligible.
 *
 * 3. DORMANT BALLS ARE NEVER THE LAMP. A sleeper is dark by design (it casts no
 *    shadow and emits no light), and the circuit maps open with every ball
 *    asleep, so a lamp that could land on one would leave those maps unlit.
 *    `lampFor` returning null is a supported state, not an error: the renderer
 *    falls back to the monitor.
 */

import type { Ball } from "@/types/game";
import type { GridRegion } from "@/lib/spaceGrid";

/**
 * How long the light takes to move from one ball to the next.
 *
 * Long enough to read as a deliberate handover rather than a glitch, short
 * enough that it does not eat the moment the player just earned. Every shadow
 * on the board swings during this window, so it is the most delicate thing in
 * the feature.
 */
export const LAMP_HANDOVER_MS = 750;

/**
 * How far the light dims at the midpoint of a handover.
 *
 * This is the trick that makes the handover bearable. The light physically
 * travels across the board, and if it did so at full brightness every shadow in
 * the scene would sweep through a huge arc in three quarters of a second, which
 * is the "nauseating" failure. Dimming through the middle means the travel
 * happens while there is little shadow to see: the board dips toward dusk, and
 * comes back up somewhere else. A lamp being carried to another table.
 *
 * Not to zero. The board went out entirely at 0 and that reads as a bug, and
 * this game already has a history of being called too dark.
 */
export const LAMP_DIP = 0.4;

export interface LampState {
  /** The ball currently holding the light, or null if none is eligible. */
  ballId: string | null;
  /** The ball it came FROM, for the handover. Null once the handover is over. */
  fromBallId: string | null;
  /** performance.now() when the current handover began. */
  switchedAt: number;
}

/** A ball can hold the light only while it is in play. */
export function eligibleForLamp(ball: Ball): boolean {
  return ball.state === "active";
}

/**
 * Choose the lamp: the eligible ball with the most open space around it.
 *
 * "Most open space" is the cell count of the region the ball is in, which is
 * exactly the region a player has to shrink to seal it. So the lamp is always
 * the ball that is furthest from being locked, which is what stops the bonus
 * from being free.
 *
 * Ties break on ball id so the choice is deterministic. Seeded runs (Daily
 * Stand-up) have to deal the same lamp to everyone, and a Math.random tie-break
 * would quietly break that.
 */
export function pickLamp(balls: Ball[], regions: GridRegion[]): string | null {
  const size = new Map<string, number>();
  for (const r of regions) size.set(r.id, r.cellCount);

  let best: Ball | null = null;
  let bestSize = -1;
  for (const b of balls) {
    if (!eligibleForLamp(b)) continue;
    const s = b.regionId ? (size.get(b.regionId) ?? 0) : 0;
    if (s > bestSize || (s === bestSize && best !== null && b.id < best.id)) {
      best = b;
      bestSize = s;
    }
  }
  return best?.id ?? null;
}

/**
 * Advance the lamp, returning the new state or the old one unchanged.
 *
 * Called every frame. It does nothing at all while the current lamp is still
 * eligible, which is the overwhelmingly common case and the reason the lamp
 * does not flicker: re-picking is driven by the ball becoming ineligible, not
 * by the clock or by regions changing size.
 */
export function advanceLamp(
  state: LampState | undefined, balls: Ball[], regions: GridRegion[], now: number,
): LampState {
  const current = state?.ballId ?? null;
  const held = current !== null && balls.some(b => b.id === current && eligibleForLamp(b));
  if (held) {
    // Retire a finished handover so `fromBallId` cannot pin a stale ball.
    if (state && state.fromBallId !== null && now - state.switchedAt >= LAMP_HANDOVER_MS) {
      return { ...state, fromBallId: null };
    }
    return state!;
  }

  const next = pickLamp(balls, regions);
  if (next === current) return state ?? { ballId: next, fromBallId: null, switchedAt: now };
  return {
    ballId: next,
    // Hand over FROM the ball that just lost it, so the light is seen leaving
    // rather than blinking out. Null on the very first pick of a map, which is
    // a fade-in rather than a handover.
    fromBallId: current,
    switchedAt: now,
  };
}

/** How far through a handover we are: 0 just after the switch, 1 once settled. */
export function handoverProgress(state: LampState | undefined, now: number): number {
  if (!state || state.fromBallId === null) return 1;
  const t = (now - state.switchedAt) / LAMP_HANDOVER_MS;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * The light's brightness through a handover: full, dipping to LAMP_DIP at the
 * midpoint, full again.
 *
 * A half sine rather than a linear V, so it leaves and arrives smoothly. A
 * corner in the brightness curve is visible as a click in the shadows.
 */
export function lampLevel(t: number): number {
  return 1 - (1 - LAMP_DIP) * Math.sin(Math.PI * Math.max(0, Math.min(1, t)));
}

/**
 * How far along the path between the two balls the light sits.
 *
 * Smootherstep: almost stationary at both ends, fastest through the middle.
 * That is the whole point of pairing it with the dip - the light does its
 * travelling, and therefore its shadow-sweeping, while it is dimmest.
 */
export function lampTravel(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Where the light physically is, and how bright, at this moment of a handover.
 *
 * The renderer used to lerp these two by hand. It is here instead because the
 * pairing of the curves IS the delicate part: the position has to be sampled
 * with `lampTravel` and the brightness with `lampLevel`, because those two are
 * built to peak and trough together. Sampling the position with anything else
 * (a plain lerp, an ease-out) puts the light's fastest travel somewhere other
 * than its dimmest moment, and the handover goes back to being a shadow sweep.
 *
 * `from` and `to` are world points; pass the same point for both when there is
 * no handover in flight.
 */
export function lampSample(
  from: { x: number; y: number }, to: { x: number; y: number }, t: number,
): { x: number; y: number; level: number; blend: number } {
  const k = lampTravel(t);
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    level: lampLevel(t),
    // The colour crosses with the travel, so the board is already turning the
    // new ball's hue by the time it brightens again.
    blend: k,
  };
}
