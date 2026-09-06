import { GameModifiers } from '@/hooks/useActiveModifiers';

/**
 * Effect types: all GameModifiers keys, plus the special 'startingLevelBonus'
 * which is handled separately in Index.tsx (takes the max, not sum).
 */
export type CertEffectType =
  | keyof GameModifiers
  | 'startingLevelBonus'
  /**
   * Puts a fence type in the player's slots from the start of every run
   * (FENCE_TYPES_PLAN.md). The only ACCOUNT-scoped grant: store and upgrade
   * grants live and die with a run, and this one is why the drill is in the
   * bar on map one for a player who owns it.
   */
  | 'grantsFenceType';

export interface CertEffect {
  type: CertEffectType;
  value: number;
  /**
   * For 'grantsFenceType': which type. A separate field rather than widening
   * `value` to a string, because every other effect in the store sums or maxes
   * a number and a union there would make all of them check their own type
   * before doing arithmetic.
   */
  fenceType?: string;
}

export interface CertLevel {
  cost: number;
  effect: CertEffect;
}

export interface Certificate {
  id: string;
  name: string;
  description: string;
  /**
   * 'always' is on the shelf from the very first run. At least one cert has to
   * be, or the store is a room full of locked doors: Certificate Hours accrue
   * from the first run and there was nothing whatsoever to spend them on, so
   * the whole currency was easy to forget existed.
   */
  unlockType: 'always' | 'upgrade-chain' | 'achievement' | 'hours-spent';
  /** For upgrade-chain: the leaf-node upgrade ID whose 3rd run purchase unlocks this cert */
  sourceUpgradeId?: string;
  /** For achievement: the achievement ID whose completion unlocks this cert */
  sourceAchievementId?: string;
  /** How many runs buying sourceUpgradeId are needed (default 3) */
  requiredRuns?: number;
  /** For hours-spent: lifetime Certificate Hours spent in the store needed to unlock */
  requiredHoursSpent?: number;
  levels: CertLevel[];
}

export interface CertConfig {
  certificates: Certificate[];
}

export interface CertPersistence {
  /** Running total of Certificate Hours (earn rate: 1 per 5 levels) */
  totalCertificateHours: number;
  /** upgradeId → number of runs where that max-tier upgrade was purchased */
  maxTierCounts: Record<string, number>;
  /** cert IDs that have been unlocked (threshold reached) */
  unlockedCertIds: string[];
  /** certId → highest level purchased (1-indexed) */
  certLevelsOwned: Record<string, number>;
  /** Lifetime Certificate Hours spent on cert levels (drives hours-spent unlocks) */
  lifetimeHoursSpent: number;
}

export const CERT_STORAGE_KEY = 'jezzball_certs_v1';

export const DEFAULT_CERT_PERSISTENCE: CertPersistence = {
  totalCertificateHours: 0,
  maxTierCounts: {},
  unlockedCertIds: [],
  certLevelsOwned: {},
  lifetimeHoursSpent: 0,
};
