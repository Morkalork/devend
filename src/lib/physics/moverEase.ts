/**
 * The shape of a mover's speed across its travel.
 *
 * A mover ran at a constant speed and reversed instantly at each end. That is
 * legible as a position and illegible as a MOTION: nothing tells you the turn is
 * coming, so timing a cut past a patrol is a memory exercise rather than a read.
 *
 * ── Why this is normalised, and why that is the whole point ────────────────
 *
 * Eleven shipped maps time their necks against these patrols. A speed curve
 * that merely "feels better" would move every one of those windows, so the
 * curve is scaled so a full traverse takes EXACTLY as long as the constant-speed
 * one it replaces. The mover leaves each end when it always did and arrives at
 * the far end when it always did; only its distribution across the middle
 * changes, and only slightly.
 *
 * The taper is deliberately narrow and shallow for the same reason. A proper
 * ease-in-out, slow at the ends and fast through the middle, would read
 * beautifully and shift every mid-span crossing by a large fraction of a second.
 * This one halves the speed over the last few percent of the travel, which is
 * enough to see the turn coming and small enough that the compensation needed
 * in the middle is under three percent.
 */

/**
 * Fraction of the half-range over which the mover eases into its turn, and how
 * slow it gets there.
 *
 * Chosen by measuring, not by eye. The taper costs time that the middle has to
 * make up, and that compensation is what shifts mid-span crossings. A first
 * pass at 0.14 / 0.28 looked lovely and drifted the midpoint by 6.6 frames on a
 * two-second traverse, which is not "timing preserved" by any honest reading.
 * These halve the speed into the turn for under three frames of worst-case
 * drift; moverEase.test.ts holds that bound.
 */
const TAPER = 0.06;
const END_SPEED = 0.50;

/** Smoothstep, so the taper has no corner where it begins. */
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * The unnormalised speed multiplier at `u`, the fraction of the half-range
 * already travelled (0 at the centre, 1 at either end).
 */
function profile(u: number): number {
  const a = Math.abs(u);
  if (a <= 1 - TAPER) return 1;
  return 1 - (1 - END_SPEED) * smoothstep((a - (1 - TAPER)) / TAPER);
}

/**
 * The factor that restores the original traverse time.
 *
 * Time to cross is the integral of 1/speed, so tapering the ends makes a
 * traverse take longer; scaling the whole curve by this puts it back. Computed
 * from the constants above rather than written down, so tuning TAPER or
 * END_SPEED cannot silently leave the compensation stale, which would drift
 * every mover on the board a little further out of time with every cycle.
 */
export const MOVER_EASE_COMPENSATION = (() => {
  const STEPS = 2048;
  let time = 0;
  for (let i = 0; i < STEPS; i++) {
    const u = (i + 0.5) / STEPS;
    time += (1 / STEPS) / profile(u);
  }
  return time; // > 1: the middle must run this much faster to break even
})();

/**
 * Speed multiplier for a mover at `offset` within `half` of its centre.
 *
 * Normalised, so integrating it over a traverse gives exactly the constant-speed
 * traverse time.
 */
export function moverSpeedAt(offset: number, half: number): number {
  if (!(half > 0)) return 1;
  const u = Math.abs(offset) / half;
  return (profile(u) * MOVER_EASE_COMPENSATION) || 1;
}
