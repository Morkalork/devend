/**
 * Draws its children at the screen's top-left, above every other layer.
 *
 * The kit's Modal is absolutely positioned against its PARENT, so one opened
 * from a bar at the bottom of the screen would be laid out from the bar's
 * corner, and the rows drawn after the bar would cover its backdrop and stay
 * tappable through it. The DOM explainers were `fixed z-[80]` for exactly this.
 * So the bar files the modal as its own layer (layerStore's portal), which the
 * root draws full-screen and on top.
 */
import { useId, type ReactNode } from "react";
import { CanvasLayer } from "../CanvasLayer";

/** Above the play screen's own layer, as the DOM's z-[80] was above its z-20 stack. */
const OVERLAY_Z = 1000;

export function ScreenOverlay({ children }: { children: ReactNode }) {
  const id = useId();
  // lock off: this layer only ever sits over a screen that has already made
  // its own choice about locking the page.
  return <CanvasLayer id={`overlay${id}`} z={OVERLAY_Z} lock={false}>{children}</CanvasLayer>;
}
