/**
 * Loadouts — curse + blessing modifier bundles, drafted at the run start
 * ("Sprint Planning") to shape a run from level 1. Parked for now: Sprint
 * Planning is on hold and Ascension, which also drafted them, was removed.
 * Defined in public/loadouts.yml; loaded by useLoadoutManager.
 *
 * `modifiers` uses the same GameModifiers keys as upgrades.yml — a curse is
 * just an adverse value (e.g. ballSpeedMultiplier: 1.25).
 */
export interface LoadoutConfig {
  id: string;
  name: string;
  curse: string; // short text of the downside, shown in red on the draft card
  blessing: string; // short text of the upside, shown in accent colour
  modifiers: Record<string, number>;
  /**
   * How many UNIQUE wins (runs beaten with distinct run-start loadouts) the
   * player needs before this loadout unlocks for the run-start draft. Omit for
   * loadouts available from scratch.
   */
  uniqueWinsRequired?: number;
  /**
   * Never offered in the draft: for cards the game hands out some other way
   * rather than lets you pick.
   */
  neverDrafted?: boolean;
}

export interface LoadoutData {
  loadouts: LoadoutConfig[];
}
