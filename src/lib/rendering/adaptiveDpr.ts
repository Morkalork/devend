/**
 * adaptiveDpr — one-shot upward ramp of the canvas resolution.
 *
 * The board renders at a conservative 2x device-pixel cap by default, because a
 * phone's native 2.6-3.0x DPR multiplies per-frame fill + shadowBlur cost faster
 * than linearly (see boardConstants.ts). But a capable device leaves that budget
 * half-empty, and the 2x -> native upscale is what makes the image look soft.
 *
 * So: after a level has been running long enough to have representative timings,
 * check whether rendering at the higher cap would still fit the frame budget
 * (predicted from the measured cost, scaled by the resolution increase). If it
 * would, raise the DPR ceiling once and trigger a re-resize. If it wouldn't, do
 * nothing — the device stays safe at 2x. Upward-only, so it never oscillates.
 */

import {
  getDprCeiling,
  setDprCeiling,
  MAX_DEVICE_PIXEL_RATIO_HIGH,
} from "@/lib/boardConstants";
import { getFrameStats } from "./perfStats";

// Per-frame work (physics peak + scaled render peak) must stay under this for
// the ramp to fire. Well below one 60fps frame (16.7ms) so there's headroom for
// GC and compositing the ramp can't see.
const FRAME_BUDGET_MS = 10;
// Render cost grows a bit faster than the pixel-count ratio because shadowBlur
// radii scale with physical pixels too. ~2.2 is a conservative over-estimate, so
// we err toward NOT ramping.
const COST_EXPONENT = 2.2;
// Need a full-ish window before trusting the numbers.
const MIN_SAMPLES = 60;

/**
 * Decide whether to raise the DPR ceiling. Returns true (and calls onRamp) iff
 * it ramped, so the caller can re-resize the canvas. Safe to call repeatedly;
 * it's a no-op once already at the high cap or once the device shows no headroom.
 */
export function maybeRampDpr(onRamp: () => void): boolean {
  const native = window.devicePixelRatio || 1;
  const current = getDprCeiling();
  const target = Math.min(native, MAX_DEVICE_PIXEL_RATIO_HIGH);
  if (target <= current) return false; // nothing to gain (already native, or capped)

  const s = getFrameStats();
  if (s.samples < MIN_SAMPLES) return false; // not enough data yet

  const resolutionScale = Math.pow(target / current, COST_EXPONENT);
  const predictedMs = s.physPeak + s.renderPeak * resolutionScale;
  if (predictedMs > FRAME_BUDGET_MS) return false; // no headroom — stay safe

  setDprCeiling(target);
  onRamp();
  return true;
}
