import { GameModifiers } from '@/hooks/useActiveModifiers';

export type AchievementStat =
  | 'totalFencesDrawn'
  | 'highestLevelReached'
  | 'totalLevelsCompletedWithoutLoss'
  | 'totalLivesLost';

export interface AchievementRequirement {
  stat: AchievementStat;
  threshold: number;
}

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
}

export const ACHIEVEMENT_STORAGE_KEY = 'jezzball_achievements_v1';
