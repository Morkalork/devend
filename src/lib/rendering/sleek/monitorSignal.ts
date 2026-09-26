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

/**
 * A glitch in flight: when it started, how hard, and how long it lasts.
 *
 * `at` is null until the first `monitorLevel` read after the glitch fired, and
 * is then stamped with THAT read's clock. See `monitorLevel` for why the
 * glitch cannot be stamped when it fires.
 */
interface Pulse {
  at: number | null;
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
  // A pulse that is still here is still in flight: `monitorLevel` drops each
  // one the moment it has run its course.
  if (pulse && pulse.strength > strength) return;
  pulse = { at: null, strength: Math.max(0, Math.min(1, strength)), durationMs };
}

/**
 * Idle shimmer: three incommensurable sines, slow enough to read as breathing.
 *
 * ── Why the periods are the whole of this function ─────────────────────────
 *
 * The old ones were 97, 211 and 1301, and the comment above them said the
 * amplitude was "deliberately tiny (~4%) - far too little to read as flashing".
 * The amplitude was never the problem. `sin(t / 97)` with t in milliseconds has
 * a period of 2*pi*97ms, which is 1.64 Hz: the board's brightness turned around
 * 328 times in 100 seconds, a median of 313ms between reversals. That is not a
 * shimmer, it is a pulse at roughly the rate of a fast heartbeat, and a couple
 * of percent of modulation at that rate is far above what an eye ignores on a
 * large flat field.
 *
 * Reported as exactly that: "fenced off areas still blink in quick pace". The
 * captured ground is where it shows first because it is the biggest, flattest,
 * darkest thing on the board - live space is busier and the balls take the eye,
 * so the same ripple hides there.
 *
 * The wash makes it worse on the way through, which is why this is measured in
 * delivered brightness rather than in `level`. The sprite's alpha is
 * `1 + nominal - level` about a nominal of 0.45, so a 4.8% swing in the level
 * arrives as an 11% swing in the alpha (boardWash.washSpriteAlpha).
 *
 * So the periods move and the amplitude stays. The fastest component is now
 * about 0.25 Hz - one swell every four seconds - and the slowest is a drift
 * over a quarter of a minute. The board is still never perfectly static, which
 * is the whole point of having this at all; it just no longer blinks.
 * monitorFlicker.test.ts measures the delivered brightness and holds it there.
 *
 * Still incommensurable, so the three never line up into a visible loop.
 */
function idleShimmer(t: number): number {
  const a = Math.sin(t / 641.0) * 0.014;
  const b = Math.sin(t / 1301.0) * 0.011;
  const c = Math.sin(t / 2749.0) * 0.017;
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
    // ── One clock, whichever the reader uses ─────────────────────────────
    //
    // The glitch fires from CRTBackground, on the page's wall clock. The board
    // reads the level on the SIMULATION clock (SleekRenderer passes simNow()),
    // which starts at zero every map and so runs far behind the wall clock.
    // The glitch used to be stamped with performance.now() when it fired and
    // read against simNow() here, so `p` came out hugely negative, the decay
    // term `(1 - p)^2.2` grew without bound, and the level slammed between
    // its two clamps every frame. The pulse never reached p >= 1, so it never
    // cleared: from the first glitch of a map, 4-10 seconds in, the whole
    // board strobed for the rest of the map. Reported as "the whole gameboard
    // background blinks".
    //
    // So the pulse is stamped by its first READ, in the reader's own clock,
    // which makes mixing the two impossible. And a reader clock that goes
    // backwards (the sim clock resets at every map start) drops the pulse
    // rather than feeding a negative phase into the curve.
    if (pulse.at === null) pulse.at = now;
    const p = (now - pulse.at) / pulse.durationMs;
    if (p >= 1 || p < 0 || !Number.isFinite(p)) pulse = null;
    else level += pulseShape(p, pulse.strength);
  }
  return Math.max(0.62, Math.min(1.18, level));
}

/** Test seam: drop any in-flight glitch. */
export function resetMonitor(): void {
  pulse = null;
}
