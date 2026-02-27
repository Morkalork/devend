import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'tutorials_seen_v1';
const OLD_STORAGE_KEY = 'ball_breaker_seen_interactive_tutorial';

interface TutorialsSeen {
  topBar: boolean;
  bottomBar: boolean;
  fence: boolean;
  store: boolean;
  augment: boolean;
}

function loadSeen(): TutorialsSeen {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as TutorialsSeen;
    }
    // Migration: if old key is set, mark top/bottom/fence as seen
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old === 'true') {
      return { topBar: true, bottomBar: true, fence: true, store: false, augment: false };
    }
  } catch {
    // ignore
  }
  return { topBar: false, bottomBar: false, fence: false, store: false, augment: false };
}

function saveSeen(seen: TutorialsSeen) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // ignore
  }
}

export function useTutorialManager() {
  const [seen, setSeen] = useState<TutorialsSeen>(loadSeen);

  const markTopBarSeen = useCallback(() => {
    setSeen(prev => {
      const next = { ...prev, topBar: true };
      saveSeen(next);
      return next;
    });
  }, []);

  const markBottomBarSeen = useCallback(() => {
    setSeen(prev => {
      const next = { ...prev, bottomBar: true };
      saveSeen(next);
      return next;
    });
  }, []);

  const markFenceSeen = useCallback(() => {
    setSeen(prev => {
      const next = { ...prev, fence: true };
      saveSeen(next);
      return next;
    });
  }, []);

  const markStoreSeen = useCallback(() => {
    setSeen(prev => {
      const next = { ...prev, store: true };
      saveSeen(next);
      return next;
    });
  }, []);

  const markAugmentSeen = useCallback(() => {
    setSeen(prev => {
      const next = { ...prev, augment: true };
      saveSeen(next);
      return next;
    });
  }, []);

  const resetAllTutorials = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(OLD_STORAGE_KEY);
    } catch {
      // ignore
    }
    setSeen({ topBar: false, bottomBar: false, fence: false, store: false, augment: false });
  }, []);

  return {
    shouldShowTopBar: !seen.topBar,
    shouldShowBottomBar: !seen.bottomBar,
    shouldShowFence: !seen.fence,
    shouldShowStore: !seen.store,
    shouldShowAugment: !seen.augment,
    markTopBarSeen,
    markBottomBarSeen,
    markFenceSeen,
    markStoreSeen,
    markAugmentSeen,
    resetAllTutorials,
  };
}
