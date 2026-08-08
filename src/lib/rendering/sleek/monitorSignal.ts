/**
 * The off-screen monitor's electrical signal — shared by the CRT background and
 * the board's light model, so both are lit by the SAME imaginary screen.
 *
 * CRTBackground already fires random glitches (tear / flicker / corrupt) every
 * few seconds. Those are the moments the monitor visibly stutters, so the board
 * light must stutter with them or the illusion breaks: a background tear with a
 * rock-steady board reads as two unrelated effects.
 *
 * This module is the whole coupling: CRTBackground calls `pulseMonitor()` when
 * it glitches, the renderer calls `monitorLevel()` once per frame. No React, no
 * imports either way, so neither side can break the other.
 *
 * Deterministic by design: the idle shimmer is a pure function of the clock
 * (layered primes, so it never visibly loops) rather than Math.random per frame.
 * Two devices at the same timestamp light the board identically, which keeps
 * seeded Daily Stand-up runs reproducible.
 */

/** A glitch in flight: when it fired, how hard, and how long it lasts. */
interface Pulse {
  at: number;
  strength: number;
  durationMs: number;
}

let pulse: Pulse | null = null;

/**
 * The monitor stuttered. `strength` 0..1 scales how violent the dip is, and
 * should track the visual weight of the background glitch that caused it.
 */
export function pulseMonitor(strength = 1, durationMs = 180): void {
  // A bigger pulse always wins; a smaller one must not cut short a big flash.
  if (pulse && performance.now() - pulse.at < pulse.durationMs && pulse.strength > strength) return;
  pulse = { at: performance.now(), strength: Math.max(0, Math.min(1, strength)), durationMs };
}

/**
 * Idle shimmer: three incommensurable sines plus a slow drift. Amplitude is
 * deliberately tiny (~4%) - enough that the board is never perfectly static,
 * far too little to read as "flashing" while the player is aiming a cut.
 */
function idleShimmer(t: number): number {
  const a = Math.sin(t / 97.0) * 0.014;
  const b = Math.sin(t / 211.0) * 0.011;
  const c = Math.sin(t / 1301.0) * 0.017;
  return a + b + c;
}

/**
 * A glitch's shape over its lifetime: a hard dip, one overshoot back past
 * normal (the tube recovering), then settle. Returns a signed delta.
 */
function pulseShape(p: number, strength: number): number {
  if (p >= 1) return 0;
  // Two damped oscillations; the first trough is the visible "blink".
  const decay = Math.pow(1 - p, 2.2);
  return -Math.sin(p * Math.PI * 2.6) * decay * strength * 0.55;
}

/**
 * Current brightness of the monitor, nominally 1.0.
 *
 * Clamped to a floor well above zero: the light may waver, but the board must
 * never go dark enough to hide a ball the player is tracking. Readability
 * outranks the effect.
 */
export function monitorLevel(now: number = performance.now()): number {
  let level = 1 + idleShimmer(now);
  if (pulse) {
    const p = (now - pulse.at) / pulse.durationMs;
    if (p >= 1) pulse = null;
    else level += pulseShape(p, pulse.strength);
  }
  return Math.max(0.62, Math.min(1.18, level));
}

/** Test seam: drop any in-flight glitch. */
export function resetMonitor(): void {
  pulse = null;
}
