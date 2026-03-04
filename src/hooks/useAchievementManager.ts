import { useState, useCallback, useEffect, useMemo } from 'react';
import yaml from 'js-yaml';
import {
  Achievement,
  AchievementConfig,
  AchievementPersistence,
  ACHIEVEMENT_STORAGE_KEY,
} from '@/types/achievement';
import { MetaProgressionStats } from '@/types/metaProgression';
import { GameModifiers } from '@/hooks/useActiveModifiers';

// Keys that stack multiplicatively (mirrors useActiveModifiers)
const MULTIPLICATIVE_KEYS: (keyof GameModifiers)[] = [
  'ballSpeedMultiplier',
  'ballSizeMultiplier',
  'fenceGenerationSpeedMultiplier',
  'fenceWidthMultiplier',
  'scoreMultiplier',
];

function loadPersistence(): AchievementPersistence {
  try {
    const stored = localStorage.getItem(ACHIEVEMENT_STORAGE_KEY);
    if (!stored) return { completedIds: [] };
    const parsed = JSON.parse(stored);
    return {
      completedIds: Array.isArray(parsed.completedIds) ? parsed.completedIds : [],
    };
  } catch {
    return { completedIds: [] };
  }
}

function savePersistence(state: AchievementPersistence): void {
  localStorage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify(state));
}

export function useAchievementManager() {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [completedIds, setCompletedIds] = useState<string[]>([]);

  // Load achievements.yml and persistence on mount
  useEffect(() => {
    const stored = loadPersistence();
    setCompletedIds(stored.completedIds);

    fetch('/achievements.yml')
      .then(r => r.text())
      .then(text => {
        const config = yaml.load(text) as AchievementConfig;
        setAchievements(config?.achievements ?? []);
      })
      .catch(() => {
        // achievements.yml not found or invalid — silently ignore
      });
  }, []);

  /**
   * Check current stats against all achievements and mark newly completed ones.
   * Call this whenever stats change (e.g., after level complete).
   */
  const checkAndComplete = useCallback((stats: MetaProgressionStats) => {
    setCompletedIds(prev => {
      const next = [...prev];
      let changed = false;
      for (const a of achievements) {
        if (next.includes(a.id)) continue;
        const current = stats[a.requirement.stat];
        if (current >= a.requirement.threshold) {
          next.push(a.id);
          changed = true;
        }
      }
      if (changed) {
        savePersistence({ completedIds: next });
        return next;
      }
      return prev;
    });
  }, [achievements]);

  /**
   * Bonus modifiers from all completed achievements.
   * Multiplicative bonuses stack by multiplication; additive by addition.
   */
  const bonusModifiers = useMemo((): Partial<Record<keyof GameModifiers, number>> => {
    const result: Partial<Record<keyof GameModifiers, number>> = {};
    for (const id of completedIds) {
      const a = achievements.find(x => x.id === id);
      if (!a) continue;
      const k = a.bonus.modifier;
      if (MULTIPLICATIVE_KEYS.includes(k)) {
        result[k] = (result[k] ?? 1) * a.bonus.value;
      } else {
        result[k] = (result[k] ?? 0) + a.bonus.value;
      }
    }
    return result;
  }, [completedIds, achievements]);

  /**
   * The 10 incomplete achievements closest to completion (by progress ratio),
   * followed by all completed achievements (sorted by id for stability).
   * Returns at most 10 incomplete ones.
   */
  const getClosestAchievements = useCallback((stats: MetaProgressionStats): Achievement[] => {
    const incomplete = achievements
      .filter(a => !completedIds.includes(a.id))
      .sort((a, b) => {
        const ratioA = stats[a.requirement.stat] / a.requirement.threshold;
        const ratioB = stats[b.requirement.stat] / b.requirement.threshold;
        return ratioB - ratioA; // closer to threshold = higher ratio = comes first
      });
    return incomplete.slice(0, 10);
  }, [achievements, completedIds]);

  return {
    achievements,
    completedIds,
    bonusModifiers,
    checkAndComplete,
    getClosestAchievements,
  };
}
