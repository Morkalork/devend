/**
 * Mutators — curse + blessing modifier bundles drafted in Ascension mode.
 *
 * After beating the final level the player may "ascend": pick one mutator
 * and loop back to level 1 with it active. Drafted mutators stack across
 * ascensions. Defined in public/mutators.yml; loaded by useMutatorManager.
 *
 * `modifiers` uses the same GameModifiers keys as upgrades.yml — a curse is
 * just an adverse value (e.g. ballSpeedMultiplier: 1.25).
 */
export interface MutatorConfig {
  id: string;
  name: string;
  curse: string; // short text of the downside, shown in red on the draft card
  blessing: string; // short text of the upside, shown in accent colour
  modifiers: Record<string, number>;
  /**
   * May this mutator be offered in the run-start loadout draft (the base-game
   * "Sprint Planning" pick), as opposed to only the post-final-level Ascension
   * draft? Defaults to true; set false on mutators whose curse is unfair as a
   * fresh-run opener (e.g. losing a life when you only have three).
   */
  startEligible?: boolean;
}

export interface AscensionConfig {
  /** Baseline ballSpeedMultiplier applied per ascension depth (compounds). */
  speedRampPerDepth: number;
  /** Ball hits an ascended fence survives on level 1 (durability eases in)… */
  fenceDurabilityBase: number;
  /** …declining linearly to this many hits on the final level. */
  fenceDurabilityAtFinal: number;
}

export interface MutatorData {
  ascension?: Partial<AscensionConfig>;
  mutators: MutatorConfig[];
}

export const DEFAULT_ASCENSION_CONFIG: AscensionConfig = {
  speedRampPerDepth: 1.08,
  fenceDurabilityBase: 6,
  fenceDurabilityAtFinal: 2,
};
