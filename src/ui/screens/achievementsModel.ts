/**
 * What the achievements screen shows, split from the drawing so it can be
 * tested without a canvas (canvas port of components/game/AchievementsScreen).
 */
import type { Achievement } from "@/types/achievement";
import type { MetaProgressionStats } from "@/types/metaProgression";

export interface AchievementSections {
  /** Completed, not yet switched on: the ones with an Activate button. */
  available: Achievement[];
  active: Achievement[];
  /** Not completed yet, closest to done first. */
  remaining: Achievement[];
}

export function splitAchievements(
  achievements: Achievement[],
  completedIds: string[],
  activatedIds: string[],
  metaStats: MetaProgressionStats,
): AchievementSections {
  const available = achievements.filter(a => completedIds.includes(a.id) && !activatedIds.includes(a.id));
  const active = achievements.filter(a => activatedIds.includes(a.id));
  const remaining = achievements
    .filter(a => !completedIds.includes(a.id))
    .sort((a, b) => {
      const ra = metaStats[a.requirement.stat] / a.requirement.threshold;
      const rb = metaStats[b.requirement.stat] / b.requirement.threshold;
      return rb - ra;
    });
  return { available, active, remaining };
}

export interface AchievementProgress {
  current: number;
  target: number;
  /** 0..1, capped: a stat past its threshold reads as a full bar. */
  ratio: number;
  pct: number;
}

export function achievementProgress(a: Achievement, metaStats: MetaProgressionStats): AchievementProgress {
  const current = metaStats[a.requirement.stat];
  const target = a.requirement.threshold;
  const ratio = Math.min(1, current / target);
  return { current, target, ratio, pct: Math.round(ratio * 100) };
}
