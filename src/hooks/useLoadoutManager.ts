/**
 * useLoadoutManager — loads the loadout catalogue from public/loadouts.yml
 * (curse + blessing bundles drafted at the run start and during Ascension)
 * plus the ascension tuning block. The drafted set itself lives in
 * useGameSession, mirroring how useUpgradeManager owns only the catalogue.
 */
import { useState, useCallback } from 'react';
import yaml from 'js-yaml';
import {
  LoadoutConfig,
  LoadoutData,
  AscensionConfig,
  DEFAULT_ASCENSION_CONFIG,
} from '@/types/loadout';

interface LoadoutManagerState {
  loadouts: LoadoutConfig[];
  loadoutLookup: Map<string, LoadoutConfig>;
  ascensionConfig: AscensionConfig;
  isLoading: boolean;
  error: string | null;
}

export function useLoadoutManager() {
  const [state, setState] = useState<LoadoutManagerState>({
    loadouts: [],
    loadoutLookup: new Map(),
    ascensionConfig: DEFAULT_ASCENSION_CONFIG,
    isLoading: false,
    error: null,
  });

  const loadLoadouts = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch('/loadouts.yml');
      if (!response.ok) {
        throw new Error(`Failed to load loadouts.yml: ${response.status}`);
      }

      const yamlText = await response.text();
      const data = yaml.load(yamlText) as LoadoutData;

      if (!data?.loadouts || !Array.isArray(data.loadouts)) {
        throw new Error('Invalid loadouts.yml: no loadouts array found');
      }

      const lookup = new Map<string, LoadoutConfig>();
      for (const loadout of data.loadouts) {
        if (!loadout.id || !loadout.name || !loadout.curse || !loadout.blessing) {
          throw new Error(`Loadout "${loadout.id || 'unknown'}" is missing required fields (id, name, curse, blessing)`);
        }
        if (!loadout.modifiers || typeof loadout.modifiers !== 'object') {
          throw new Error(`Loadout "${loadout.id}" is missing modifiers object`);
        }
        lookup.set(loadout.id, loadout);
      }

      setState({
        loadouts: data.loadouts,
        loadoutLookup: lookup,
        ascensionConfig: { ...DEFAULT_ASCENSION_CONFIG, ...data.ascension },
        isLoading: false,
        error: null,
      });

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load loadouts';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return false;
    }
  }, []);

  return {
    loadouts: state.loadouts,
    loadoutLookup: state.loadoutLookup,
    ascensionConfig: state.ascensionConfig,
    isLoading: state.isLoading,
    error: state.error,
    loadLoadouts,
  };
}
