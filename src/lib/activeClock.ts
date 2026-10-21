/**
 * The map's active-play clock, in whole seconds, for the HUD.
 *
 * It used to be React state on GameCanvas, pushed up into GameScreen's state
 * once a second: both of the game's largest components re-rendered every
 * second of every map, and with them every interface layer they file, for a
 * number most maps never show. Now the loop writes it here, and only a
 * component that shows time subscribes, and only on a map that has time to
 * show (a deadline, a boss, a speed-clear goal).
 */
import { useSyncExternalStore } from "react";

let seconds = 0;
const listeners = new Set<() => void>();

export function setActiveClock(s: number): void {
  if (s === seconds) return;
  seconds = s;
  for (const l of listeners) l();
}

export function getActiveClock(): number { return seconds; }

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/**
 * The clock, re-rendering the caller each second while `enabled`. Disabled,
 * it reads 0 and never re-renders, so a map with no clock costs nothing.
 */
export function useActiveSeconds(enabled: boolean): number {
  return useSyncExternalStore(subscribe, () => (enabled ? seconds : 0), () => 0);
}
