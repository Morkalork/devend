/**
 * useLevelManager — loads public/map.yml and owns the level sequence.
 *
 * Multiple map entries may share one logical level number ('variants');
 * loadLevels() picks one variant per level at random to build the run's
 * sequence. Exposes the current level config plus advance/reset helpers.
 */
import { useState, useCallback } from 'react';
import yaml from 'js-yaml';
import { LevelConfig, LevelData, LevelEntity } from '@/types/level';

interface LevelManagerState {
  allMaps: LevelConfig[]; // all maps from YAML
  levelSequence: LevelConfig[]; // one randomly-chosen map per logical level
  currentLevelIndex: number;
  isLoading: boolean;
  error: string | null;
}

/**
 * Dev-time pay-curve sanity check. Warns (does not throw) when, across the
 * level-sorted maps, reward `points` decreases or fails the engine invariant
 * `points > expectedCuts`. Keeps the overtime curve monotonic as levels are
 * added later — independent of how many levels exist. No-op in production.
 */
function warnOnPayCurveRegressions(allMaps: LevelConfig[]): void {
  if (!import.meta.env.DEV) return;
  const byLevel = new Map<number, LevelConfig>();
  for (const map of allMaps) {
    if (!byLevel.has(map.level)) byLevel.set(map.level, map);
  }
  const sorted = [...byLevel.keys()].sort((a, b) => a - b);
  let prevPoints: number | null = null;
  for (const lvl of sorted) {
    const m = byLevel.get(lvl)!;
    if (prevPoints !== null && m.points < prevPoints) {
      console.warn(
        `[pay curve] Level ${lvl} points (${m.points}) is lower than the previous level (${prevPoints}) — pay should grow steadily.`,
      );
    }
    if (m.points <= m.expectedCuts) {
      console.warn(
        `[pay curve] Level ${lvl} points (${m.points}) must exceed expectedCuts (${m.expectedCuts}).`,
      );
    }
    prevPoints = m.points;
  }
}

/** Group maps by their `level` field, then pick one random map per level */
function buildLevelSequence(allMaps: LevelConfig[]): LevelConfig[] {
  const groups = new Map<number, LevelConfig[]>();
  for (const map of allMaps) {
    const lvl = map.level;
    if (!groups.has(lvl)) groups.set(lvl, []);
    groups.get(lvl)!.push(map);
  }

  // Sort by level number, pick one random variant per level
  const sortedLevels = [...groups.keys()].sort((a, b) => a - b);
  return sortedLevels.map(lvl => {
    const variants = groups.get(lvl)!;
    return variants[Math.floor(Math.random() * variants.length)];
  });
}

export function useLevelManager() {
  const [state, setState] = useState<LevelManagerState>({
    allMaps: [],
    levelSequence: [],
    currentLevelIndex: 0,
    isLoading: false,
    error: null,
  });

  const loadLevels = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await fetch('/map.yml', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Failed to load map.yml: ${response.status}`);
      }
      
      const yamlText = await response.text();
      const data = yaml.load(yamlText) as LevelData;
      
      if (!data?.levels || !Array.isArray(data.levels) || data.levels.length === 0) {
        throw new Error('Invalid map.yml: no levels found');
      }

      // Validate level structure. A single malformed level is skipped (with a
      // warning) rather than bricking the entire game — only an empty result
      // after filtering is fatal.
      const validLevels = data.levels.filter((level) => {
        try {
          // Issue #37: levels declare `maxBalls` (the game picks ball types);
          // legacy `balls` arrays are still accepted for backward compatibility.
          const hasBallSpec = typeof level.maxBalls === 'number' || Array.isArray(level.balls);
          if (!level.id || typeof level.sizeThreshold !== 'number' || !hasBallSpec) {
            throw new Error(`Invalid level configuration for: ${level.id || 'unknown'}`);
          }

          if (typeof level.expectedCuts !== 'number' || typeof level.points !== 'number') {
            throw new Error(`Level "${level.id}" is missing expectedCuts or points`);
          }

          if (level.expectedCuts >= level.points) {
            throw new Error(`Level "${level.id}" is invalid: expectedCuts (${level.expectedCuts}) must be less than points (${level.points})`);
          }

          // Default level number from id if not specified
          if (typeof level.level !== 'number') {
            const match = level.id.match(/^level-(\d+)/);
            level.level = match ? parseInt(match[1], 10) : 1;
          }

          if (level.entities && Array.isArray(level.entities)) {
            for (const entity of level.entities) {
              const ent = entity as LevelEntity;
              if (!ent.id || !ent.kind || !ent.shape) {
                throw new Error(`Invalid entity in level "${level.id}": missing id, kind, or shape`);
              }

              if (ent.shape === 'rect') {
                if (typeof ent.x !== 'number' || typeof ent.y !== 'number' ||
                    typeof ent.width !== 'number' || typeof ent.height !== 'number') {
                  throw new Error(`Invalid rect entity "${ent.id}" in level "${level.id}": missing x, y, width, or height`);
                }
              } else if (ent.shape === 'polygon') {
                if (!Array.isArray(ent.points) || ent.points.length < 3) {
                  throw new Error(`Invalid polygon entity "${ent.id}" in level "${level.id}": points must be array with at least 3 vertices`);
                }
              }
            }
          }
          return true;
        } catch (e) {
          console.warn('Skipping invalid level in map.yml:', e);
          return false;
        }
      });

      if (validLevels.length === 0) {
        throw new Error('Invalid map.yml: no valid levels after validation');
      }

      warnOnPayCurveRegressions(validLevels);
      const sequence = buildLevelSequence(validLevels);

      setState({
        allMaps: validLevels,
        levelSequence: sequence,
        currentLevelIndex: 0,
        isLoading: false,
        error: null,
      });
      
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load levels';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return false;
    }
  }, []);

  const advanceToNextLevel = useCallback((): boolean => {
    let advanced = false;
    setState(prev => {
      if (prev.currentLevelIndex >= prev.levelSequence.length - 1) return prev;
      advanced = true;
      return { ...prev, currentLevelIndex: prev.currentLevelIndex + 1 };
    });
    return advanced;
  }, []);

  const resetToFirstLevel = useCallback(() => {
    // Re-randomize the sequence each run
    setState(prev => ({
      ...prev,
      levelSequence: buildLevelSequence(prev.allMaps),
      currentLevelIndex: 0,
    }));
  }, []);

  const setLevelIndex = useCallback((index: number) => {
    setState(prev => {
      const clampedIndex = Math.max(0, Math.min(index, prev.levelSequence.length - 1));
      return { ...prev, currentLevelIndex: clampedIndex };
    });
  }, []);

  const currentLevel = state.levelSequence[state.currentLevelIndex] || null;
  const totalLevels = state.levelSequence.length;
  const isLastLevel = state.currentLevelIndex >= state.levelSequence.length - 1;

  return {
    levels: state.levelSequence,
    currentLevel,
    currentLevelIndex: state.currentLevelIndex,
    totalLevels,
    isLastLevel,
    isLoading: state.isLoading,
    error: state.error,
    loadLevels,
    advanceToNextLevel,
    resetToFirstLevel,
    setLevelIndex,
  };
}
