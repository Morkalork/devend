/**
 * Looping animation clocks for the menu screens (the canvas stand-ins for the
 * CSS keyframes they used: the highlight ping, the shimmer sweep, a spinner,
 * the menu ball). Hooks, so they live in a .ts file of their own (lint:
 * react-refresh/only-export-components).
 */
import { useEffect, useState } from "react";

/** Seconds since mount, ticking every animation frame while `enabled`. */
export function useClock(enabled = true): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
  return t;
}

/** 0..1 sawtooth over `periodMs`: a CSS animation's progress, restarted forever. */
export function useLoop(periodMs: number, enabled = true): number {
  const t = useClock(enabled);
  return ((t * 1000) % periodMs) / periodMs;
}
