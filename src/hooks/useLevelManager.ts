import { useState, useCallback } from 'react';
import yaml from 'js-yaml';
import { LevelConfig, LevelData, LevelEntity } from '@/types/level';

interface LevelManagerState {
  levels: LevelConfig[];
  currentLevelIndex: number;
  isLoading: boolean;
  error: string | null;
}

export function useLevelManager() {
  const [state, setState] = useState<LevelManagerState>({
    levels: [],
    currentLevelIndex: 0,
    isLoading: false,
    error: null,
  });

  const loadLevels = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await fetch('/map.yml');
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
        
        // Validate expectedCuts and points exist
        if (typeof level.expectedCuts !== 'number' || typeof level.points !== 'number') {
          throw new Error(`Level "${level.id}" is missing expectedCuts or points`);
        }
        
        // Validate expectedCuts < points
        if (level.expectedCuts >= level.points) {
          throw new Error(`Level "${level.id}" is invalid: expectedCuts (${level.expectedCuts}) must be less than points (${level.points})`);
        }
        
        // Validate entities if present
        if (level.entities && Array.isArray(level.entities)) {
          for (const entity of level.entities) {
            const ent = entity as LevelEntity;
            if (!ent.id || !ent.kind || !ent.shape) {
              throw new Error(`Invalid entity in level "${level.id}": missing id, kind, or shape`);
            }
            
            // Validate shape-specific properties
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
      
      setState({
        levels: data.levels,
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
    if (state.currentLevelIndex < state.levels.length - 1) {
      setState(prev => ({
        ...prev,
        currentLevelIndex: prev.currentLevelIndex + 1,
      }));
      return true;
    }
    return false; // No more levels
  }, [state.currentLevelIndex, state.levels.length]);

  const resetToFirstLevel = useCallback(() => {
    setState(prev => ({ ...prev, currentLevelIndex: 0 }));
  }, []);

  const currentLevel = state.levels[state.currentLevelIndex] || null;
  const totalLevels = state.levels.length;
  const isLastLevel = state.currentLevelIndex >= state.levels.length - 1;

  return {
    levels: state.levels,
    currentLevel,
    currentLevelIndex: state.currentLevelIndex,
    totalLevels,
    isLastLevel,
    isLoading: state.isLoading,
    error: state.error,
    loadLevels,
    advanceToNextLevel,
    resetToFirstLevel,
  };
}
