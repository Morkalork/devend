import { useState, useCallback, useEffect, useRef } from 'react';
import yaml from 'js-yaml';
import { 
  Augment, 
  AugmentConfig, 
  AugmentPersistence,
  AUGMENT_STORAGE_KEY,
  DEFAULT_AUGMENT_PERSISTENCE,
} from '@/types/augment';

/** Levels required for 1 Augment Point */
const LEVELS_PER_POINT = 5;

function loadPersistence(): AugmentPersistence {
  try {
    const stored = localStorage.getItem(AUGMENT_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_AUGMENT_PERSISTENCE };
    
    const parsed = JSON.parse(stored);
    return {
      totalAugmentPoints: typeof parsed.totalAugmentPoints === 'number' ? parsed.totalAugmentPoints : 0,
      augmentsOwned: typeof parsed.augmentsOwned === 'object' && parsed.augmentsOwned !== null 
        ? parsed.augmentsOwned 
        : {},
      totalLevelsCompleted: typeof parsed.totalLevelsCompleted === 'number' ? parsed.totalLevelsCompleted : 0,
    };
  } catch {
    return { ...DEFAULT_AUGMENT_PERSISTENCE };
  }
}

function savePersistence(state: AugmentPersistence): void {
  localStorage.setItem(AUGMENT_STORAGE_KEY, JSON.stringify(state));
}

export interface AugmentManagerOptions {
  /** Callback when an Augment Point is earned during a run */
  onPointEarned?: () => void;
}

