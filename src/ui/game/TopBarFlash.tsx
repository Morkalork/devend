/**
 * A box that flashes when its key bumps, and can breathe: the DOM's
 * `animate-stat-flash` (a stat that just changed punches up and glows) and
 * `animate-pulse-heart` (the lives heart breathing). Both scale about the box's
 * centre, which is @pixi/layout's default transform origin (50%), so the
 * neighbours never move.
 *
 * Scale, alpha and brightness are applied straight to the Pixi node, the way
 * Appear does, so neither the flash nor the breath re-renders React.
 */
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { animate } from "motion";
import { ColorMatrixFilter } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import { RESOLUTION, type Layout } from "../kit/ui";
import { FLASH_REST, STAT_FLASH_MS, heartPulse, statFlashAt, type FlashFrame } from "./topBarModel";

interface Props {
  /** Each increment past 0 replays the flash (the DOM remounted on a new key). */
  flashKey?: number;
  /**
   * Breathe forever with this period in ms, under any flash: the lives
   * heart's `animate-pulse-heart` (heartPulse).
   */
  breatheMs?: number;
  layout?: Layout;
  children?: ReactNode;
}

/** Steps a second for a perpetual breath (see the breathing effect below). */
export const BREATH_FPS = 20;

export function StatFlash({ flashKey = 0, breatheMs, layout, children }: Props) {
  const ref = useRef<LayoutContainer | null>(null);
  const frame = useRef<FlashFrame>(FLASH_REST);
  // The breath's current scale; alpha goes straight onto the node.
  const breath = useRef(1);
  const filter = useRef<ColorMatrixFilter | null>(null);

  const apply = useCallback(() => {
    const node = ref.current;
    if (!node || node.destroyed) return;
    node.scale.set(breath.current * frame.current.scale);
    const b = frame.current.brightness;
    if (b > 1.001) {
      if (!filter.current) filter.current = new ColorMatrixFilter({ resolution: RESOLUTION });
      filter.current.brightness(b, false);
      node.filters = [filter.current];
    } else if (node.filters) {
      node.filters = null;
    }
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!breatheMs || !node) return;
    let raf = 0;
    let last = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // At BREATH_FPS, not every refresh. The heart breathes for the whole
      // map, and the interface canvas draws only when something on it changed
      // (ui/onDemand.ts): stepped every frame, this one slow pulse alone kept
      // the whole HUD redrawing 60 times a second. A 1.2s breath reads the
      // same in 20 steps a second.
      if (now - last < 1000 / BREATH_FPS) return;
      last = now;
      // 0..1 and back, like usePulse, without a React render per frame.
      const p = heartPulse(0.5 - 0.5 * Math.cos(((now - start) / breatheMs) * Math.PI * 2));
      breath.current = p.scale;
      if (!node.destroyed) node.alpha = p.alpha;
      apply();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      breath.current = 1;
      if (!node.destroyed) node.alpha = 1;
      apply();
    };
  }, [breatheMs, apply]);

  useEffect(() => {
    if (flashKey <= 0) return;
    const controls = animate(0, 1, {
      duration: STAT_FLASH_MS / 1000, ease: "linear",
      onUpdate: (p: number) => { frame.current = statFlashAt(p); apply(); },
    });
    return () => { controls.stop(); frame.current = FLASH_REST; apply(); };
  }, [flashKey, apply]);

  return (
    // Passive: only a wrapper, never a touch target of its own.
    <layoutContainer ref={ref} layout={layout ?? {}} eventMode="passive">
      {children}
    </layoutContainer>
  );
}
