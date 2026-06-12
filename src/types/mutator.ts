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
}

export interface AscensionConfig {
  /** Baseline ballSpeedMultiplier applied per ascension depth (compounds). */
  speedRampPerDepth: number;
}

export interface MutatorData {
  ascension?: Partial<AscensionConfig>;
  mutators: MutatorConfig[];
}

export const DEFAULT_ASCENSION_CONFIG: AscensionConfig = {
  speedRampPerDepth: 1.08,
};
