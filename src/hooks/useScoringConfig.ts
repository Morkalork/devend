import { useState, useEffect } from 'react';
import { ScoringConfig } from '@/types/scoring';
import { DEFAULT_SCORING_CONFIG, loadScoringConfig } from '@/lib/scoring';

/**
 * React wrapper around the shared scoring-config loader (src/lib/scoring.ts).
 * Used by the admin scoring preview panel; gameplay code calls
 * calculateScore() from lib/scoring directly instead.
 */
export function useScoringConfig() {
  const [config, setConfig] = useState<ScoringConfig>(DEFAULT_SCORING_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadScoringConfig()
      .then(setConfig)
      .finally(() => setLoading(false));
  }, []);

  return { config, loading };
}
