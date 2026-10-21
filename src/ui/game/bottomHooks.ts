/**
 * Hooks for the bottom stack's canvas components (kept out of the .tsx files
 * so those export components only).
 */
import { useEffect, useState, type RefObject } from "react";
import type { LayoutContainer } from "@pixi/layout/components";

export interface Point {
  x: number;
  y: number;
}

/**
 * A box's top-left in screen CSS px, followed while `enabled`.
 *
 * An absolutely positioned child is laid out against its parent, so a piece
 * that must cover the whole screen from inside a row (the menu's tap-outside
 * catcher) needs to know where the row is. Read once Yoga has placed the box
 * and again on every layout pass; `fallback` covers the first frame.
 */
export function useScreenOrigin(ref: RefObject<LayoutContainer | null>, enabled: boolean, fallback: Point): Point {
  const [origin, setOrigin] = useState<Point | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node) return;
    const read = () => {
      if (node.destroyed) return;
      const p = node.getGlobalPosition();
      setOrigin(prev => (prev && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5 ? prev : { x: p.x, y: p.y }));
    };
    read();
    node.on("layout", read);
    // Transforms are applied on the frame after a layout pass.
    const raf = requestAnimationFrame(read);
    return () => { node.off("layout", read); cancelAnimationFrame(raf); };
  }, [ref, enabled]);
  return origin ?? fallback;
}

/**
 * Re-render every `ms` while `active`. The ability timers' seconds readout
 * and their drop-out at zero; the bars themselves drain on their own frame
 * loop (DrainBar). This used to re-render the lane every animation frame,
 * and with it the layout of the whole interface.
 */
export function useTickEvery(active: boolean, ms: number): void {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick(n => (n + 1) & 0xffff), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}
