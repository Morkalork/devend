import { useState, useCallback } from 'react';
import yaml from 'js-yaml';
import { SuperUpgrade, SuperUpgradeConfig, ActiveSuperUpgrade } from '@/types/superUpgrade';

export function useSuperUpgradeManager() {
  const [superUpgrades, setSuperUpgrades] = useState<SuperUpgrade[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSuperUpgrade, setActiveSuperUpgrade] = useState<ActiveSuperUpgrade | null>(null);

  const loadSuperUpgrades = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/super-upgrades.yml');
      if (!response.ok) {
        throw new Error(`Failed to load super upgrades: ${response.status}`);
      }
      
      const yamlText = await response.text();
      const config = yaml.load(yamlText) as SuperUpgradeConfig;
      
      if (!config?.super_upgrades || !Array.isArray(config.super_upgrades)) {
        throw new Error('Invalid super upgrades configuration');
      }
      
      setSuperUpgrades(config.super_upgrades);
      setIsLoading(false);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error loading super upgrades';
      setError(message);
      setIsLoading(false);
      console.error('[SuperUpgradeManager] Load error:', message);
      return false;
    }
  }, []);

  const purchaseSuperUpgrade = useCallback((upgrade: SuperUpgrade): boolean => {
    // Set the active super upgrade for the next run
    setActiveSuperUpgrade({
      upgrade,
      purchasedAt: new Date().toISOString(),
    });
    return true;
  }, []);

  const clearActiveSuperUpgrade = useCallback(() => {
    setActiveSuperUpgrade(null);
  }, []);

  const getAffordableUpgrades = useCallback((currentScore: number): SuperUpgrade[] => {
    return superUpgrades.filter(u => u.cost <= currentScore);
  }, [superUpgrades]);

  return {
    superUpgrades,
    activeSuperUpgrade,
    isLoading,
    error,
    loadSuperUpgrades,
    purchaseSuperUpgrade,
    clearActiveSuperUpgrade,
    getAffordableUpgrades,
  };
}
