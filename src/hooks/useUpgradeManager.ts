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

/**
 * Throw if the prerequisite graph contains a cycle (3-colour DFS). A cycle
 * would leave every upgrade on it permanently locked in the shop, so this is a
 * hard error, consistent with the unknown-prerequisite check.
 */
function detectPrerequisiteCycle(upgrades: UpgradeConfig[]): void {
  const prereqsById = new Map(upgrades.map(u => [u.id, u.prerequisites ?? []]));
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<string, number>();

  const visit = (id: string, stack: string[]): void => {
    colour.set(id, GREY);
    for (const prereqId of prereqsById.get(id) ?? []) {
      const c = colour.get(prereqId) ?? WHITE;
      if (c === GREY) {
        throw new Error(`Cyclic upgrade prerequisites: ${[...stack, id, prereqId].join(' -> ')}`);
      }
      if (c === WHITE) visit(prereqId, [...stack, id]);
    }
    colour.set(id, BLACK);
  };

  for (const u of upgrades) {
    if ((colour.get(u.id) ?? WHITE) === WHITE) visit(u.id, []);
  }
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

      // Validate each upgrade and build the id lookup.
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

        // Ids must be unique. A duplicate would silently overwrite the earlier
        // entry in the lookup — this previously masked a normal/ascension clash
        // on the defensive_programming_* ids.
        if (lookup.has(upgrade.id)) {
          throw new Error(`Duplicate upgrade id "${upgrade.id}"`);
        }

        lookup.set(upgrade.id, upgrade);
      }

      // Validate all prerequisite references exist.
      for (const upgrade of data.upgrades) {
        for (const prereqId of upgrade.prerequisites ?? []) {
          if (!lookup.has(prereqId)) {
            throw new Error(`Upgrade "${upgrade.id}" references unknown prerequisite "${prereqId}"`);
          }
        }
      }

      // The prerequisite graph must be acyclic.
      detectPrerequisiteCycle(data.upgrades);

      // Dev-only sanity: a normal-run upgrade gated behind an ascension-only one
      // could never be bought outside ascension. Warn rather than throw.
      if (import.meta.env.DEV) {
        for (const upgrade of data.upgrades) {
          if (upgrade.ascensionOnly) continue;
          for (const prereqId of upgrade.prerequisites ?? []) {
            if (lookup.get(prereqId)?.ascensionOnly) {
              console.warn(
                `[upgrades] "${upgrade.id}" requires ascension-only prerequisite "${prereqId}" — unreachable in a normal run.`,
              );
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
