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

      // Validate level structure
      for (const level of data.levels) {
        if (!level.id || typeof level.sizeThreshold !== 'number' || !Array.isArray(level.balls)) {
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
      }

      const sequence = buildLevelSequence(data.levels);
      
      setState({
        allMaps: data.levels,
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
