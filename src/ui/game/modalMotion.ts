/**
 * Hooks the play screen's overlays need and the kit does not cover: motion,
 * and reading back a box's laid-out size. Hooks live in a .ts file so the
 * component files export components only.
 */
import { useEffect, useState, type RefObject } from "react";
import type { LayoutContainer } from "@pixi/layout/components";

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

/**
 * The size Yoga gave a box, read back after each layout pass ("layout"
 * event), for drawing that has to fit a box whose size comes from its content.
 * 0x0 until the first pass.
 */
export function useBoxSize(ref: RefObject<LayoutContainer | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const onLayout = (l: { computedLayout: { width: number; height: number } }) => {
      const w = Math.round(l.computedLayout.width), h = Math.round(l.computedLayout.height);
      setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    box.on("layout", onLayout);
    // The first pass may already have run before this effect attached.
    const done = box.layout?.computedLayout;
    if (done && done.width > 0) onLayout({ computedLayout: done });
    return () => { box.off("layout", onLayout); };
  }, [ref]);
  return size;
}
