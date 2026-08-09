/**
 * The post-map overlay's collapsible score breakdown.
 *
 * Every new scoring mechanic adds a row to this screen and none are ever
 * removed, so it grew without bound. The itemised rows now collapse (closed by
 * default) while the totals, which are fixed-size, stay out of the fold: the
 * screen must still answer "what did I earn?" without a tap.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise react-i18next synchronously
import { LevelCompleteOverlay } from '@/components/game/LevelCompleteOverlay';
import type { LevelScoreData } from '@/types/game';

const scoreData: LevelScoreData = {
  levelNumber: 4,
  levelId: 'level-4',
  cutCount: 3,
  expectedCuts: 5,
  basePoints: 20,
  levelScore: 48,
  remainingPercent: 12,
  underParBonus: 6,
  spaceBonus: 4,
  lockBonus: 10,
  lockedBallsCount: 2,
  performanceMultiplier: 1,
};

function renderOverlay(overrides: Partial<React.ComponentProps<typeof LevelCompleteOverlay>> = {}) {
  return render(
    <LevelCompleteOverlay
      scoreData={scoreData}
      totalScore={120}
      onContinue={vi.fn()}
      buttonDelay={0}
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe('post-map score breakdown collapses', () => {
  it('hides the itemised rows by default but keeps the totals visible', () => {
    renderOverlay();

    // The payoff must survive the collapse: these are why the screen exists.
    expect(screen.getByText('Overtime Earned')).toBeTruthy();
    expect(screen.getByText('Total Overtime')).toBeTruthy();

    // The itemisation is behind the toggle.
    expect(screen.getByText('Score breakdown')).toBeTruthy();
    expect(screen.queryByText('Fences Used')).toBeNull();
    expect(screen.queryByText('Total Bonus')).toBeNull();
  });

  it('reveals the itemised rows when opened', () => {
    renderOverlay();
    fireEvent.click(screen.getByText('Score breakdown'));

    expect(screen.getByText('Fences Used')).toBeTruthy();
    expect(screen.getByText('Total Bonus')).toBeTruthy();
  });

  // Closing by default would otherwise bury the good news, so the collapsed
  // header carries the bonus subtotal and answers "was that map worth it?".
  it('shows the bonus subtotal on the collapsed header', () => {
    renderOverlay();
    expect(screen.getByText('+20h')).toBeTruthy();
  });

  it('omits the subtotal when the map earned no bonus at all', () => {
    renderOverlay({
      scoreData: { ...scoreData, underParBonus: 0, spaceBonus: 0, lockBonus: 0 },
    });
    expect(screen.getByText('Score breakdown')).toBeTruthy();
    expect(screen.queryByText('+0h')).toBeNull();
  });
});
