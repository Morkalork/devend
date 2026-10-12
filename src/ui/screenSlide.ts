/**
 * The slide between screens, on the canvas (CANVAS_UI_PLAN.md).
 *
 * It was a framer-motion slide of Index's DOM wrapper, which moved nothing a
 * player could see: every screen draws on the interface canvas, which sat
 * still while the empty wrapper slid underneath it, and the canvas pieces
 * pinned to DOM boxes had to chase the slide frame by frame. Now the canvas
 * root itself carries the new screen in from the side the player is heading
 * (deeper into a run from the right, back towards the menu from the left).
 *
 * Index starts a slide when the screen changes; CanvasUiRoot reads the offset.
 * The board screens do not slide: their board is a DOM canvas that cannot be
 * moved with the interface, and they have entrances of their own (the boot
 * reveal in, the shatter out). Nor does anything when the player asks for less
 * motion.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { prefersReducedMotion } from "./reducedMotion";

/** How long a slide takes, ms: the DOM slide's. */
export const SCREEN_SLIDE_MS = 280;

interface Slide { dir: 1 | -1; startedAt: number }
let slide: Slide | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  for (const l of listeners) l();
}

/** Carry the next screen in: `dir` 1 from the right, -1 from the left. */
export function startScreenSlide(dir: 1 | -1, now = performance.now()): void {
  if (prefersReducedMotion()) return;
  slide = { dir, startedAt: now };
  emit();
}

/** For tests. */
export function currentScreenSlide(): Slide | null {
  return slide;
}

/** CSS's `cubic-bezier(0.25, 0.1, 0.25, 1)`, the DOM slide's curve, at progress t. */
export function slideEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const x1 = 0.25, y1 = 0.1, x2 = 0.25, y2 = 1;
  const bx = (s: number) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
  const by = (s: number) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  // Solve bx(s) = t by bisection: monotonic for these control points.
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < t) lo = mid; else hi = mid;
  }
  return by((lo + hi) / 2);
}

/** Where the incoming screen sits, `elapsed` ms into a slide across `width`: from ±width to 0. */
export function slideOffset(elapsed: number, dir: 1 | -1, width: number): number {
  return dir * width * (1 - slideEase(elapsed / SCREEN_SLIDE_MS));
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The canvas's horizontal offset this frame; 0 when nothing is sliding. */
export function useScreenSlideOffset(width: number): number {
  useSyncExternalStore(subscribe, () => version, () => version);
  const [now, setNow] = useState(() => performance.now());
  const active = slide != null && now - slide.startedAt < SCREEN_SLIDE_MS;
  useEffect(() => {
    if (!slide) return;
    let raf = 0;
    const tick = (t: number) => {
      setNow(t);
      if (slide && t - slide.startedAt < SCREEN_SLIDE_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // A new slide (version) restarts the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  if (!slide || !active) return 0;
  return slideOffset(Math.max(0, now - slide.startedAt), slide.dir, width);
}
