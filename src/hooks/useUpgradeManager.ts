/**
 * useUpgradeManager — loads the upgrade catalogue from public/upgrades.yml.
 *
 * Upgrades are bought in the between-levels shop with overtime hours (the
 * run score). Tiers (Junior → Wizard) gate how upgrades chain; canPurchase/
 * isLocked encode those rules. The owned set itself lives in useGameSession.
 */
import { useState, useCallback } from 'react';
import yaml from 'js-yaml';
import { UpgradeConfig, UpgradeData, UpgradeTier } from '@/types/upgrade';

const VALID_TIERS: UpgradeTier[] = ['Junior', 'Senior', 'Principal', 'Architect', 'Wizard'];

interface UpgradeManagerState {
  upgrades: UpgradeConfig[];
  upgradeLookup: Map<string, UpgradeConfig>;
  isLoading: boolean;
  error: string | null;
}

export function useUpgradeManager() {
  const [state, setState] = useState<UpgradeManagerState>({
    upgrades: [],
    upgradeLookup: new Map(),
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

      const lookup = new Map<string, UpgradeConfig>();

      // Validate each upgrade
      for (const upgrade of data.upgrades) {
        if (!upgrade.id || !upgrade.name || !upgrade.description) {
          throw new Error(`Upgrade "${upgrade.id || 'unknown'}" is missing required fields (id, name, description)`);
        }
        
        if (!upgrade.tier || !VALID_TIERS.includes(upgrade.tier)) {
          throw new Error(`Upgrade "${upgrade.id}" has invalid tier. Must be one of: ${VALID_TIERS.join(', ')}`);
        }
        
        if (typeof upgrade.cost !== 'number') {
          throw new Error(`Upgrade "${upgrade.id}" is missing cost`);
        }
        
        if (!upgrade.modifiers || typeof upgrade.modifiers !== 'object') {
          throw new Error(`Upgrade "${upgrade.id}" is missing modifiers object`);
        }

        // Validate prerequisites reference existing ids
        if (upgrade.prerequisites) {
          for (const prereqId of upgrade.prerequisites) {
            // We'll validate after all are loaded
          }
        }

        lookup.set(upgrade.id, upgrade);
      }

      // Validate all prerequisite references
      for (const upgrade of data.upgrades) {
        if (upgrade.prerequisites) {
          for (const prereqId of upgrade.prerequisites) {
            if (!lookup.has(prereqId)) {
              throw new Error(`Upgrade "${upgrade.id}" references unknown prerequisite "${prereqId}"`);
            }
          }
        }
      }
      
      setState({
        upgrades: data.upgrades,
        upgradeLookup: lookup,
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

  /**
   * Check if an upgrade can be purchased.
   * Conditions: player has enough score, all prerequisites owned, not already owned.
   */
  const canPurchase = useCallback((upgradeId: string, playerScore: number, ownedIds: string[]): boolean => {
    const upgrade = state.upgradeLookup.get(upgradeId);
    if (!upgrade) return false;

    // Already owned
    if (ownedIds.includes(upgradeId)) return false;

    // Not enough score
    if (playerScore < upgrade.cost) return false;

    // Check prerequisites
    if (upgrade.prerequisites) {
      for (const prereqId of upgrade.prerequisites) {
        if (!ownedIds.includes(prereqId)) return false;
      }
    }

    return true;
  }, [state.upgradeLookup]);

  /**
   * Check if an upgrade is locked (prerequisites not met, regardless of score).
   */
  const isLocked = useCallback((upgradeId: string, ownedIds: string[]): boolean => {
    const upgrade = state.upgradeLookup.get(upgradeId);
    if (!upgrade) return true;
    if (ownedIds.includes(upgradeId)) return false;
    if (!upgrade.prerequisites || upgrade.prerequisites.length === 0) return false;
    return upgrade.prerequisites.some(prereqId => !ownedIds.includes(prereqId));
  }, [state.upgradeLookup]);

  return {
    upgrades: state.upgrades,
    upgradeLookup: state.upgradeLookup,
    isLoading: state.isLoading,
    error: state.error,
    loadUpgrades,
    canPurchase,
    isLocked,
  };
}
