/**
 * useAchievementManager — achievements defined in public/achievements.yml.
 *
 * Tracks lifetime stats against each achievement's requirement, marks them
 * complete, and lets the player 'activate' completed achievements to enable
 * their bonus modifiers (exposed as bonusModifiers, merged into the
 * GameModifiers pipeline by useGameSession).
 *
 * Persistence: localStorage key ACHIEVEMENT_STORAGE_KEY (src/types/achievement.ts).
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import yaml from 'js-yaml';
import {
  Achievement,
  AchievementConfig,
  AchievementPersistence,
  ACHIEVEMENT_STORAGE_KEY,
} from '@/types/achievement';
import { MetaProgressionStats } from '@/types/metaProgression';
// The canonical multiplicative-key list: a local copy had drifted (missing the
// shop-discount and bonus-multiplier keys), which would mis-stack any second
// multiplicative achievement bonus.
import { GameModifiers, MULTIPLICATIVE_KEYS } from '@/hooks/useActiveModifiers';

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
  try {
    localStorage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to persist achievements', e);
  }
}

// Stable empty reference — returned when nothing is activated so that
// the achievements YAML loading mid-game doesn't produce a new object
// identity and accidentally bust the activeModifiers dep array.
const EMPTY_BONUSES: Partial<Record<keyof GameModifiers, number>> = {};

export function useAchievementManager() {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [activatedIds, setActivatedIds] = useState<string[]>([]);

  // Refs mirror the two persisted arrays so the mutators below have a single,
  // always-current source of truth to read+write+persist from, without nesting
  // setState calls inside one another (a React anti-pattern that can re-fire
  // the side-effecting save or read a stale value under concurrent rendering).
  const completedIdsRef = useRef<string[]>([]);
  const activatedIdsRef = useRef<string[]>([]);

  // Load achievements.yml and persistence on mount
  useEffect(() => {
    const stored = loadPersistence();
    completedIdsRef.current = stored.completedIds;
    activatedIdsRef.current = stored.activatedIds;
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
    const prev = completedIdsRef.current;
    const next = [...prev];
    let changed = false;
    for (const a of achievements) {
      if (next.includes(a.id)) continue;
      const current = stats[a.requirement.stat];
      if (typeof current === 'number' && current >= a.requirement.threshold) {
        next.push(a.id);
        changed = true;
      }
    }
    if (changed) {
      completedIdsRef.current = next;
      setCompletedIds(next);
      // activatedIds is untouched here; persist it from its ref to keep both
      // fields consistent without a second read of storage.
      savePersistence({ completedIds: next, activatedIds: activatedIdsRef.current });
    }
  }, [achievements]);

  /**
   * Activate a completed achievement so its bonus takes effect.
   */
  const activateAchievement = useCallback((id: string) => {
    if (activatedIdsRef.current.includes(id)) return;
    const next = [...activatedIdsRef.current, id];
    activatedIdsRef.current = next;
    setActivatedIds(next);
    savePersistence({ completedIds: completedIdsRef.current, activatedIds: next });
  }, []);

  /**
   * Bonus modifiers from activated achievements only.
   * Multiplicative bonuses stack by multiplication; additive by addition.
   */
  const bonusModifiers = useMemo((): Partial<Record<keyof GameModifiers, number>> => {
    if (activatedIds.length === 0) return EMPTY_BONUSES;
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
        const ratioA = (stats[a.requirement.stat] ?? 0) / a.requirement.threshold;
        const ratioB = (stats[b.requirement.stat] ?? 0) / b.requirement.threshold;
        return (Number.isFinite(ratioB) ? ratioB : 0) - (Number.isFinite(ratioA) ? ratioA : 0);
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