export function useAugmentManager(options: AugmentManagerOptions = {}) {
  const [augments, setAugments] = useState<Augment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<AugmentPersistence>(DEFAULT_AUGMENT_PERSISTENCE);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // In-run tracking (ephemeral, not persisted)
  const [runLevelsCompleted, setRunLevelsCompleted] = useState(0);
  
  // Derived value - no need for separate state
  const runPointsEarned = Math.floor(runLevelsCompleted / LEVELS_PER_POINT);
  
  // Track previous points to detect when a new point is earned
  const prevPointsRef = useRef(0);
  
  // Store callback in ref to avoid stale closures
  const onPointEarnedRef = useRef(options.onPointEarned);
  useEffect(() => {
    onPointEarnedRef.current = options.onPointEarned;
  }, [options.onPointEarned]);
  
  // Trigger callback when points increase
  useEffect(() => {
    if (runPointsEarned > prevPointsRef.current) {
      onPointEarnedRef.current?.();
    }
    prevPointsRef.current = runPointsEarned;
  }, [runPointsEarned]);

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
      
      const augmentList = config?.augments;
      
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
   * Reset in-run tracking (call at the start of a new run)
   */
  const resetRunProgress = useCallback(() => {
    setRunLevelsCompleted(0);
    prevPointsRef.current = 0;
  }, []);

  /**
   * Increment level completion during a run
   * Tracks progress and triggers callback when a point is earned
   */
  const incrementRunLevel = useCallback(() => {
    setRunLevelsCompleted(prev => prev + 1);
  }, []);

  /**
   * Finalize run and award Augment Points
   * Awards 1 point per 5 levels completed in this run (per-run, not cumulative)
   * Partial progress is discarded
   */
  const finalizeRun = useCallback((): number => {
    const pointsAwarded = Math.floor(runLevelsCompleted / LEVELS_PER_POINT);
    
    if (runLevelsCompleted > 0) {
      setPersistence(prev => {
        const newState = {
          ...prev,
          totalLevelsCompleted: prev.totalLevelsCompleted + runLevelsCompleted,
          totalAugmentPoints: prev.totalAugmentPoints + pointsAwarded,
        };
        savePersistence(newState);
        return newState;
      });
    }
    
    // Reset run tracking
    setRunLevelsCompleted(0);
    prevPointsRef.current = 0;
    
    return pointsAwarded;
  }, [runLevelsCompleted]);

  /**
   * Get progress toward next Augment Point (for in-run display)
   */
  const getRunProgress = useCallback(() => {
    return {
      levelsCompleted: runLevelsCompleted,
      levelsToNextPoint: LEVELS_PER_POINT - (runLevelsCompleted % LEVELS_PER_POINT),
      progressInCurrentPoint: runLevelsCompleted % LEVELS_PER_POINT,
      pointsEarned: runPointsEarned,
      levelsPerPoint: LEVELS_PER_POINT,
    };
  }, [runLevelsCompleted, runPointsEarned]);

  /**
   * Purchase a stack of an augment
   * Returns true if successful, false if cannot afford or at max stacks
   */
  const purchaseAugmentStack = useCallback((augment: Augment): boolean => {
    const currentStacks = persistence.augmentsOwned[augment.id] || 0;
    
    // Check if at max stacks
    if (currentStacks >= augment.maxStacks) {
      return false;
    }
    
    // Check if can afford
    if (persistence.totalAugmentPoints < augment.costPerStack) {
      return false;
    }
    
    setPersistence(prev => {
      const newState = {
        ...prev,
        totalAugmentPoints: prev.totalAugmentPoints - augment.costPerStack,
        augmentsOwned: {
          ...prev.augmentsOwned,
          [augment.id]: (prev.augmentsOwned[augment.id] || 0) + 1,
        },
      };
      savePersistence(newState);
      return newState;
    });
    
    return true;
  }, [persistence]);

  /**
   * Get stack count for an augment
   */
  const getAugmentStacks = useCallback((augmentId: string): number => {
    return persistence.augmentsOwned[augmentId] || 0;
  }, [persistence.augmentsOwned]);

  /**
   * Check if an augment has any stacks owned
   */
  const isAugmentOwned = useCallback((augmentId: string): boolean => {
    return (persistence.augmentsOwned[augmentId] || 0) > 0;
  }, [persistence.augmentsOwned]);

  /**
   * Get all owned augments with their stack counts
   */
  const getOwnedAugments = useCallback((): { augment: Augment; stacks: number }[] => {
    return augments
      .filter(a => (persistence.augmentsOwned[a.id] || 0) > 0)
      .map(a => ({
        augment: a,
        stacks: persistence.augmentsOwned[a.id] || 0,
      }));
  }, [augments, persistence.augmentsOwned]);

  /**
   * Calculate total effect value for an augment (accounting for stacks)
   * For multipliers, applies the effect multiplicatively per stack
   * For additive bonuses, adds linearly per stack
   */
  const getAugmentEffectValue = useCallback((augment: Augment): number => {
    const stacks = persistence.augmentsOwned[augment.id] || 0;
    if (stacks === 0) return augment.effect.type.includes('Multiplier') ? 1 : 0;
    
    const { type, value } = augment.effect;
    
    // For multipliers, apply multiplicatively
    if (type.includes('Multiplier')) {
      return Math.pow(value, stacks);
    }
    
    // For additive bonuses, stack linearly
    return value * stacks;
  }, [persistence.augmentsOwned]);

  /**
   * Reset all augment data (for dev/testing)
   */
  const resetAllData = useCallback((): void => {
    const newState = { ...DEFAULT_AUGMENT_PERSISTENCE };
    setPersistence(newState);
    savePersistence(newState);
  }, []);

  return {
    augments,
    isLoading,
    error,
    isLoaded,
    totalAugmentPoints: persistence.totalAugmentPoints,
    augmentsOwned: persistence.augmentsOwned,
    totalLevelsCompleted: persistence.totalLevelsCompleted,
    // Run tracking
    runLevelsCompleted,
    runPointsEarned,
    // Methods
    loadAugments,
    resetRunProgress,
    incrementRunLevel,
    finalizeRun,
    getRunProgress,
    purchaseAugmentStack,
    getAugmentStacks,
    isAugmentOwned,
    getOwnedAugments,
    getAugmentEffectValue,
    resetAllData,
  };
}
