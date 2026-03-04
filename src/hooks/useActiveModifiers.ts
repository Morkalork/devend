import { useMemo } from 'react';
import { UpgradeConfig } from '@/types/upgrade';

/**
 * Central GameModifiers — the ONLY structure gameplay systems should read.
 * All modifier resolution happens here. No modifier logic elsewhere.
 */
export interface GameModifiers {
  // Multiplicative (cumulative product)
  ballSpeedMultiplier: number;
  ballSizeMultiplier: number;
  fenceGenerationSpeedMultiplier: number;
  fenceWidthMultiplier: number;
  scoreMultiplier: number;

  // Additive (sum)
  instantFencesPerMap: number;
  additionalConcurrentFences: number;
  bonusRemovalChance: number;
  bonusRemovalAmount: number;
  extraLives: number;
  scoreInterestRate: number;
  mapReductionPerFenceBonus: number;
  extraShopItems: number;
  extraAugmentationPoints: number;
}

// Keys that stack multiplicatively
const MULTIPLICATIVE_KEYS: (keyof GameModifiers)[] = [
  'ballSpeedMultiplier',
  'ballSizeMultiplier',
  'fenceGenerationSpeedMultiplier',
  'fenceWidthMultiplier',
  'scoreMultiplier',
];

const DEFAULT_MODIFIERS: GameModifiers = {
  ballSpeedMultiplier: 1,
  ballSizeMultiplier: 1,
  fenceGenerationSpeedMultiplier: 1,
  fenceWidthMultiplier: 1,
  scoreMultiplier: 1,
  instantFencesPerMap: 0,
  additionalConcurrentFences: 0,
  bonusRemovalChance: 0,
  bonusRemovalAmount: 0,
  extraLives: 0,
  scoreInterestRate: 0,
  mapReductionPerFenceBonus: 0,
  extraShopItems: 0,
  extraAugmentationPoints: 0,
};

/**
 * Aggregate modifiers from all owned upgrades plus optional extra bonuses
 * (e.g., from completed achievements). Multipliers multiply cumulatively;
 * flat values sum. Unknown modifier keys in YAML are silently ignored.
 */
export function computeGameModifiers(
  ownedUpgradeIds: string[],
  upgradeLookup: Map<string, UpgradeConfig>,
  extraBonuses?: Partial<Record<keyof GameModifiers, number>>,
): GameModifiers {
  const result = { ...DEFAULT_MODIFIERS };

  for (const id of ownedUpgradeIds) {
    const upgrade = upgradeLookup.get(id);
    if (!upgrade) continue;

    for (const [key, value] of Object.entries(upgrade.modifiers)) {
      if (!(key in result)) continue; // ignore unknown keys gracefully

      const k = key as keyof GameModifiers;
      if (MULTIPLICATIVE_KEYS.includes(k)) {
        (result as any)[k] *= value;
      } else {
        (result as any)[k] += value;
      }
    }
  }

  // Apply extra bonuses (e.g., from completed achievements)
  if (extraBonuses) {
    for (const [key, value] of Object.entries(extraBonuses)) {
      if (!(key in result)) continue;
      const k = key as keyof GameModifiers;
      if (MULTIPLICATIVE_KEYS.includes(k)) {
        (result as any)[k] *= value as number;
      } else {
        (result as any)[k] += value as number;
      }
    }
  }

  return result;
}

/**
 * React hook wrapper around computeGameModifiers.
 * Pass `extraBonuses` (e.g., from useAchievementManager.getBonusModifiers())
 * to include achievement bonuses in the computed result.
 */
export function useActiveModifiers(
  ownedUpgradeIds: string[],
  upgrades: UpgradeConfig[],
  extraBonuses?: Partial<Record<keyof GameModifiers, number>>,
): GameModifiers {
  return useMemo(() => {
    const lookup = new Map(upgrades.map(u => [u.id, u]));
    return computeGameModifiers(ownedUpgradeIds, lookup, extraBonuses);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedUpgradeIds, upgrades, extraBonuses]);
}
