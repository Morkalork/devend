/**
 * Small pieces shared by the fence slot and ability bars.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { animate } from "motion";
import type { LayoutContainer } from "@pixi/layout/components";
import { RADIUS, View, tint } from "../kit/ui";
import { ABILITY_BLINK } from "./bottomModel";

/**
 * The lit ring around a selected slot or an armed ability: the DOM's coloured
 * box-shadow glow, drawn as an outer border. Absolutely positioned, so lighting
 * it never changes the button's size or moves its neighbours.
 */
export function GlowRing({ color }: { color: number }) {
  return (
    <View layout={{
      position: "absolute", left: -3, top: -3, right: -3, bottom: -3,
      borderRadius: RADIUS.md + 3, borderWidth: 2, borderColor: tint(color, 0.6),
    }} />
  );
}

/**
 * A button's blink when its charge count rises: framer-motion's opacity
 * keyframes over a glow in the button's colour. Mount it under a new key to
 * replay it.
 */
export function BlinkRing({ color }: { color: number }) {
  const ref = useRef<LayoutContainer | null>(null);
  // Hidden before the first paint, so it does not flash fully lit for a frame.
  useLayoutEffect(() => { if (ref.current) ref.current.alpha = 0; }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const controls = animate(0, [...ABILITY_BLINK.keyframes], {
      duration: ABILITY_BLINK.duration,
      times: [...ABILITY_BLINK.times],
      onUpdate: (v: number) => { if (!node.destroyed) node.alpha = v; },
    });
    return () => controls.stop();
  }, []);
  return (
    // Inert: a decoration over the button, never a touch target of its own.
    <layoutContainer ref={ref} eventMode="none" layout={{
      position: "absolute", left: -1, top: -1, right: -1, bottom: -1,
      borderRadius: RADIUS.md, borderWidth: 3, borderColor: color, backgroundColor: tint(color, 0.3),
    }} />
  );
}
