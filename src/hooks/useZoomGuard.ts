/**
 * Hold the browser's zoom off for every screen but the admin tools.
 *
 * Mounted once, high up, and keyed on the current screen rather than installed
 * per screen: the guard has to be ON by default and come off for a named few,
 * so that a screen added later is protected without anyone remembering to.
 */
import { useEffect } from "react";
import type { GameScreen } from "@/types/game";
import { installZoomGuard, zoomAllowedOn } from "@/lib/zoomGuard";

export function useZoomGuard(screen: GameScreen): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (zoomAllowedOn(screen)) return;
    return installZoomGuard(document);
  }, [screen]);
}
