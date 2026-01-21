import { useState, useEffect } from 'react';
import yaml from 'js-yaml';
import { ScoringConfig } from '@/types/scoring';

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

export function useScoringConfig() {
  const [config, setConfig] = useState<ScoringConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/scoring-config.yml')
      .then((res) => res.text())
      .then((text) => {
        const parsed = yaml.load(text) as ScoringConfig;
        if (parsed?.scoring) {
          setConfig({
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
          });
        }
      })
      .catch((err) => {
        console.warn('Failed to load scoring config, using defaults:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { config, loading };
}
