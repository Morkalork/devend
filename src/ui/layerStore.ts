/**
 * The canvas interface's layers: what each screen wants drawn on the one
 * shared interface canvas (CanvasUiRoot).
 *
 * A screen is still a React component in the DOM tree - that is where its
 * state, hooks and routing live - but what it draws goes onto the canvas. It
 * hands its canvas tree over through <CanvasLayer>, which files it here under
 * an id and a draw order, and the root renders every filed tree inside the
 * Pixi application. It is a portal, done with a tiny store, because a React
 * portal cannot cross from react-dom into @pixi/react's renderer.
 */
import { useSyncExternalStore, type ReactNode } from "react";

export interface UiLayer {
  id: string;
  /** Draw order: higher is on top. */
  z: number;
  node: ReactNode;
  /** Lock the page while this layer is up (CanvasUiRoot). Off for a layer drawn over a DOM screen that must still scroll. */
  lock: boolean;
}

const layers = new Map<string, UiLayer>();
const listeners = new Set<() => void>();
let version = 0;
let snapshot: UiLayer[] = [];

function emit(): void {
  version++;
  snapshot = [...layers.values()].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  for (const l of listeners) l();
}

export function setUiLayer(id: string, z: number, node: ReactNode, lock = true): void {
  layers.set(id, { id, z, node, lock });
  emit();
}

export function removeUiLayer(id: string): void {
  if (layers.delete(id)) emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Every layer, bottom first. Re-renders the caller when any layer changes. */
export function useUiLayers(): UiLayer[] {
  useSyncExternalStore(subscribe, () => version, () => version);
  return snapshot;
}

/** For tests. */
export function uiLayerIds(): string[] {
  return snapshot.map(l => l.id);
}
