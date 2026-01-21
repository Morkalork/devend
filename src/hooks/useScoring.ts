import { useCallback, useMemo, useEffect, useState } from 'react';
import yaml from 'js-yaml';
import { ScoringConfig, ScoreBreakdown } from '@/types/scoring';
import { calculateScoreBreakdown } from '@/lib/scoring';

const defaultConfig: ScoringConfig = {
  scoring: {
    fenceEfficiency: {
      maxBonus: 30,
      steps: [
        { fencesUnder: 1, bonus: 5 },
        { fencesUnder: 2, bonus: 7 },
        { fencesUnder: 3, bonus: 8 },
        { fencesUnder: 4, bonus: 10 },
      ],
    },
    spaceOptimization: {
      maxBonus: 20,
      thresholds: [
        { extraPercent: 0.05, bonus: 5 },
        { extraPercent: 0.10, bonus: 10 },
        { extraPercent: 0.15, bonus: 14 },
        { extraPercent: 0.20, bonus: 17 },
        { extraPercent: 1.00, bonus: 20 },
      ],
    },
    fencePenaltyMultiplier: {
      overPar0: 1.0,
      overPar1: 0.75,
      overPar2: 0.5,
      overPar3Plus: 0.0,
    },
  },
};

// Singleton promise to load config once
let configPromise: Promise<ScoringConfig> | null = null;
let loadedConfig: ScoringConfig = defaultConfig;

function loadScoringConfig(): Promise<ScoringConfig> {
  if (configPromise) return configPromise;
  
  configPromise = fetch('/scoring-config.yml')
    .then((res) => res.text())
    .then((text) => {
      const parsed = yaml.load(text) as ScoringConfig;
      if (parsed?.scoring) {
        loadedConfig = {
          scoring: {
            fenceEfficiency: {
              ...defaultConfig.scoring.fenceEfficiency,
              ...parsed.scoring.fenceEfficiency,
            },
            spaceOptimization: {
              ...defaultConfig.scoring.spaceOptimization,
              ...parsed.scoring.spaceOptimization,
            },
            fencePenaltyMultiplier: {
              ...defaultConfig.scoring.fencePenaltyMultiplier,
              ...parsed.scoring.fencePenaltyMultiplier,
            },
          },
        };
      }
      return loadedConfig;
    })
    .catch((err) => {
      console.warn('Failed to load scoring config, using defaults:', err);
      return defaultConfig;
    });
    
  return configPromise;
}

// Pre-load config immediately
loadScoringConfig();

/**
 * Hook to get a memoized scoring calculator function.
 * Returns the scoring config and a calculate function.
 */
export function useScoring() {
  const [config, setConfig] = useState<ScoringConfig>(loadedConfig);
  const [isReady, setIsReady] = useState(configPromise !== null && loadedConfig !== defaultConfig);
  
  useEffect(() => {
    loadScoringConfig().then((loaded) => {
      setConfig(loaded);
      setIsReady(true);
    });
  }, []);

  /**
   * Calculate level score with bonuses.
   * @param usedFences - Number of fences the player used
   * @param parFences - Expected number of fences for the level
   * @param remainingPercent - Percentage of area remaining (0-100)
   * @param thresholdPercent - Minimum percentage that must remain to win (0-100)
   * @param basePoints - Base points for the level
   */
  const calculateLevelScore = useCallback((
    usedFences: number,
    parFences: number,
    remainingPercent: number,
    thresholdPercent: number,
    basePoints: number,
    scoreMultiplier: number = 1,
  ): { 
    levelScore: number; 
    breakdown: ScoreBreakdown;
  } => {
    // Convert threshold to required removed ratio
    // If threshold is 40%, player must remove at least 60% (1 - 0.40 = 0.60)
    const requiredRemovedRatio = (100 - thresholdPercent) / 100;
    
    // Calculate actual removed ratio
    const actualRemovedRatio = (100 - remainingPercent) / 100;
    
    const breakdown = calculateScoreBreakdown(
      usedFences,
      parFences,
      actualRemovedRatio,
      requiredRemovedRatio,
      config
    );

    // Total level score = base points + fence bonus + space bonus
    const rawScore = basePoints + breakdown.totalBonus;
    const levelScore = Math.round(rawScore * scoreMultiplier);

    return { levelScore, breakdown };
  }, [config]);

  return { 
    config, 
    isReady, 
    calculateLevelScore,
  };
}

/**
 * Synchronous scoring calculation using the preloaded config.
 * Use this when you need to calculate scores in callbacks/refs.
 */
export function calculateScore(
  usedFences: number,
  parFences: number,
  remainingPercent: number,
  thresholdPercent: number,
  basePoints: number,
  scoreMultiplier: number = 1,
): { 
  levelScore: number; 
  breakdown: ScoreBreakdown;
} {
  const requiredRemovedRatio = (100 - thresholdPercent) / 100;
  const actualRemovedRatio = (100 - remainingPercent) / 100;
  
  const breakdown = calculateScoreBreakdown(
    usedFences,
    parFences,
    actualRemovedRatio,
    requiredRemovedRatio,
    loadedConfig
  );

  const rawScore = basePoints + breakdown.totalBonus;
  const levelScore = Math.round(rawScore * scoreMultiplier);

  return { levelScore, breakdown };
}

/**
 * Ensure scoring config is loaded before using synchronous functions.
 */
export async function ensureScoringConfigLoaded(): Promise<void> {
  await loadScoringConfig();
}
