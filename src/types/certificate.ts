import { GameModifiers } from '@/hooks/useActiveModifiers';

/**
 * Effect types: all GameModifiers keys, plus the special 'startingLevelBonus'
 * which is handled separately in Index.tsx (takes the max, not sum).
 */
export type CertEffectType = keyof GameModifiers | 'startingLevelBonus';

export interface CertEffect {
  type: CertEffectType;
  value: number;
}

export interface CertLevel {
  cost: number;
  effect: CertEffect;
}

export interface Certificate {
  id: string;
  name: string;
  description: string;
  unlockType: 'upgrade-chain' | 'achievement' | 'hours-spent';
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
