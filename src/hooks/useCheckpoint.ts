import { useState, useCallback, useEffect } from 'react';

const CHECKPOINT_STORAGE_KEY = 'ballbreaker_checkpoint';
const CHECKPOINT_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const LEVELS_PER_TIER = 5;

interface CheckpointData {
  checkpointLevel: number; // 1-indexed, tier start (1, 6, 11, 16, etc.)
  expiresAt: number; // Unix timestamp
  reachedLevel: number; // The actual level reached before dying
}

/**
 * Calculate the tier start level (checkpoint level) for a given level.
 * Levels 1-5 = checkpoint 1, 6-10 = checkpoint 6, 11-15 = checkpoint 11, etc.
 */
export function getTierStartLevel(level: number): number {
  return Math.floor((level - 1) / LEVELS_PER_TIER) * LEVELS_PER_TIER + 1;
}

/**
 * Calculate the tier number (0-indexed) for a given level.
 * Levels 1-5 = tier 0, 6-10 = tier 1, etc.
 */
export function getTierNumber(level: number): number {
  return Math.floor((level - 1) / LEVELS_PER_TIER);
}

/**
 * Calculate the score multiplier based on tier.
 * Tier 0 = 1.0 (no boost), Tier 1 = 1.1 (10% boost), Tier 2 = 1.2, etc.
 */
export function getTierScoreMultiplier(level: number): number {
  const tier = getTierNumber(level);
  return 1 + (tier * 0.1);
}

export function useCheckpoint() {
  const [checkpointData, setCheckpointData] = useState<CheckpointData | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load checkpoint from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CHECKPOINT_STORAGE_KEY);
      if (stored) {
        const data: CheckpointData = JSON.parse(stored);
        const now = Date.now();
        
        // Check if checkpoint is still valid (not expired)
        if (data.expiresAt > now && data.checkpointLevel > 1) {
          setCheckpointData(data);
        } else {
          // Expired, remove it
          localStorage.removeItem(CHECKPOINT_STORAGE_KEY);
        }
      }
    } catch (e) {
      console.warn('Failed to load checkpoint:', e);
      localStorage.removeItem(CHECKPOINT_STORAGE_KEY);
    }
    setIsLoaded(true);
  }, []);

  // Save checkpoint when player dies (if they've progressed past level 5)
  const saveCheckpoint = useCallback((reachedLevel: number) => {
    const checkpointLevel = getTierStartLevel(reachedLevel);
    
    // Only save checkpoint if player made it past level 5
    if (checkpointLevel <= 1) {
      return;
    }

    const data: CheckpointData = {
      checkpointLevel,
      expiresAt: Date.now() + CHECKPOINT_DURATION_MS,
      reachedLevel,
    };

    setCheckpointData(data);
    localStorage.setItem(CHECKPOINT_STORAGE_KEY, JSON.stringify(data));
  }, []);

  // Clear checkpoint (when player completes the game or starts fresh)
  const clearCheckpoint = useCallback(() => {
    setCheckpointData(null);
    localStorage.removeItem(CHECKPOINT_STORAGE_KEY);
  }, []);

  // Get the starting level (checkpoint level if valid, otherwise 1)
  const getStartingLevel = useCallback((): number => {
    if (!checkpointData) return 1;
    
    const now = Date.now();
    if (checkpointData.expiresAt <= now) {
      // Expired
      localStorage.removeItem(CHECKPOINT_STORAGE_KEY);
      setCheckpointData(null);
      return 1;
    }
    
    return checkpointData.checkpointLevel;
  }, [checkpointData]);

  // Get remaining time in ms (for display purposes)
  const getRemainingTimeMs = useCallback((): number => {
    if (!checkpointData) return 0;
    return Math.max(0, checkpointData.expiresAt - Date.now());
  }, [checkpointData]);

  // Check if checkpoint is active
  const hasActiveCheckpoint = checkpointData !== null && 
    checkpointData.expiresAt > Date.now() && 
    checkpointData.checkpointLevel > 1;

  return {
    checkpointData,
    hasActiveCheckpoint,
    isLoaded,
    saveCheckpoint,
    clearCheckpoint,
    getStartingLevel,
    getRemainingTimeMs,
  };
}
