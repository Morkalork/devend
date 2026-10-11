import { useEffect, useRef, useState } from "react";
import { animate } from "motion";

/** How a tween moves: eased out (the default, framer-motion's), or at a constant rate (CSS `linear`). */
export type TweenEase = "easeOut" | "linear" | "easeInOut";

/** A value that eases toward its target: framer-motion's animated number. */
export function useTween(target: number, duration = 0.3, ease: TweenEase = "easeOut"): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const controls = animate(from.current, target, {
      duration, ease,
      onUpdate: (v: number) => { from.current = v; setValue(v); },
    });
    return () => controls.stop();
  }, [target, duration, ease]);
  return value;
}

/** 0..1 back and forth forever, for a pulse or a breath. */
export function usePulse(periodMs = 1600, enabled = true): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT(0.5 - 0.5 * Math.cos(((now - start) / periodMs) * Math.PI * 2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [periodMs, enabled]);
  return t;
}

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
