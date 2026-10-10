/**
 * A box that scales about its own centre, and flashes when its key bumps: the
 * DOM's `animate-stat-flash` (a stat that just changed punches up and glows)
 * and `animate-pulse-heart` (the lives heart breathing). The kit has no
 * scale-in-place; Appear scales once on mount, from the top-left.
 *
 * Scale and brightness are applied straight to the Pixi node, the way Appear
 * does, so a 60fps pulse does not re-render React.
 */
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { animate } from "motion";
import { ColorMatrixFilter } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import { RESOLUTION, type Layout } from "../kit/ui";
import { FLASH_REST, STAT_FLASH_MS, statFlashAt, type FlashFrame } from "./topBarModel";

interface Props {
  /** Each increment past 0 replays the flash (the DOM remounted on a new key). */
  flashKey?: number;
  /** A standing scale on top of the flash (the heart's breath). */
  scale?: number;
  alpha?: number;
  layout?: Layout;
  children?: ReactNode;
}

export function StatFlash({ flashKey = 0, scale = 1, alpha = 1, layout, children }: Props) {
  const ref = useRef<LayoutContainer | null>(null);
  const frame = useRef<FlashFrame>(FLASH_REST);
  const base = useRef(scale);
  base.current = scale;
  const filter = useRef<ColorMatrixFilter | null>(null);

  const apply = useCallback(() => {
    const node = ref.current;
    if (!node || node.destroyed) return;
    const s = base.current * frame.current.scale;
    const box = node.layout?.computedLayout;
    // Keep the centre where layout put it: a point p lands at
    // position + s * (p - pivot), so the centre c stays put at pivot = c(1 - 1/s).
    const k = 1 - 1 / s;
    node.scale.set(s);
    node.pivot.set(((box?.width ?? 0) / 2) * k, ((box?.height ?? 0) / 2) * k);
    const b = frame.current.brightness;
    if (b > 1.001) {
      if (!filter.current) filter.current = new ColorMatrixFilter({ resolution: RESOLUTION });
      filter.current.brightness(b, false);
      node.filters = [filter.current];
    } else if (node.filters) {
      node.filters = null;
    }
  }, []);

  useEffect(() => { apply(); }, [scale, apply]);

  useEffect(() => {
    if (flashKey <= 0) return;
    const controls = animate(0, 1, {
      duration: STAT_FLASH_MS / 1000, ease: "linear",
      onUpdate: (p: number) => { frame.current = statFlashAt(p); apply(); },
    });
    return () => { controls.stop(); frame.current = FLASH_REST; apply(); };
  }, [flashKey, apply]);

  return (
    <layoutContainer ref={ref} layout={layout ?? {}} alpha={alpha}>
      {children}
    </layoutContainer>
  );
}
