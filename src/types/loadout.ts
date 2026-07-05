/**
 * Loadouts — curse + blessing modifier bundles. One is drafted at the run start
 * ("Sprint Planning") to shape a run from level 1; the same catalogue also
 * powers the post-final-level Ascension draft, where drafted loadouts stack
 * across ascensions. Defined in public/loadouts.yml; loaded by useLoadoutManager.
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
   * loadouts available from scratch. Ignored by the Ascension draft, which
   * always offers the full catalogue.
   */
  uniqueWinsRequired?: number;
}

export interface AscensionConfig {
  /** Baseline ballSpeedMultiplier applied per ascension depth (compounds). */
  speedRampPerDepth: number;
  /** Ball hits an ascended fence survives on level 1 (durability eases in)… */
  fenceDurabilityBase: number;
  /** …declining linearly to this many hits on the final level. */
  fenceDurabilityAtFinal: number;
}

export interface LoadoutData {
  ascension?: Partial<AscensionConfig>;
  loadouts: LoadoutConfig[];
}

export const DEFAULT_ASCENSION_CONFIG: AscensionConfig = {
  speedRampPerDepth: 1.08,
  fenceDurabilityBase: 6,
  fenceDurabilityAtFinal: 2,
};
