import { useLayoutEffect, type ReactNode } from "react";
import { removeUiLayer, setUiLayer } from "./layerStore";

/**
 * Draw `children` on the shared interface canvas (layerStore.ts). Renders
 * nothing in the DOM. The children are re-filed on every render, so they see
 * the screen's current state exactly as DOM children would.
 */
export function CanvasLayer({ id, z = 0, lock = true, children }: { id: string; z?: number; lock?: boolean; children: ReactNode }) {
  useLayoutEffect(() => {
    setUiLayer(id, z, children, lock);
  });
  useLayoutEffect(() => () => removeUiLayer(id), [id]);
  return null;
}
