import { useState, useCallback } from 'react';

/**
 * Tracks which one-time tutorials the player has already seen, persisted in
 * localStorage so they only appear on the first encounter.
 *
 * Flags:
 * - `fence`      — interactive "draw your first fence" tutorial (level 1)
 * - `store`      — upgrade shop intro (first shop visit)
 * - `certStore`  — certificate store intro (first store visit)
 * - `mover`      — moving-obstacle warning (first level with movers)
 * - `infoPanels` — "the top/bottom bars are expandable" hint
 *
 * "Re-enable All Tutorials" in the options screen calls resetAllTutorials().
 */

const STORAGE_KEY = 'tutorials_seen_v1';
const OLD_STORAGE_KEY = 'ball_breaker_seen_interactive_tutorial';

interface TutorialsSeen {
  fence: boolean;
  store: boolean;
  certStore: boolean;
  mover: boolean;
  infoPanels: boolean;
}

const NONE_SEEN: TutorialsSeen = {
  fence: false,
  store: false,
  certStore: false,
  mover: false,
  infoPanels: false,
};

function loadSeen(): TutorialsSeen {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        fence: !!parsed.fence,
        store: !!parsed.store,
        // `augment` is the legacy name for the certificate store flag.
        certStore: !!(parsed.certStore ?? parsed.augment),
        mover: !!parsed.mover,
        infoPanels: !!parsed.infoPanels,
      };
    }
    // Migration: very old installs stored a single boolean for the fence tutorial.
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old === 'true') {
      return { ...NONE_SEEN, fence: true };
    }
  } catch {
    // ignore corrupt storage and fall through to defaults
  }
  return { ...NONE_SEEN };
}

function saveSeen(seen: TutorialsSeen) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // ignore (storage may be unavailable, e.g. private browsing)
  }
}

export function useTutorialManager() {
  const [seen, setSeen] = useState<TutorialsSeen>(loadSeen);

  const markSeen = useCallback((flag: keyof TutorialsSeen) => {
    setSeen(prev => {
      const next = { ...prev, [flag]: true };
      saveSeen(next);
      return next;
    });
  }, []);

  const markFenceSeen = useCallback(() => markSeen('fence'), [markSeen]);
  const markStoreSeen = useCallback(() => markSeen('store'), [markSeen]);
  const markCertStoreSeen = useCallback(() => markSeen('certStore'), [markSeen]);
  const markMoverSeen = useCallback(() => markSeen('mover'), [markSeen]);
  const markInfoPanelsSeen = useCallback(() => markSeen('infoPanels'), [markSeen]);

  const resetAllTutorials = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(OLD_STORAGE_KEY);
    } catch {
      // ignore
    }
    setSeen({ ...NONE_SEEN });
  }, []);

  return {
    shouldShowFence: !seen.fence,
    shouldShowStore: !seen.store,
    shouldShowCertStore: !seen.certStore,
    shouldShowMover: !seen.mover,
    shouldShowInfoPanels: !seen.infoPanels,
    markFenceSeen,
    markStoreSeen,
    markCertStoreSeen,
    markMoverSeen,
    markInfoPanelsSeen,
    resetAllTutorials,
  };
}
