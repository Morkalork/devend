import { useCallback, useState } from 'react';

/**
 * First-time menu highlights: during the first few hours of play, the welcome
 * screen calls out buttons where something just happened for the first time
 * with a gold ring + NEW badge (see .menu-highlight in index.css):
 *
 * - `newGame`      — very first visit to the main menu
 * - `records`      — first run filed on the Performance Review ledger
 * - `certificates` — first Certificate Hour earned
 * - `achievements` — first achievement completed
 * - `daily`        — Daily Stand-up, once the first run is banked (it exists
 *                    from the start, but nudging it before the player has done
 *                    a normal run would compete with the New Game highlight)
 *
 * A highlight shows while its trigger is true and the player hasn't tapped
 * that button yet; tapping acknowledges it permanently. Persisted under
 * MENU_HIGHLIGHTS_KEY. "Re-enable All Tutorials" in Options resets these
 * alongside the tutorials (composed in Index.tsx).
 */

export const MENU_HIGHLIGHTS_KEY = 'menu_highlights_v1';

export type MenuHighlightKey = 'newGame' | 'records' | 'certificates' | 'achievements' | 'daily';

export type MenuHighlightFlags = Record<MenuHighlightKey, boolean>;

const NONE_SEEN: MenuHighlightFlags = {
  newGame: false,
  records: false,
  certificates: false,
  achievements: false,
  daily: false,
};

/**
 * Seeding rule for installs that predate this feature (exported for tests).
 * With no stored flags, an existing install (any prior progress) marks New
 * Game plus every already-true trigger as seen, so long-time players don't
 * get a wall of highlights for firsts that happened ages ago. A fresh install
 * starts with nothing seen.
 */
export function seedSeen(triggers: MenuHighlightFlags, hasPriorProgress: boolean): MenuHighlightFlags {
  if (!hasPriorProgress) return { ...NONE_SEEN };
  return {
    newGame: true,
    records: triggers.records,
    certificates: triggers.certificates,
    achievements: triggers.achievements,
    daily: triggers.daily,
  };
}

function saveSeen(seen: MenuHighlightFlags) {
  try {
    localStorage.setItem(MENU_HIGHLIGHTS_KEY, JSON.stringify(seen));
  } catch {
    // ignore (storage may be unavailable, e.g. private browsing)
  }
}

function loadSeen(triggers: MenuHighlightFlags, hasPriorProgress: boolean): MenuHighlightFlags {
  try {
    const raw = localStorage.getItem(MENU_HIGHLIGHTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        newGame: !!parsed.newGame,
        records: !!parsed.records,
        certificates: !!parsed.certificates,
        achievements: !!parsed.achievements,
        daily: !!parsed.daily,
      };
    }
  } catch {
    // corrupt storage: fall through and reseed
  }
  const seeded = seedSeen(triggers, hasPriorProgress);
  saveSeen(seeded);
  return seeded;
}

export function useMenuHighlights(triggers: MenuHighlightFlags, hasPriorProgress: boolean) {
  // Seeding only happens here, on the first render with no stored flags;
  // hasPriorProgress is ignored afterwards.
  const [seen, setSeen] = useState<MenuHighlightFlags>(() => loadSeen(triggers, hasPriorProgress));

  const acknowledge = useCallback((key: MenuHighlightKey) => {
    setSeen(prev => {
      if (prev[key]) return prev;
      const next = { ...prev, [key]: true };
      saveSeen(next);
      return next;
    });
  }, []);

  const resetHighlights = useCallback(() => {
    // Persist an explicit all-unseen state rather than removing the key. An
    // absent key means "feature is new to this save" and would re-seed earned
    // firsts as seen for a player with prior progress (seedSeen), silently
    // undoing the reset on the next launch. Writing all-false keeps every
    // highlight armed across reloads until the player taps each button.
    const reset = { ...NONE_SEEN };
    saveSeen(reset);
    setSeen(reset);
  }, []);

  const highlights: MenuHighlightFlags = {
    newGame: triggers.newGame && !seen.newGame,
    records: triggers.records && !seen.records,
    certificates: triggers.certificates && !seen.certificates,
    achievements: triggers.achievements && !seen.achievements,
    daily: triggers.daily && !seen.daily,
  };

  return { highlights, acknowledge, resetHighlights };
}
