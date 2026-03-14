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
    if (!stored) return { completedIds: [], activatedIds: [] };
    const parsed = JSON.parse(stored);
    return {
      completedIds: Array.isArray(parsed.completedIds) ? parsed.completedIds : [],
      activatedIds: Array.isArray(parsed.activatedIds) ? parsed.activatedIds : [],
    };
  } catch {
    return { completedIds: [], activatedIds: [] };
  }
}

function savePersistence(state: AchievementPersistence): void {
  localStorage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify(state));
}

export function useAchievementManager() {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [activatedIds, setActivatedIds] = useState<string[]>([]);

  // Load achievements.yml and persistence on mount
  useEffect(() => {
    const stored = loadPersistence();
    setCompletedIds(stored.completedIds);
    setActivatedIds(stored.activatedIds);

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
        // Save with current activatedIds (read from storage to avoid stale closure)
        const stored = loadPersistence();
        savePersistence({ completedIds: next, activatedIds: stored.activatedIds });
        return next;
      }
      return prev;
    });
  }, [achievements]);

  /**
   * Activate a completed achievement so its bonus takes effect.
   */
  const activateAchievement = useCallback((id: string) => {
    setActivatedIds(prev => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      setCompletedIds(completed => {
        savePersistence({ completedIds: completed, activatedIds: next });
        return completed;
      });
      return next;
    });
  }, []);

  /**
   * Bonus modifiers from activated achievements only.
   * Multiplicative bonuses stack by multiplication; additive by addition.
   */
  const bonusModifiers = useMemo((): Partial<Record<keyof GameModifiers, number>> => {
    const result: Partial<Record<keyof GameModifiers, number>> = {};
    for (const id of activatedIds) {
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
  }, [activatedIds, achievements]);

  /**
   * The incomplete achievements sorted by progress ratio (closest first).
   */
  const getClosestAchievements = useCallback((stats: MetaProgressionStats): Achievement[] => {
    return achievements
      .filter(a => !completedIds.includes(a.id))
      .sort((a, b) => {
        const ratioA = stats[a.requirement.stat] / a.requirement.threshold;
        const ratioB = stats[b.requirement.stat] / b.requirement.threshold;
        return ratioB - ratioA;
      });
  }, [achievements, completedIds]);

  return {
    achievements,
    completedIds,
    activatedIds,
    bonusModifiers,
    checkAndComplete,
    activateAchievement,
    getClosestAchievements,
  };
}
