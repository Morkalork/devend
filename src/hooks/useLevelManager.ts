import { useState, useCallback } from 'react';
import yaml from 'js-yaml';
import { LevelConfig, LevelData } from '@/types/level';

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
        if (!level.id || !level.backgroundColor || !level.rectangleColor || 
            typeof level.sizeThreshold !== 'number' || !Array.isArray(level.balls)) {
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
