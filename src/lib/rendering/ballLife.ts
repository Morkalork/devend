/**
 * The small motions that make a ball read as alive.
 *
 * On the Pixi renderer a ball was a radial gradient that translated. The
 * physics kept a pulse phase and a rotation and the ball layer read neither,
 * so nothing about a ball ever changed except where it was. A thing that never
 * changes shape or brightness reads as dead whatever it is drawn as, and that
 * was the complaint: "they feel dead, not alive at all".
 *
 * Look C from the review, "today's lamp, plus life": the drawing stays exactly
 * as it is and four motions are added. All are transforms, so they cost
 * nothing per frame and nothing has to be baked again:
 *
 *   HEARTBEAT  a two-beat lub-dub swell of the body with a flare of the
 *              corona. Each ball has its own phase so seven of them do not
 *              beat in step, which would read as a metronome.
 *   STRETCH    prolate along the direction of travel, growing with speed.
 *   JELLY      two decaying swings after every ordinary bounce (ballEffects).
 *   LAG        the filament trails the body on a spring, so the highlight
 *              slides on every change of direction and settles after.
 *
 * Pure functions and one tiny integrator, so each is pinned by a test rather
 * than by looking.
 */

/** Resting heart rate. A lively but unhurried pace; the fastest ball runs faster. */
export const HEART_BPM = 72;
/** Radius swell at the top of the beat, as a fraction. Visible, not comic. */
export const BREATHE = 0.028;
/** How much the corona whitens on the beat, added to its resting 0.4. */
export const CORONA_FLARE = 0.25;
/** Prolate stretch along the velocity at the reference speed, as a fraction. */
export const STRETCH_MAX = 0.07;
/** World speed at which the stretch saturates; the squash uses the same figure. */
export const STRETCH_REF_SPEED = 250;
/** How far the filament may trail the body, in radii. */
export const LAG_LIMIT = 0.42;

/**
 * The heartbeat, 0..1: a sharp lub and a softer dub, then rest.
 *
 * Clock-driven rather than integrated, so a dropped frame or a hidden tab
 * cannot leave a ball mid-beat, and the headless harness gets the same value
 * as the browser for the same time.
 */
export function heartbeat(nowMs: number, phaseMs = 0, rate = 1): number {
  const period = 60000 / (HEART_BPM * rate);
  const p = (((nowMs + phaseMs) % period) + period) % period;
  const bump = (at: number, width: number) => Math.exp(-(((p - at) / width) ** 2));
  const v = bump(20, 55 / rate) + 0.55 * bump(200 / rate, 50 / rate);
  return v > 1 ? 1 : v;
}

/** A per-ball phase from its id, so a board of balls does not beat in unison. */
export function heartPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 833;
}

/**
 * Heart rate multiplier for a ball's situation: racing when it is the fastest
 * thing on the board, a crawl while it is held still.
 */
export function heartRate(opts: { fastest: boolean; held: boolean }): number {
  if (opts.held) return 0.45;
  if (opts.fastest) return 1.3;
  return 1;
}

/** Stretch along the velocity for this speed: 0 at rest, STRETCH_MAX at the reference speed and above. */
export function flightStretch(speed: number): number {
  const s = speed / STRETCH_REF_SPEED;
  return STRETCH_MAX * (s < 0 ? 0 : s > 1 ? 1 : s);
}

/** The filament's spring state, in WORLD units. */
export interface Lag {
  x: number; y: number;
  vx: number; vy: number;
  /** The ball velocity last seen, so a change of direction can be felt as an impulse. */
  seenVx: number; seenVy: number;
  seeded: boolean;
}

export function createLag(): Lag {
  return { x: 0, y: 0, vx: 0, vy: 0, seenVx: 0, seenVy: 0, seeded: false };
}

/** Spring stiffness and the share of a velocity change that kicks the filament. */
const LAG_K = 60;
const LAG_DAMP = 0.85;
const LAG_KICK = 0.35;

/**
 * Advance the filament by `dt` seconds given the ball's current velocity and
 * radius. A change in velocity kicks the filament the other way (it has
 * inertia, the body does not), and a critically damped spring brings it home
 * in two or three swings. Clamped to LAG_LIMIT radii so it never leaves the
 * body.
 */
export function stepLag(lag: Lag, vx: number, vy: number, radius: number, dt: number): Lag {
  if (!lag.seeded) { lag.seenVx = vx; lag.seenVy = vy; lag.seeded = true; }
  const dvx = vx - lag.seenVx, dvy = vy - lag.seenVy;
  lag.seenVx = vx; lag.seenVy = vy;
  if (dvx !== 0 || dvy !== 0) { lag.vx -= dvx * LAG_KICK; lag.vy -= dvy * LAG_KICK; }
  if (dt > 0) {
    const c = 2 * Math.sqrt(LAG_K) * LAG_DAMP;
    lag.vx += (-lag.x * LAG_K - lag.vx * c) * dt;
    lag.vy += (-lag.y * LAG_K - lag.vy * c) * dt;
    lag.x += lag.vx * dt;
    lag.y += lag.vy * dt;
  }
  const lim = radius * LAG_LIMIT;
  const m = Math.hypot(lag.x, lag.y);
  if (m > lim) { lag.x *= lim / m; lag.y *= lim / m; }
  return lag;
}
