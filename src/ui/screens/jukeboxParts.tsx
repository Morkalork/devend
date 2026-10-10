/**
 * The Jukebox's seek bar on the canvas: tap anywhere along it to jump there
 * (the DOM read the click's x against the bar's bounding box).
 */
import { useRef } from "react";
import type { FederatedPointerEvent } from "pixi.js";
import type { LayoutContainer } from "@pixi/layout/components";
import { COLOR, PRESS_SLOP_PX, View, tint } from "../kit/ui";

export function SeekBar({ progress, color, onSeek }: { progress: number; color: number; onSeek: (fraction: number) => void }) {
  const boxRef = useRef<LayoutContainer | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  const p = Math.max(0, Math.min(1, progress));
  return (
    // A 14px touch strip around the 6px bar; a drag that wanders (a scroll)
    // does not seek.
    <layoutContainer
      ref={boxRef}
      layout={{ marginTop: 4, height: 14, justifyContent: "center" }}
      eventMode="static"
      cursor="pointer"
      onPointerDown={(e: FederatedPointerEvent) => { down.current = { x: e.global.x, y: e.global.y }; }}
      onPointerUp={(e: FederatedPointerEvent) => {
        const start = down.current;
        down.current = null;
        const box = boxRef.current;
        const width = box?.layout?.computedLayout.width ?? 0;
        if (!start || !box || width <= 0) return;
        if (Math.hypot(e.global.x - start.x, e.global.y - start.y) > PRESS_SLOP_PX) return;
        onSeek(box.toLocal(e.global).x / width);
      }}
      onPointerUpOutside={() => { down.current = null; }}
    >
      <View layout={{ height: 6, borderRadius: 3, backgroundColor: tint(COLOR.muted, 0.5), flexDirection: "row" }}>
        <View layout={{ width: `${p * 100}%`, height: 6, borderRadius: 3, backgroundColor: color }} />
      </View>
    </layoutContainer>
  );
}
