/**
 * Clocks for the board overlays' animations. Split from the components (a
 * .tsx file exports only components) and from fxModel (which stays pure).
 */
import { useEffect, useRef, useState } from "react";

/**
 * Seconds since this component mounted (or `restartKey` changed), ticking each
 * frame until `duration` has passed, then holding there. A CSS animation keyed
 * on a toast's `key` replays when the key changes; keying the component on it
 * (or passing it here) does the same.
 *
 * `duration` Infinity runs for as long as the component lives (a loop).
 */
export function useElapsed(duration: number, running = true, restartKey: unknown = 0): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    setT(0);
    if (!running) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const s = (now - start) / 1000;
      if (s >= duration) { setT(duration); return; }
      setT(s);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, running, restartKey]);
  return t;
}

/** 0..1 sawtooth repeating every `periodMs` (a spinner's turn, a scan line's sweep). */
export function useCycle(periodMs: number, enabled = true): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT(((now - start) % periodMs) / periodMs);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [periodMs, enabled]);
  return t;
}

/**
 * A value that slides to its target at a constant rate over `seconds`: CSS
 * `transition: <prop> <seconds>s linear`. The kit's useTween eases out, which
 * on a value that steps once a second (a clock) reads as a lurch and a pause
 * every tick; a linear slide of exactly the tick's length reads as one sweep.
 * Starts at its target.
 */
export function useLinearSlide(target: number, seconds: number): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    if (!(seconds > 0) || from === target) {
      current.current = target;
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / (seconds * 1000));
      current.current = from + (target - from) * k;
      setValue(current.current);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, seconds]);
  return value;
}
