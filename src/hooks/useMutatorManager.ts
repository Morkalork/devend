/**
 * useMutatorManager — loads the Ascension mutator catalogue from
 * public/mutators.yml (curse + blessing bundles drafted after the final
 * level) plus the ascension tuning block. The drafted set itself lives in
 * useGameSession, mirroring how useUpgradeManager owns only the catalogue.
 */
import { useState, useCallback } from 'react';
import yaml from 'js-yaml';
import {
  MutatorConfig,
  MutatorData,
  AscensionConfig,
  DEFAULT_ASCENSION_CONFIG,
} from '@/types/mutator';

interface MutatorManagerState {
  mutators: MutatorConfig[];
  mutatorLookup: Map<string, MutatorConfig>;
  ascensionConfig: AscensionConfig;
  isLoading: boolean;
  error: string | null;
}

export function useMutatorManager() {
  const [state, setState] = useState<MutatorManagerState>({
    mutators: [],
    mutatorLookup: new Map(),
    ascensionConfig: DEFAULT_ASCENSION_CONFIG,
    isLoading: false,
    error: null,
  });

  const loadMutators = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch('/mutators.yml');
      if (!response.ok) {
        throw new Error(`Failed to load mutators.yml: ${response.status}`);
      }

      const yamlText = await response.text();
      const data = yaml.load(yamlText) as MutatorData;

      if (!data?.mutators || !Array.isArray(data.mutators)) {
        throw new Error('Invalid mutators.yml: no mutators array found');
      }

      const lookup = new Map<string, MutatorConfig>();
      for (const mutator of data.mutators) {
        if (!mutator.id || !mutator.name || !mutator.curse || !mutator.blessing) {
          throw new Error(`Mutator "${mutator.id || 'unknown'}" is missing required fields (id, name, curse, blessing)`);
        }
        if (!mutator.modifiers || typeof mutator.modifiers !== 'object') {
          throw new Error(`Mutator "${mutator.id}" is missing modifiers object`);
        }
        lookup.set(mutator.id, mutator);
      }

      setState({
        mutators: data.mutators,
        mutatorLookup: lookup,
        ascensionConfig: { ...DEFAULT_ASCENSION_CONFIG, ...data.ascension },
        isLoading: false,
        error: null,
      });

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load mutators';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return false;
    }
  }, []);

  return {
    mutators: state.mutators,
    mutatorLookup: state.mutatorLookup,
    ascensionConfig: state.ascensionConfig,
    isLoading: state.isLoading,
    error: state.error,
    loadMutators,
  };
}
