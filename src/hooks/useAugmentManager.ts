import { useState, useCallback, useEffect } from 'react';
import yaml from 'js-yaml';
import { 
  Augment, 
  AugmentConfig, 
  AUGMENT_STORAGE_KEY, 
  SCORE_BALANCE_STORAGE_KEY 
} from '@/types/augment';

interface AugmentPersistenceState {
  totalScoreBalance: number;
  ownedAugmentIds: string[];
}

const DEFAULT_PERSISTENCE: AugmentPersistenceState = {
  totalScoreBalance: 0,
  ownedAugmentIds: [],
};

function loadPersistence(): AugmentPersistenceState {
  try {
    const balanceStr = localStorage.getItem(SCORE_BALANCE_STORAGE_KEY);
    const ownedStr = localStorage.getItem(AUGMENT_STORAGE_KEY);
    
    const totalScoreBalance = balanceStr ? parseInt(balanceStr, 10) : 0;
    const ownedAugmentIds = ownedStr ? JSON.parse(ownedStr) : [];
    
    return {
      totalScoreBalance: isNaN(totalScoreBalance) ? 0 : totalScoreBalance,
      ownedAugmentIds: Array.isArray(ownedAugmentIds) ? ownedAugmentIds : [],
    };
  } catch {
    return DEFAULT_PERSISTENCE;
  }
}

function savePersistence(state: AugmentPersistenceState): void {
  localStorage.setItem(SCORE_BALANCE_STORAGE_KEY, state.totalScoreBalance.toString());
  localStorage.setItem(AUGMENT_STORAGE_KEY, JSON.stringify(state.ownedAugmentIds));
}

export function useAugmentManager() {
  const [augments, setAugments] = useState<Augment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<AugmentPersistenceState>(DEFAULT_PERSISTENCE);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load persistence on mount
  useEffect(() => {
    const loaded = loadPersistence();
    setPersistence(loaded);
    setIsLoaded(true);
  }, []);

  const loadAugments = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/augments.yml');
      if (!response.ok) {
        throw new Error(`Failed to load augments: ${response.status}`);
      }
      
      const yamlText = await response.text();
      const config = yaml.load(yamlText) as AugmentConfig;
      
      // Support both 'augments' and 'superUpgrades' keys for backwards compat
      const augmentList = config?.augments || (config as any)?.superUpgrades;
      
      if (!augmentList || !Array.isArray(augmentList)) {
        throw new Error('Invalid augments configuration');
      }
      
      setAugments(augmentList);
      setIsLoading(false);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error loading augments';
      setError(message);
      setIsLoading(false);
      console.error('[AugmentManager] Load error:', message);
      return false;
    }
  }, []);

  /**
   * Add score from a completed run to the persistent balance
   */
  const addScoreFromRun = useCallback((runScore: number): void => {
    setPersistence(prev => {
      const newState = {
        ...prev,
        totalScoreBalance: prev.totalScoreBalance + runScore,
      };
      savePersistence(newState);
      return newState;
    });
  }, []);

  /**
   * Purchase an augment permanently
   * Returns true if successful, false if insufficient balance
   */
  const purchaseAugment = useCallback((augment: Augment): boolean => {
    // Check if already owned
    if (persistence.ownedAugmentIds.includes(augment.id)) {
      return false;
    }
    
    // Check if can afford
    if (persistence.totalScoreBalance < augment.cost) {
      return false;
    }
    
    setPersistence(prev => {
      const newState = {
        totalScoreBalance: prev.totalScoreBalance - augment.cost,
        ownedAugmentIds: [...prev.ownedAugmentIds, augment.id],
      };
      savePersistence(newState);
      return newState;
    });
    
    return true;
  }, [persistence]);

  /**
   * Check if an augment is owned
   */
  const isAugmentOwned = useCallback((augmentId: string): boolean => {
    return persistence.ownedAugmentIds.includes(augmentId);
  }, [persistence.ownedAugmentIds]);

  /**
   * Get all owned augments
   */
  const getOwnedAugments = useCallback((): Augment[] => {
    return augments.filter(a => persistence.ownedAugmentIds.includes(a.id));
  }, [augments, persistence.ownedAugmentIds]);

  /**
   * Get affordable augments (not owned, can afford, unlocked)
   */
  const getAffordableAugments = useCallback((unlockedIds: string[]): Augment[] => {
    return augments.filter(a => {
      // Must not be owned
      if (persistence.ownedAugmentIds.includes(a.id)) return false;
      // Must be unlocked (or not locked)
      if (a.locked && !unlockedIds.includes(a.id)) return false;
      // Must be affordable
      return a.cost <= persistence.totalScoreBalance;
    });
  }, [augments, persistence]);

  /**
   * Reset all augment data (for dev/testing)
   */
  const resetAllData = useCallback((): void => {
    const newState = { ...DEFAULT_PERSISTENCE };
    setPersistence(newState);
    savePersistence(newState);
  }, []);

  return {
    augments,
    isLoading,
    error,
    isLoaded,
    totalScoreBalance: persistence.totalScoreBalance,
    ownedAugmentIds: persistence.ownedAugmentIds,
    loadAugments,
    addScoreFromRun,
    purchaseAugment,
    isAugmentOwned,
    getOwnedAugments,
    getAffordableAugments,
    resetAllData,
  };
}
