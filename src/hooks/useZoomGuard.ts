/**
 * Hold the browser's zoom off for every screen but the admin tools, and clean
 * up after the ones that get through.
 *
 * Mounted once, high up, and keyed on the current screen rather than installed
 * per screen: the guard has to be ON by default and come off for a named few,
 * so that a screen added later is protected without anyone remembering to.
 *
 * It returns whether the viewport is STUCK zoomed - zoomed, and still zoomed
 * after the undo had its chance (lib/viewportZoom). That is a fact about the
 * page, so it is read here where the page is watched, and handed to the game
 * screen to decide what to do about it. The decision it makes is to pause: a
 * board the player cannot see properly must not go on costing them lives.
 */
import { useEffect, useState } from "react";
import type { GameScreen } from "@/types/game";
import { installZoomGuard, zoomAllowedOn } from "@/lib/zoomGuard";
import { watchViewportZoom } from "@/lib/viewportZoom";

export function useZoomGuard(screen: GameScreen): boolean {
  const [zoomStuck, setZoomStuck] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    // The admin tools zoom on purpose. Undoing it there would fight the map
    // builder's own gesture, which is the bug its comments already record.
    if (zoomAllowedOn(screen)) {
      setZoomStuck(false);
      return;
    }
    const removeGuard = installZoomGuard(document);
    const stopWatching = watchViewportZoom(document, {
      onStuck: () => setZoomStuck(true),
      onClear: () => setZoomStuck(false),
    });
    return () => { stopWatching(); removeGuard(); };
  }, [screen]);

  return zoomStuck;
}
