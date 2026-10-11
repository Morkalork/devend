/**
 * The one gap the board's drag surfaces (RubberBandOverlay, LaunchOverlay)
 * have to fill by hand: Pixi's event system never listens for `pointercancel`.
 * A touch the system takes away mid-drag (an edge swipe, a notification
 * shade) would leave the drag open for ever, and the surface, which holds one
 * drag at a time, refusing every new one. The DOM overlays treated a cancel as
 * a release; this hears it on the window so they can do the same.
 */
import { useEffect, useRef } from "react";

export function usePointerCancel(onCancel: (pointerId: number) => void): void {
  const handler = useRef(onCancel);
  useEffect(() => { handler.current = onCancel; });
  useEffect(() => {
    const listen = (e: PointerEvent) => handler.current(e.pointerId);
    window.addEventListener("pointercancel", listen, true);
    return () => window.removeEventListener("pointercancel", listen, true);
  }, []);
}
