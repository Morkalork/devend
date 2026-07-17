/**
 * First-time menu highlights (useMenuHighlights): the welcome screen marks
 * buttons where something happened for the first time with a gold ring + NEW
 * badge. These tests cover the trigger/seen logic, persistence, seeding for
 * installs that predate the feature, and the Options reset.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useMenuHighlights,
  seedSeen,
  MENU_HIGHLIGHTS_KEY,
  MenuHighlightFlags,
} from '@/hooks/useMenuHighlights';

const NO_TRIGGERS: MenuHighlightFlags = {
  newGame: false,
  records: false,
  certificates: false,
  achievements: false,
  daily: false,
};

const FRESH_INSTALL: MenuHighlightFlags = { ...NO_TRIGGERS, newGame: true };

function render(triggers: MenuHighlightFlags, hasPriorProgress: boolean) {
  return renderHook(
    ({ t, p }: { t: MenuHighlightFlags; p: boolean }) => useMenuHighlights(t, p),
    { initialProps: { t: triggers, p: hasPriorProgress } },
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('seedSeen', () => {
  it('fresh install: nothing is pre-acknowledged', () => {
    expect(seedSeen(FRESH_INSTALL, false)).toEqual(NO_TRIGGERS);
  });

  it('existing install: New Game and already-true triggers are pre-acknowledged', () => {
    const seeded = seedSeen({ ...FRESH_INSTALL, records: true, daily: true }, true);
    expect(seeded).toEqual({
      newGame: true,
      records: true,
      certificates: false,
      achievements: false,
      daily: true,
    });
  });
});

describe('useMenuHighlights', () => {
  it('fresh install highlights New Game only', () => {
    const { result } = render(FRESH_INSTALL, false);
    expect(result.current.highlights).toEqual({ ...NO_TRIGGERS, newGame: true });
  });

  it('acknowledging a highlight clears it and persists across remounts', () => {
    const { result, unmount } = render(FRESH_INSTALL, false);
    act(() => result.current.acknowledge('newGame'));
    expect(result.current.highlights.newGame).toBe(false);
    unmount();

    const remounted = render(FRESH_INSTALL, false);
    expect(remounted.result.current.highlights.newGame).toBe(false);
  });

  it('a highlight appears when its trigger flips true and stays until acknowledged', () => {
    const { result, rerender } = render(FRESH_INSTALL, false);
    expect(result.current.highlights.records).toBe(false);

    // First run banked: records + daily trigger together (all-at-once policy).
    const after = { ...FRESH_INSTALL, records: true, daily: true };
    rerender({ t: after, p: false });
    expect(result.current.highlights.records).toBe(true);
    expect(result.current.highlights.daily).toBe(true);

    act(() => result.current.acknowledge('records'));
    expect(result.current.highlights.records).toBe(false);
    expect(result.current.highlights.daily).toBe(true);
  });

  it('existing installs are seeded quiet, but later firsts still highlight', () => {
    // Player with prior records but no cert hours when the feature ships.
    const atSeed = { ...FRESH_INSTALL, records: true, daily: true };
    const { result, rerender } = render(atSeed, true);
    expect(result.current.highlights).toEqual(NO_TRIGGERS);

    // First Certificate Hour after the update still gets its moment.
    rerender({ t: { ...atSeed, certificates: true }, p: true });
    expect(result.current.highlights.certificates).toBe(true);
  });

  it('corrupt storage falls back to reseeding', () => {
    localStorage.setItem(MENU_HIGHLIGHTS_KEY, 'not json{');
    const { result } = render(FRESH_INSTALL, false);
    expect(result.current.highlights.newGame).toBe(true);
    // Reseed is persisted as valid JSON again.
    expect(() => JSON.parse(localStorage.getItem(MENU_HIGHLIGHTS_KEY)!)).not.toThrow();
  });

  it('resetHighlights re-arms every highlight and survives a reload', () => {
    const triggers = { ...FRESH_INSTALL, records: true };
    const { result, unmount } = render(triggers, false);
    act(() => {
      result.current.acknowledge('newGame');
      result.current.acknowledge('records');
    });
    expect(result.current.highlights).toEqual(NO_TRIGGERS);

    act(() => result.current.resetHighlights());
    expect(result.current.highlights).toEqual({ ...NO_TRIGGERS, newGame: true, records: true });

    // Reset must persist as an explicit all-unseen state, not a deleted key —
    // otherwise a player with prior progress gets re-seeded quiet on reload.
    expect(JSON.parse(localStorage.getItem(MENU_HIGHLIGHTS_KEY)!)).toEqual(NO_TRIGGERS);
    unmount();
    const reloaded = render(triggers, /* hasPriorProgress */ true);
    expect(reloaded.result.current.highlights).toEqual({ ...NO_TRIGGERS, newGame: true, records: true });
  });
});
