export type UpgradeTier = 'Junior' | 'Senior' | 'Principal' | 'Architect' | 'Wizard';

export interface UpgradeConfig {
  id: string;
  name: string;
  tier: UpgradeTier;
  description: string;
  cost: number;
  unlockLevel?: number;
  prerequisites?: string[];
  /** Only offered while ascended (Ascension mode, depth ≥ 1) */
  ascensionOnly?: boolean;
  /**
   * Icon name (see upgradeIcons.ts registry) shown on the upgrade card.
   * Only set on the first tier of each family; higher tiers inherit it.
   */
  icon?: string;
  modifiers: Record<string, number>;
}

export interface UpgradeData {
  upgrades: UpgradeConfig[];
}

// Tier colors for visual display (presentation only — no logic depends on tier)
export const TIER_COLORS: Record<UpgradeTier, { bg: string; text: string; border: string; glow?: string }> = {
  Junior:    { bg: 'bg-slate-500/20',  text: 'text-slate-300',  border: 'border-white/70' },
  Senior:    { bg: 'bg-blue-500/20',   text: 'text-blue-400',   border: 'border-blue-500/50' },
  Principal: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/50' },
  Architect: { bg: 'bg-amber-500/20',  text: 'text-amber-400',  border: 'border-amber-500/50',  glow: 'shadow-amber-500/30' },
  Wizard:    { bg: 'bg-emerald-400/20',text: 'text-emerald-300',border: 'border-emerald-400/50', glow: 'shadow-emerald-400/40' },
};
