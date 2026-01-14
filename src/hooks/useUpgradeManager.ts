import { useState, useCallback } from 'react';
import yaml from 'js-yaml';
import { UpgradeConfig, UpgradeData } from '@/types/upgrade';

interface UpgradeManagerState {
  upgrades: UpgradeConfig[];
  isLoading: boolean;
  error: string | null;
}

export function useUpgradeManager() {
  const [state, setState] = useState<UpgradeManagerState>({
    upgrades: [],
    isLoading: false,
    error: null,
  });

  const loadUpgrades = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await fetch('/upgrades.yml');
      if (!response.ok) {
        throw new Error(`Failed to load upgrades.yml: ${response.status}`);
      }
      
      const yamlText = await response.text();
      const data = yaml.load(yamlText) as UpgradeData;
      
      if (!data?.upgrades || !Array.isArray(data.upgrades)) {
        throw new Error('Invalid upgrades.yml: no upgrades array found');
      }

      // Validate each upgrade
      for (const upgrade of data.upgrades) {
        // Check required fields
        if (!upgrade.id || !upgrade.name || !upgrade.icon || !upgrade.description) {
          throw new Error(`Upgrade "${upgrade.id || 'unknown'}" is missing required fields (id, name, icon, description)`);
        }
        
        if (typeof upgrade.levelAvailability !== 'number') {
          throw new Error(`Upgrade "${upgrade.id}" is missing levelAvailability`);
        }
        
        if (typeof upgrade.priceMin !== 'number' || typeof upgrade.priceMax !== 'number') {
          throw new Error(`Upgrade "${upgrade.id}" is missing priceMin or priceMax`);
        }
        
        // Validate priceMin <= priceMax
        if (upgrade.priceMin > upgrade.priceMax) {
          throw new Error(`Upgrade "${upgrade.id}" is invalid: priceMin (${upgrade.priceMin}) must be <= priceMax (${upgrade.priceMax})`);
        }
        
        // Validate levelRemoved >= levelAvailability if present
        if (upgrade.levelRemoved !== undefined) {
          if (typeof upgrade.levelRemoved !== 'number') {
            throw new Error(`Upgrade "${upgrade.id}" has invalid levelRemoved (must be a number)`);
          }
          if (upgrade.levelRemoved < upgrade.levelAvailability) {
            throw new Error(`Upgrade "${upgrade.id}" is invalid: levelRemoved (${upgrade.levelRemoved}) must be >= levelAvailability (${upgrade.levelAvailability})`);
          }
        }
        
        // Validate modifiers object exists
        if (!upgrade.modifiers || typeof upgrade.modifiers !== 'object') {
          throw new Error(`Upgrade "${upgrade.id}" is missing modifiers object`);
        }
      }
      
      setState({
        upgrades: data.upgrades,
        isLoading: false,
        error: null,
      });
      
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load upgrades';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      return false;
    }
  }, []);

  const getAvailableUpgrades = useCallback((levelNumber: number): UpgradeConfig[] => {
    return state.upgrades.filter(upgrade => {
      const isAvailable = levelNumber >= upgrade.levelAvailability;
      const isNotRemoved = upgrade.levelRemoved === undefined || levelNumber < upgrade.levelRemoved;
      return isAvailable && isNotRemoved;
    });
  }, [state.upgrades]);

  return {
    upgrades: state.upgrades,
    isLoading: state.isLoading,
    error: state.error,
    loadUpgrades,
    getAvailableUpgrades,
  };
}
