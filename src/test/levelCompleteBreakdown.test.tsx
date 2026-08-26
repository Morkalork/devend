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

describe('post-map screen names the win condition', () => {
  it('reports the condition that finished the map', () => {
    renderOverlay({ scoreData: { ...scoreData, winReason: 'allLocked' } });
    expect(screen.getByText('All balls locked')).toBeTruthy();
  });

  // Old saves and the game-over path carry no reason; inventing one would be
  // worse than staying quiet, since the label exists to be trusted.
  it('stays silent rather than guessing when no reason is given', () => {
    renderOverlay();
    expect(screen.queryByText(/Won by/)).toBeNull();
  });

  // Locking the last ball captures everything unreachable, so remaining drops to
  // 0% and the size threshold is met as a CONSEQUENCE. Claiming the space target
  // on every all-locked win would be flattering, not honest.
  it('does not claim the space target when the lock is what drained the board', () => {
    renderOverlay({ scoreData: { ...scoreData, winReason: 'allLocked' } });
    expect(screen.getByText('All balls locked')).toBeTruthy();
    expect(screen.queryByText(/space target also met/)).toBeNull();
  });

  it('says both landed when the cut cleared to target on its own merits', () => {
    renderOverlay({
      scoreData: { ...scoreData, winReason: 'allLocked', alsoClearedSpace: true },
    });
    expect(screen.getByText('All balls locked')).toBeTruthy();
    expect(screen.getByText(/space target also met/)).toBeTruthy();
  });

  it('hides Remaining only for the all-locked win, which drains the board', () => {
    renderOverlay({ scoreData: { ...scoreData, winReason: 'space' } });
    fireEvent.click(screen.getByText('Score breakdown'));
    expect(screen.getByText('Remaining')).toBeTruthy();
  });
});

/**
 * Every itemised row answers the same question: how many hours did this earn?
 *
 * Reported from a real session: "I just got a zone-lock and it says x1, which
 * presumably means I got nothing for it?" It did pay - the zone multiplier is
 * folded into lock income before this screen ever sees it - but the row showed
 * the COUNT of zone locks with an "x" in front of it, so one zone lock read as
 * a times-one multiplier, which is the arithmetic for "nothing". The row's own
 * hold-to-explain text says outright that it "shows only the hours the zone
 * added", so the copy and the code disagreed and the code was wrong.
 */
describe('every bonus row reports hours, not a tally', () => {
  const withZone = {
    ...scoreData,
    lockBonus: 24,
    lockedBallsCount: 2,
    standardLockBonus: 24,
    zoneLockCount: 1,
    zoneLockBonus: 7,
  } as LevelScoreData;

  it('shows what a zone lock paid, not how many there were', () => {
    renderOverlay({ scoreData: withZone });
    fireEvent.click(screen.getByText('Score breakdown'));

    expect(screen.getByText('Zone Locks (1)'), 'the zone row is missing').toBeTruthy();
    // "x1" is the failure: a count wearing a multiplier's clothes.
    expect(screen.queryByText('x1'), 'the row still shows a bare tally').toBeNull();
    expect(screen.getByText('+7h'), 'the hours the zone added are not shown').toBeTruthy();
  });

  it('keeps the row hidden when the zones added nothing', () => {
    // Better silent than a row that says a zone paid and cannot say how much.
    renderOverlay({ scoreData: { ...withZone, zoneLockBonus: 0 } });
    fireEvent.click(screen.getByText('Score breakdown'));
    expect(screen.queryByText(/Zone Locks/)).toBeNull();
  });
});
