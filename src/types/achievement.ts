import { GameModifiers } from '@/hooks/useActiveModifiers';

export type AchievementStat =
  | 'totalFencesDrawn'
  | 'highestLevelReached'
  | 'totalLevelsCompletedWithoutLoss'
  | 'totalLivesLost'
  | 'deepestAscension'
  | 'pushBonusesBanked';

export interface AchievementRequirement {
  stat: AchievementStat;
  threshold: number;
}

/** Human-readable labels for requirement stats (shared by the achievements
 *  screen and the certificate store's unlock tooltips). */
export const ACHIEVEMENT_STAT_LABELS: Record<AchievementStat, string> = {
  totalFencesDrawn: 'Fences drawn',
  highestLevelReached: 'Highest level',
  totalLevelsCompletedWithoutLoss: 'Flawless levels',
  totalLivesLost: 'Lives lost',
  deepestAscension: 'Deepest ascension',
  pushBonusesBanked: 'Push bonuses banked',
};

export interface AchievementBonus {
  modifier: keyof GameModifiers;
  value: number;
  description: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  requirement: AchievementRequirement;
  bonus: AchievementBonus;
}

export interface AchievementConfig {
  achievements: Achievement[];
}

export interface AchievementPersistence {
  completedIds: string[];
  activatedIds: string[];
}

export const ACHIEVEMENT_STORAGE_KEY = 'jezzball_achievements_v1';
