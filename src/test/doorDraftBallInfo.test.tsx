/**
 * Next Assignment (DoorDraftScreen): each spawnable ball in the intel preview is
 * press-and-holdable to read its ability (or plainness, for the standard balls).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise react-i18next synchronously
import { DoorDraftScreen } from '@/components/game/DoorDraftScreen';
import { selectBallTypesForMap } from '@/lib/ballTypes';
import { LevelConfig } from '@/types/level';
import { DoorConfig } from '@/types/door';

const nextLevel = {
  id: 'assign-test', level: 5, sizeThreshold: 25, expectedCuts: 14, points: 40, maxBalls: 2,
} as unknown as LevelConfig;

const offers = [
  { id: 'd1', name: 'Test Door', risk: 'A risk', reward: 'A reward', clarify: '', modifiers: {} },
] as unknown as DoorConfig[];

afterEach(cleanup);

describe('DoorDraftScreen spawnable-ball info', () => {
  it('holding a ball opens a modal with its description', () => {
    const balls = selectBallTypesForMap(nextLevel.id, nextLevel.level, nextLevel.maxBalls ?? 1);
    expect(balls.length).toBeGreaterThan(0);
    const first = balls[0];

    vi.useFakeTimers();
    try {
      render(<DoorDraftScreen nextLevel={nextLevel} offers={offers} onSelect={vi.fn()} />);

      // The description isn't shown until you hold the ball.
      expect(screen.queryByText(first.description)).toBeNull();
      const ballBtn = screen.getAllByRole('button', { name: first.name })[0];
      fireEvent.pointerDown(ballBtn);
      act(() => { vi.advanceTimersByTime(500); });

      expect(screen.getByText(first.description)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
