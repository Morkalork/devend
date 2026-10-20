/**
 * Is the first screen finished loading?
 *
 * The startup splash (TapToStartGate) used to take its tap the moment it
 * appeared, and behind it the menu was often still arriving: buttons popping
 * in as the stats, the certificates and the music list loaded, the background
 * redrawing once its config came. Tapping past the splash showed all of that
 * as a flicker. Now each piece that changes the first screen after it appears
 * reports here, and the splash waits for every one of them.
 *
 * The pieces live in different parts of the tree (the session, Index, the DOM
 * background), which is why this is a small store and not a prop.
 */
import { useSyncExternalStore } from "react";

export type StartupPart =
  /** The welcome menu's stats, unlocks and certificates (useGameSession.menuDataReady). */
  | "menu"
  /** The music catalogue, loaded or failed: it decides the Jukebox button. */
  | "music"
  /** The DOM background with its config applied (CRTBackground). */
  | "background";

export const STARTUP_PARTS: readonly StartupPart[] = ["menu", "music", "background"];

const ready = new Set<StartupPart>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** This part of the first screen is done. Idempotent. */
export function markStartupReady(part: StartupPart): void {
  if (ready.has(part)) {
    return;
  }
  ready.add(part);
  notify();
}

/** Every part reported ready. */
export function isStartupReady(): boolean {
  return STARTUP_PARTS.every(p => ready.has(p));
}

/** The parts still loading, for the splash's diagnostics. */
export function pendingStartupParts(): StartupPart[] {
  return STARTUP_PARTS.filter(p => !ready.has(p));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders when the answer changes. */
export function useStartupReady(): boolean {
  return useSyncExternalStore(subscribe, isStartupReady, isStartupReady);
}

/** Tests only: start over. */
export function resetStartupReadiness(): void {
  ready.clear();
  notify();
}
