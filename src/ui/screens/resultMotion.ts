/**
 * The between-maps screens' animated numbers. The kit's useTween starts AT its
 * target, which suits a value that changes; these screens animate up from zero
 * on mount, after a delay, which is what the DOM's framer-motion `initial`
 * values and its hand-rolled requestAnimationFrame count-up did.
 */
import { useEffect, useState } from "react";
import { animate } from "motion";
import { COUNT_UP_DELAY_MS, COUNT_UP_DURATION_MS, countUpAt } from "./levelCompleteModel";

/**
 * The overlay's two count-ups (this map's overtime and the run total), driven
 * by one frame loop so they land together, with the same delay and cubic
 * ease-out as the DOM. Restarts when either target changes.
 */
export function useCountUp(levelTarget: number, totalTarget: number): [number, number] {
  const [values, setValues] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      setValues([countUpAt(levelTarget, elapsed), countUpAt(totalTarget, elapsed)]);
      if (elapsed < COUNT_UP_DELAY_MS + COUNT_UP_DURATION_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelTarget, totalTarget]);
  return values;
}

/** 0 on mount, then eased out to `target` after `delay` seconds (a bar filling in). */
export function useGrowFromZero(target: number, duration: number, delay = 0): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const controls = animate(0, target, { duration, delay, ease: "easeOut", onUpdate: setValue });
    return () => controls.stop();
  }, [target, duration, delay]);
  return value;
}
