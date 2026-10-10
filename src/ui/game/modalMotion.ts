/**
 * Motion the play screen's overlays need and the kit's hooks do not cover.
 * Hooks live in a .ts file so the component files export components only.
 */
import { useEffect, useState } from "react";

/**
 * An angle in radians that turns once every `periodMs`, forever: Tailwind's
 * `animate-spin` (a linear 1s turn). usePulse eases back and forth, which is
 * the wrong shape for a spinner.
 */
export function useSpin(periodMs = 1000, enabled = true): number {
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setAngle((((now - start) % periodMs) / periodMs) * Math.PI * 2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [periodMs, enabled]);
  return angle;
}
