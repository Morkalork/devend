import { useState, useEffect } from 'react';
import yaml from 'js-yaml';
import { ScoringConfig } from '@/types/scoring';

const defaultConfig: ScoringConfig = {
  scoring: {
    fenceEfficiency: {
      maxBonus: 1,
      steps: [
        { fencesUnder: 1, bonus: 1 },
      ],
    },
    spaceOptimization: {
      maxBonus: 1,
      thresholds: [
        { extraPercent: 0.10, bonus: 1 },
      ],
    },
    performanceMultiplier: {
      underPar: 1.0,
      atPar: 1.0,
      overPar1: 0.75,
      overPar2: 0.6,
      overPar3Plus: 0.4,
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
              performanceMultiplier: {
                ...defaultConfig.scoring.performanceMultiplier,
                ...parsed.scoring.performanceMultiplier,
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
