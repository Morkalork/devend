/**
 * Game feature catalogue — the general "Feature Unlocked" system.
 *
 * Some systems stay hidden until the player earns them mid-run. When the
 * unlock condition is met the run surfaces a "Feature Unlocked" modal
 * (FeatureUnlockedModal) and the feature is remembered forever
 * (UnlockState.unlockedFeatureIds, via useMetaProgression).
 *
 * To add a new unlockable feature: append an entry here (id + the level whose
 * completion reveals it + icon/colour), add its `features.<id>` i18n strings,
 * and gate the feature's UI on `isFeatureUnlocked('<id>')`.
 */
import { Backpack, LucideIcon } from 'lucide-react';

export interface GameFeature {
  /** Stable id; also the i18n namespace (`features.<id>.name` / `.body`). */
  id: string;
  /** Completing this level number, at ascension depth 0, unlocks the feature. */
  unlockLevel: number;
  icon: LucideIcon;
  /** Accent colour for the unlock modal. */
  color: string;
}

export const GAME_FEATURES: GameFeature[] = [
  // Loadouts: earned by beating the first boss on level 10.
  { id: 'loadouts', unlockLevel: 10, icon: Backpack, color: '#00ff88' },
];

export function getFeature(id: string): GameFeature | undefined {
  return GAME_FEATURES.find(f => f.id === id);
}

/** Every feature whose unlock level is exactly this level number. */
export function featuresUnlockedAtLevel(level: number): GameFeature[] {
  return GAME_FEATURES.filter(f => f.unlockLevel === level);
}

/**
 * Carry players forward from the pre-feature-system unlock flags so nobody
 * loses access they already earned. Today: the old `loadoutsIntroduced`
 * first-win flag maps to the 'loadouts' feature. Returns a new array (never
 * mutates the input) with any legacy grants merged in.
 */
export function seedLegacyFeatureUnlocks(ids: string[], loadoutsIntroduced: boolean): string[] {
  if (loadoutsIntroduced && !ids.includes('loadouts')) return [...ids, 'loadouts'];
  return ids;
}
