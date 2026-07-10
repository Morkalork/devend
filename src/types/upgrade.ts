export type UpgradeTier = 'Junior' | 'Senior' | 'Principal' | 'Architect' | 'Wizard';

/**
 * Build archetypes (issue: synergistic upgrades). Every upgrade carries one or
 * two tags; the shop weights its random offers toward tags the player already
 * owns, so a run naturally drifts into a build (Slay-the-Spire draft coherence).
 *   lock   — pays off locking balls away
 *   freeze — freezing balls and cashing them in
 *   bank   — overtime economy: interest, shop slots, restocks
 *   tempo  — fence speed and action economy
 *   risk   — push-your-luck: multipliers with downsides
 *   safety — lives, slower/smaller balls, information
 */
export type UpgradeTag = 'lock' | 'freeze' | 'bank' | 'tempo' | 'risk' | 'safety';

export interface UpgradeConfig {
  id: string;
  name: string;
  tier: UpgradeTier;
  description: string;
  /**
   * Overtime cost. Optional in the YAML source: when omitted the loader derives
   * it from the unlock level's base points x the tier factor (see
   * src/lib/upgradePricing.ts). After loading, this field is always populated
   * with the resolved cost, so consumers can read it directly.
   */
  cost?: number;
  unlockLevel?: number;
  prerequisites?: string[];
  /** Only offered while ascended (Ascension mode, depth ≥ 1) */
  ascensionOnly?: boolean;
  /**
   * Icon name (see upgradeIcons.ts registry) shown on the upgrade card.
   * Only set on the first tier of each family; higher tiers inherit it.
   */
  icon?: string;
  /** Build archetype tags; drives shop-offer weighting and the card chips. */
  tags?: UpgradeTag[];
  modifiers: Record<string, number>;
}

/**
 * Pricing config for the formula that derives upgrade costs from level points.
 * Lives under `pricing:` in public/upgrades.yml; see src/lib/upgradePricing.ts.
 */
export interface UpgradePricing {
  minCost: number;
  tierFactor: Record<UpgradeTier, number>;
}

/**
 * A set bonus: auto-granted (free, no purchase) while the player owns at least
 * `tagSets.threshold` upgrades carrying `tag`. Gives every archetype a build
 * goal beyond its individual pieces. Defined under `tagSets:` in upgrades.yml.
 */
export interface TagSetBonus {
  tag: UpgradeTag;
  name: string;
  description: string;
  modifiers: Record<string, number>;
}

export interface TagSetsConfig {
  /** Owned upgrades of a tag needed to activate its set bonus. */
  threshold: number;
  bonuses: TagSetBonus[];
}

export interface UpgradeData {
  pricing?: Partial<UpgradePricing>;
  tagSets?: TagSetsConfig;
  upgrades: UpgradeConfig[];
}

// Tag colors for the shop card chips (presentation only)
export const TAG_COLORS: Record<UpgradeTag, { bg: string; text: string }> = {
  lock:   { bg: 'bg-emerald-500/15', text: 'text-emerald-300' },
  freeze: { bg: 'bg-cyan-500/15',    text: 'text-cyan-300' },
  bank:   { bg: 'bg-yellow-500/15',  text: 'text-yellow-300' },
  tempo:  { bg: 'bg-orange-500/15',  text: 'text-orange-300' },
  risk:   { bg: 'bg-red-500/15',     text: 'text-red-300' },
  safety: { bg: 'bg-blue-500/15',    text: 'text-blue-300' },
};

// Tier colors for visual display (presentation only — no logic depends on tier)
export const TIER_COLORS: Record<UpgradeTier, { bg: string; text: string; border: string; glow?: string }> = {
  Junior:    { bg: 'bg-slate-500/20',  text: 'text-slate-300',  border: 'border-white/70' },
  Senior:    { bg: 'bg-blue-500/20',   text: 'text-blue-400',   border: 'border-blue-500/50' },
  Principal: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/50' },
  Architect: { bg: 'bg-amber-500/20',  text: 'text-amber-400',  border: 'border-amber-500/50',  glow: 'shadow-amber-500/30' },
  Wizard:    { bg: 'bg-emerald-400/20',text: 'text-emerald-300',border: 'border-emerald-400/50', glow: 'shadow-emerald-400/40' },
};
