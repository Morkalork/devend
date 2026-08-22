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
  /**
   * Never offered in either draft. For loadouts the game imposes rather than
   * lets you pick, such as the Ascension ladder's final forced curse: it is a
   * curse with no blessing, so drafting it would be a strictly bad choice
   * nobody would take on purpose.
   */
  neverDrafted?: boolean;
}

/**
 * One rung of the Ascension ladder: a single named rule that comes into force
 * at `depth` and stays in force for every depth above it.
 *
 * `effects` prefers RULES over stat nerfs. A rung that subtracts from a stat a
 * shop upgrade adds to turns that upgrade into a tax (see ascensionLadder.ts),
 * so the rule-shaped fields exist to give rungs something no purchase undoes.
 */
export interface AscensionRung {
  /** Ascension depth at which this rung comes into force (1-based). */
  depth: number;
  /** Short name, shown on the ladder card. Displayed text: no em-dashes. */
  name: string;
  /** One line explaining what changes. Displayed text: no em-dashes. */
  description: string;
  effects?: AscensionRungEffects;
}

export interface AscensionRungEffects {
  /** The shop opens only after odd-numbered levels. */
  shopEveryOtherLevel?: boolean;
  /** Cap the assignment door draft at this many offers. */
  doorOffers?: number;
  /**
   * Cap the DISTINCT abilities holdable at once, below the normal
   * MAX_ABILITY_SLOTS. A rules change rather than a stat nerf: the same
   * abilities, fewer of them at a time, so the chest you smash becomes a
   * choice about what you are willing to stop carrying.
   */
  abilitySlots?: number;
  /** No Promotion (capstone) draft this run. */
  noCapstone?: boolean;
  /** Completed fences wear out under ball hits (the old blanket depth rule). */
  fencesWearOut?: boolean;
  /** Every eligible map rolls a mutator (drops the "none" bucket). */
  everyMapMutated?: boolean;
  /** Multiplies pickup token lifetime; 0.5 halves it. */
  pickupLifetimeFactor?: number;
  /** A loadout id forced into the run and not removable. */
  forcedCurseLoadoutId?: string;
  /** Plain GameModifiers, for rungs whose counter is a real decision. */
  modifiers?: Record<string, number>;
}

/** Every rung at or below the current depth, folded into one rule set. */
export interface AscensionRules {
  shopEveryOtherLevel: boolean;
  doorOffers: number | null;
  /** Distinct abilities holdable at once; MAX_ABILITY_SLOTS unless tightened. */
  abilitySlots: number;
  noCapstone: boolean;
  fencesWearOut: boolean;
  everyMapMutated: boolean;
  pickupLifetimeFactor: number;
  forcedCurseLoadoutId: string | null;
  modifiers: Record<string, number>;
}

export interface AscensionConfig {
  /**
   * Baseline ballSpeedMultiplier applied per ascension depth (compounds).
   * Retained for saves and for depths past the ladder's end; the ladder's own
   * speed rung is what carries speed inside the named range.
   */
  speedRampPerDepth: number;
  /** Ball hits an ascended fence survives on level 1 (durability eases in)… */
  fenceDurabilityBase: number;
  /** …declining linearly to this many hits on the final level. */
  fenceDurabilityAtFinal: number;
  /** The named ladder. Empty falls back to the old flat per-depth behaviour. */
  ladder: AscensionRung[];
}

export interface LoadoutData {
  ascension?: Partial<AscensionConfig> & { ladder?: AscensionRung[] };
  loadouts: LoadoutConfig[];
}

export const DEFAULT_ASCENSION_CONFIG: AscensionConfig = {
  speedRampPerDepth: 1.08,
  fenceDurabilityBase: 6,
  fenceDurabilityAtFinal: 2,
  ladder: [],
};
