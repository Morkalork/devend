/**
 * What the loadout gallery shows, split from the drawing so it can be tested
 * without a canvas (canvas port of components/game/LoadoutGalleryScreen).
 */
import type { LoadoutConfig } from "@/types/loadout";
import { isLoadoutUnlocked } from "@/lib/loadoutUnlock";

export interface LoadoutGallery {
  /** Distinct run-start loadouts the player has won with. */
  uniqueWins: number;
  /** How many loadouts are win-gated at all: the counter's denominator. */
  totalGated: number;
  unlocked: LoadoutConfig[];
  locked: LoadoutConfig[];
}

export function loadoutGallery(loadouts: LoadoutConfig[], wonLoadoutIds: string[]): LoadoutGallery {
  const uniqueWins = wonLoadoutIds.length;
  return {
    uniqueWins,
    totalGated: loadouts.filter(l => l.uniqueWinsRequired != null).length,
    unlocked: loadouts.filter(l => isLoadoutUnlocked(l, uniqueWins)),
    locked: loadouts.filter(l => !isLoadoutUnlocked(l, uniqueWins)),
  };
}

export interface LockedLoadoutProgress {
  required: number;
  /** Unique wins still needed. */
  remaining: number;
  /** Wins counted toward this one, capped at the requirement. */
  current: number;
  /** 0..1 for the bar. */
  value: number;
}

export function lockedLoadoutProgress(loadout: LoadoutConfig, uniqueWins: number): LockedLoadoutProgress {
  const required = loadout.uniqueWinsRequired ?? 0;
  const current = Math.min(uniqueWins, required);
  return {
    required,
    remaining: Math.max(0, required - uniqueWins),
    current,
    value: required > 0 ? current / required : 0,
  };
}
