import { useEffect, useRef, useState } from "react";
import { animate } from "motion";

/** A value that eases toward its target: framer-motion's animated number. */
export function useTween(target: number, duration = 0.3): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const controls = animate(from.current, target, {
      duration, ease: "easeOut",
      onUpdate: (v: number) => { from.current = v; setValue(v); },
    });
    return () => controls.stop();
  }, [target, duration]);
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

