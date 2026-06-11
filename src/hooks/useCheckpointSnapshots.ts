/**
 * useCheckpointSnapshots — saved per-level run snapshots (score, upgrades,
 * lives) that power the level picker on the welcome screen.
 *
 * A snapshot is saved each time the player advances to a new level; the
 * picker lets them restart from any saved level with the matching state.
 *
 * Not to be confused with useContinueCheckpoint, which is the single
 * 10-minute 'Continue' checkpoint.
 */
import { useCallback, useState, useEffect } from 'react';

const STORAGE_KEY = 'jezzball_checkpoints_v2';
const MAX_CHECKPOINTS = 6;

export interface CheckpointSnapshot {
  level: number;
  totalScore: number;
  ownedUpgradeIds: string[];
  lives: number;
  savedAt: number;
}

function loadFromStorage(): CheckpointSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(snapshots: CheckpointSnapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // ignore storage errors
  }
}

export function useCheckpointSnapshots() {
  const [checkpoints, setCheckpoints] = useState<CheckpointSnapshot[]>(() => loadFromStorage());

  // Sync state from storage on mount in case another tab wrote
  useEffect(() => {
    setCheckpoints(loadFromStorage());
  }, []);

  const saveCheckpoint = useCallback((snapshot: CheckpointSnapshot) => {
    setCheckpoints(prev => {
      // Replace any existing checkpoint for this level, then cap to MAX_CHECKPOINTS (most recent first)
      const without = prev.filter(c => c.level !== snapshot.level);
      const updated = [snapshot, ...without]
        .sort((a, b) => b.level - a.level)
        .slice(0, MAX_CHECKPOINTS);
      saveToStorage(updated);
      return updated;
    });
  }, []);

  const clearCheckpoints = useCallback(() => {
    setCheckpoints([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  // Remove any checkpoints beyond the given level (used when a run started from
  // a checkpoint surpasses the existing highest checkpoint level).
  const trimCheckpointsAbove = useCallback((level: number) => {
    setCheckpoints(prev => {
      const trimmed = prev.filter(c => c.level <= level);
      saveToStorage(trimmed);
      return trimmed;
    });
  }, []);

  return {
    checkpoints,
    saveCheckpoint,
    clearCheckpoints,
    trimCheckpointsAbove,
  };
}
