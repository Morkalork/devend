/**
 * Onboarding map (onboardingMap.ts): a brand new player's first map is the
 * empty "learn the loop" board, and from their second run onwards the authored
 * level-1 map is played instead.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { buildLevelSequence } from '@/hooks/useLevelManager';
import { useTutorialManager } from '@/hooks/useTutorialManager';
import { ONBOARDING_MAP, ONBOARDING_MAP_ID, isOnboardingMap } from '@/lib/onboardingMap';
import { setRunSeedText, dailySeedText } from '@/lib/runRng';
import type { LevelConfig } from '@/types/level';

const map = (id: string, level: number): LevelConfig => ({
  id, level, sizeThreshold: 40, expectedCuts: 2, points: 20, maxBalls: 1, entities: [],
});

const MAPS: LevelConfig[] = [map('level-1', 1), map('level-2', 2), map('level-3', 3)];

beforeEach(() => {
  localStorage.clear();
  setRunSeedText(null);
});

afterEach(() => {
  setRunSeedText(null);
});

describe('onboarding map', () => {
  it('is an empty, one-ball board with no random shapes or pickups', () => {
    expect(ONBOARDING_MAP.entities).toEqual([]);
    expect(ONBOARDING_MAP.maxBalls).toBe(1);
    expect(ONBOARDING_MAP.randomShapes).toBe(0);
    expect(ONBOARDING_MAP.pickupChance).toBe(0);
    // Level 1, so the tutorial band's rules (no time limit, fence tutorial)
    // apply exactly as they do for a normal opening map.
    expect(ONBOARDING_MAP.level).toBe(1);
    expect(isOnboardingMap(ONBOARDING_MAP)).toBe(true);
    expect(isOnboardingMap(MAPS[0])).toBe(false);
  });

  it('takes the first slot on a fresh install, and only the first slot', () => {
    const seq = buildLevelSequence(MAPS);
    expect(seq[0].id).toBe(ONBOARDING_MAP_ID);
    expect(seq.slice(1).map(m => m.id)).toEqual(['level-2', 'level-3']);
  });

  it('is gone once marked seen: the authored level-1 map opens the run', () => {
    const { result } = renderHook(() => useTutorialManager());
    act(() => result.current.markOnboardingSeen());

    const seq = buildLevelSequence(MAPS);
    expect(seq.map(m => m.id)).toEqual(['level-1', 'level-2', 'level-3']);
  });

  it('is never picked as a level-1 variant when it is passed in as a map', () => {
    const { result } = renderHook(() => useTutorialManager());
    act(() => result.current.markOnboardingSeen());

    // Even if it somehow reaches the variant pool it must not be rolled.
    const seq = buildLevelSequence([...MAPS, ONBOARDING_MAP]);
    expect(seq.map(m => m.id)).toEqual(['level-1', 'level-2', 'level-3']);
  });

  it('is skipped on a seeded (Daily) run so every player gets the same board', () => {
    setRunSeedText(dailySeedText('2026-07-27'));
    const seq = buildLevelSequence(MAPS);
    expect(seq[0].id).toBe('level-1');
  });

  it('re-arms with "Re-enable All Tutorials"', () => {
    const { result } = renderHook(() => useTutorialManager());
    act(() => result.current.markOnboardingSeen());
    expect(buildLevelSequence(MAPS)[0].id).toBe('level-1');

    act(() => result.current.resetAllTutorials());
    expect(result.current.shouldShowOnboarding).toBe(true);
    expect(buildLevelSequence(MAPS)[0].id).toBe(ONBOARDING_MAP_ID);
  });

  it('does not re-arm for installs that already saw the fence tutorial', () => {
    // An existing player's storage predates the onboarding flag entirely.
    localStorage.setItem('tutorials_seen_v1', JSON.stringify({ fence: true, store: true }));
    const { result } = renderHook(() => useTutorialManager());
    expect(result.current.shouldShowOnboarding).toBe(false);
    expect(buildLevelSequence(MAPS)[0].id).toBe('level-1');
  });
});
