/**
 * Daily Stand-up intro flag (useTutorialManager): the first time the player
 * opens Daily Stand-up they see a one-time explainer modal. This covers the
 * new `daily` tutorial flag: it starts unseen, persists once marked, and is
 * re-armed by "Re-enable All Tutorials".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTutorialManager } from '@/hooks/useTutorialManager';

beforeEach(() => {
  localStorage.clear();
});

describe('Daily Stand-up intro flag', () => {
  it('is shown on a fresh install', () => {
    const { result } = renderHook(() => useTutorialManager());
    expect(result.current.shouldShowDaily).toBe(true);
  });

  it('marking it seen hides it and persists across a remount', () => {
    const { result, unmount } = renderHook(() => useTutorialManager());
    act(() => result.current.markDailySeen());
    expect(result.current.shouldShowDaily).toBe(false);
    unmount();

    const remounted = renderHook(() => useTutorialManager());
    expect(remounted.result.current.shouldShowDaily).toBe(false);
  });

  it('does not disturb the other tutorial flags', () => {
    const { result } = renderHook(() => useTutorialManager());
    act(() => result.current.markDailySeen());
    expect(result.current.shouldShowFence).toBe(true);
    expect(result.current.shouldShowAscension).toBe(true);
  });

  it('is re-armed by resetAllTutorials', () => {
    const { result } = renderHook(() => useTutorialManager());
    act(() => result.current.markDailySeen());
    expect(result.current.shouldShowDaily).toBe(false);

    act(() => result.current.resetAllTutorials());
    expect(result.current.shouldShowDaily).toBe(true);
  });
});
