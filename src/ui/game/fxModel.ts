/**
 * The board overlays' animation and colour arithmetic, pure so it can be
 * tested without a canvas.
 *
 * The DOM overlays animated with index.css keyframes and framer-motion
 * keyframe arrays. On the canvas the same curves are sampled here, by elapsed
 * time, so each effect keeps its exact timing: a CSS `ease-out` keyframe run
 * eases each segment between two stops, and so does `sampleKeyframes`.
 */
import { hsl } from "../theme";

// ── Colour ─────────────────────────────────────────────────────────────────

export interface CssColor {
  color: number;
  alpha: number;
}

/**
 * A CSS colour string as a 0xRRGGBB number plus its alpha. Covers the forms
 * the overlays are handed: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()` and
 * `hsl()` (the deadline frame's colour). Anything else reads as white, so a
 * bad value is visible rather than invisible.
 */
export function cssColor(s: string): CssColor {
  const v = s.trim().toLowerCase();
  if (v.startsWith("#")) {
    let h = v.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map(c => c + c).join("");
    const color = Number.parseInt(h.slice(0, 6), 16);
    const alpha = h.length >= 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
    if (Number.isFinite(color)) return { color, alpha };
  }
  const nums = (v.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  if (v.startsWith("rgb") && nums.length >= 3) {
    const [r, g, b] = nums.map(n => Math.max(0, Math.min(255, Math.round(n))));
    return { color: (r << 16) | (g << 8) | b, alpha: nums.length >= 4 ? nums[3] : 1 };
  }
  if (v.startsWith("hsl") && nums.length >= 3) {
    return { color: hsl(nums[0], nums[1], nums[2]), alpha: nums.length >= 4 ? nums[3] : 1 };
  }
  return { color: 0xffffff, alpha: 1 };
}

/** Just the colour number of a CSS colour string. */
export function cssHex(s: string): number {
  return cssColor(s).color;
}

// ── Easing ─────────────────────────────────────────────────────────────────

/** A CSS cubic-bezier timing function, solved for x by Newton then bisection. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 6; i++) {
      const err = sx(u) - t;
      const d = dx(u);
      if (Math.abs(err) < 1e-5) return sy(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0, hi = 1;
    u = t;
    for (let i = 0; i < 30; i++) {
      const x = sx(u);
      if (Math.abs(x - t) < 1e-5) break;
      if (x < t) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

export const EASE = {
  linear: (t: number) => Math.max(0, Math.min(1, t)),
  /** CSS `ease-out`. */
  out: cubicBezier(0, 0, 0.58, 1),
  /** CSS `ease-in-out` (and framer-motion's "easeInOut"). */
  inOut: cubicBezier(0.42, 0, 0.58, 1),
} as const;

// ── Keyframes ──────────────────────────────────────────────────────────────

/** One stop: `at` is the share of the run (0..1), the rest are the values there. */
export type Keyframe<K extends string> = { at: number } & Record<K, number>;

/**
 * The values at `progress` (0..1) along a keyframe run, easing each segment
 * between two stops the way a CSS animation does. Before the first stop the
 * first values hold; after the last, the last (`forwards`).
 */
export function sampleKeyframes<K extends string>(
  frames: readonly Keyframe<K>[], progress: number, ease: (t: number) => number = EASE.out,
): Record<K, number> {
  const p = Math.max(0, Math.min(1, progress));
  let i = 0;
  while (i < frames.length - 2 && p > frames[i + 1].at) i++;
  const a = frames[i];
  const b = frames[Math.min(i + 1, frames.length - 1)];
  const span = b.at - a.at;
  const local = span > 0 ? ease(Math.max(0, Math.min(1, (p - a.at) / span))) : 1;
  const out = {} as Record<K, number>;
  for (const k of Object.keys(a) as (K | "at")[]) {
    if (k === "at") continue;
    out[k] = a[k] + (b[k] - a[k]) * local;
  }
  return out;
}

/** index.css `chest-toast`: rise up, hold, then fade out (1.7s ease-out). */
export const CHEST_TOAST = {
  duration: 1.7,
  frames: [
    { at: 0, alpha: 0, y: 12, scale: 0.9 },
    { at: 0.12, alpha: 1, y: 0, scale: 1 },
    { at: 0.75, alpha: 1, y: -6, scale: 1 },
    { at: 1, alpha: 0, y: -22, scale: 0.98 },
  ] as Keyframe<"alpha" | "y" | "scale">[],
};

/** index.css `ability-icon-pop` (1.1s ease-out). */
export const ABILITY_ICON = {
  duration: 1.1,
  frames: [
    { at: 0, alpha: 0, scale: 0.6 },
    { at: 0.15, alpha: 1, scale: 1.12 },
    { at: 0.6, alpha: 1, scale: 1 },
    { at: 1, alpha: 0, scale: 1.15 },
  ] as Keyframe<"alpha" | "scale">[],
};

/**
 * index.css `bonus-fence-pulse` (0.85s ease-out). Opacity has a stop at 60%
 * that scale does not, so scale is linear-interpolated across it here, which
 * is what the browser does for a property missing from a stop.
 */
export const BONUS_PULSE = {
  duration: 0.85,
  frames: [
    { at: 0, alpha: 0.95, scale: 0.6 },
    { at: 0.6, alpha: 0.55, scale: 0.6 + (1.7 - 0.6) * 0.6 },
    { at: 1, alpha: 0, scale: 1.7 },
  ] as Keyframe<"alpha" | "scale">[],
};

/** index.css `deadline-flash` (1.2s ease-out; BoardAlert plays it in 0.8s). */
export const DEADLINE_FLASH = {
  duration: 1.2,
  frames: [
    { at: 0, alpha: 0, scale: 1.3 },
    { at: 0.25, alpha: 0.85, scale: 1 },
    { at: 1, alpha: 0, scale: 1 },
  ] as Keyframe<"alpha" | "scale">[],
  /** Under prefers-reduced-motion: no zoom, hold, then fade. */
  still: [
    { at: 0, alpha: 0.85, scale: 1 },
    { at: 0.6, alpha: 0.85, scale: 1 },
    { at: 1, alpha: 0, scale: 1 },
  ] as Keyframe<"alpha" | "scale">[],
};

/** PairTurnOverlay's hand-over splash (framer keyframes, 1.3s). */
export const PAIR_SPLASH = {
  duration: 1.3,
  frames: [
    { at: 0, alpha: 0, scale: 0.8 },
    { at: 0.15, alpha: 1, scale: 1 },
    { at: 0.75, alpha: 1, scale: 1 },
    { at: 1, alpha: 0, scale: 1.05 },
  ] as Keyframe<"alpha" | "scale">[],
};

/** The big countdown numeral's size: CSS `clamp(3rem, 22vw, 7rem)`. */
export function flashNumeralSize(screenWidth: number): number {
  return Math.max(48, Math.min(112, screenWidth * 0.22));
}

/** Tailwind's `sm:` breakpoint, for the toasts that grow on a wider screen. */
export const SM_BREAKPOINT = 640;
