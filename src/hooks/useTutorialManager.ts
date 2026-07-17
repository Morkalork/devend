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
 * - `topBar`     — "what is the top bar" hint (level 2)
 * - `bottomBar`  — "what is the bottom bar" hint (level 3)
 * - `ascension`  — Ascension mode intro (first arrival at the draft screen)
 * - `daily`      — Daily Stand-up intro (first time the button is tapped)
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
  topBar: boolean;
  bottomBar: boolean;
  ascension: boolean;
  daily: boolean;
}

const NONE_SEEN: TutorialsSeen = {
  fence: false,
  store: false,
  certStore: false,
  mover: false,
  topBar: false,
  bottomBar: false,
  ascension: false,
  daily: false,
};

function loadSeen(): TutorialsSeen {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // `infoPanels` is the legacy single flag that covered both bars.
      return {
        fence: !!parsed.fence,
        store: !!parsed.store,
        // `augment` is the legacy name for the certificate store flag.
        certStore: !!(parsed.certStore ?? parsed.augment),
        mover: !!parsed.mover,
        topBar: !!(parsed.topBar ?? parsed.infoPanels),
        bottomBar: !!(parsed.bottomBar ?? parsed.infoPanels),
        ascension: !!parsed.ascension,
        daily: !!parsed.daily,
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
  const markTopBarSeen = useCallback(() => markSeen('topBar'), [markSeen]);
  const markBottomBarSeen = useCallback(() => markSeen('bottomBar'), [markSeen]);
  const markAscensionSeen = useCallback(() => markSeen('ascension'), [markSeen]);
  const markDailySeen = useCallback(() => markSeen('daily'), [markSeen]);

  const resetAllTutorials = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(OLD_STORAGE_KEY);
      // Self-contained one-time intros managed by GameScreen (no flag here).
      localStorage.removeItem('devend_break_tutorial_seen');
      localStorage.removeItem('devend_creep_tutorial_seen');
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
    shouldShowTopBar: !seen.topBar,
    shouldShowBottomBar: !seen.bottomBar,
    shouldShowAscension: !seen.ascension,
    shouldShowDaily: !seen.daily,
    markFenceSeen,
    markStoreSeen,
    markCertStoreSeen,
    markMoverSeen,
    markTopBarSeen,
    markBottomBarSeen,
    markAscensionSeen,
    markDailySeen,
    resetAllTutorials,
  };
}
