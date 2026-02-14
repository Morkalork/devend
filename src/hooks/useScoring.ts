import { useCallback, useMemo, useEffect, useState } from 'react';
import yaml from 'js-yaml';
import { ScoringConfig, ScoreBreakdown } from '@/types/scoring';
import { calculateScoreBreakdown, getOvertimeCap } from '@/lib/scoring';

const defaultConfig: ScoringConfig = {
  scoring: {
    fenceEfficiency: {
      maxBonus: 1,
      steps: [{ fencesUnder: 1, bonus: 1 }],
    },
    spaceOptimization: {
      maxBonus: 1,
      thresholds: [{ extraPercent: 0.10, bonus: 1 }],
    },
    fencePenaltyMultiplier: {
      overPar0: 1.0,
      overPar1: 0.5,
      overPar2: 0.5,
      overPar3Plus: 0.0,
    },
  },
};

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
            fenceEfficiency: { ...defaultConfig.scoring.fenceEfficiency, ...parsed.scoring.fenceEfficiency },
            spaceOptimization: { ...defaultConfig.scoring.spaceOptimization, ...parsed.scoring.spaceOptimization },
            fencePenaltyMultiplier: { ...defaultConfig.scoring.fencePenaltyMultiplier, ...parsed.scoring.fencePenaltyMultiplier },
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

loadScoringConfig();

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
   * Calculate overtime reward for a level.
   * scoreMultiplier applies ONLY to base reward, not bonuses.
   * Result is capped per level tier.
   */
  const calculateLevelScore = useCallback((
    usedFences: number,
    parFences: number,
    remainingPercent: number,
    thresholdPercent: number,
    basePoints: number,
    scoreMultiplier: number = 1,
    levelNumber: number = 1,
  ): { 
    levelScore: number; 
    breakdown: ScoreBreakdown;
  } => {
    const requiredRemovedRatio = (100 - thresholdPercent) / 100;
    const actualRemovedRatio = (100 - remainingPercent) / 100;
    
    const breakdown = calculateScoreBreakdown(
      usedFences, parFences, actualRemovedRatio, requiredRemovedRatio, config
    );

    // scoreMultiplier applies only to base reward
    const multipliedBase = Math.floor(basePoints * scoreMultiplier);
    const rawScore = multipliedBase + breakdown.totalBonus;
    
    // Cap at tier maximum
    const cap = getOvertimeCap(levelNumber);
    const levelScore = Math.min(rawScore, cap);

    return { levelScore, breakdown };
  }, [config]);

  return { config, isReady, calculateLevelScore };
}

/**
 * Synchronous overtime calculation using preloaded config.
 * scoreMultiplier applies ONLY to base reward.
 */
export function calculateScore(
  usedFences: number,
  parFences: number,
  remainingPercent: number,
  thresholdPercent: number,
  basePoints: number,
  scoreMultiplier: number = 1,
  levelNumber: number = 1,
): { 
  levelScore: number; 
  breakdown: ScoreBreakdown;
} {
  const requiredRemovedRatio = (100 - thresholdPercent) / 100;
  const actualRemovedRatio = (100 - remainingPercent) / 100;
  
  const breakdown = calculateScoreBreakdown(
    usedFences, parFences, actualRemovedRatio, requiredRemovedRatio, loadedConfig
  );

  const multipliedBase = Math.floor(basePoints * scoreMultiplier);
  const rawScore = multipliedBase + breakdown.totalBonus;
  const cap = getOvertimeCap(levelNumber);
  const levelScore = Math.min(rawScore, cap);

  return { levelScore, breakdown };
}

export async function ensureScoringConfigLoaded(): Promise<void> {
  await loadScoringConfig();
}
