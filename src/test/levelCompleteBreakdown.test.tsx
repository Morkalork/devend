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
    expect(screen.queryByText('Score')).toBeNull();
  });

  it('reveals the itemised rows when opened', () => {
    renderOverlay();
    fireEvent.click(screen.getByText('Score breakdown'));

    expect(screen.getByText('Fences Used')).toBeTruthy();
    expect(screen.getByText('Score')).toBeTruthy();
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
 * The breakdown lists what the map offered, and closes with what you took.
 *
 * It used to itemise the scoring mechanics one row per mechanic - Thread Locks,
 * Superior Locks, Zone Locks, Multi Locks, Break, Ship Early, Push - ABOVE the
 * five Performance Review axes those same hours had already been banked into.
 * On the level-3 run that prompted the rewrite the itemised rows summed to
 * exactly the axis total, so the screen showed every hour twice and invited the
 * player to add them up to a number the scorer never paid. Zone Locks was worse
 * than redundant: it showed +9h for a lock that CONTRIBUTED to an already-full
 * Craft axis and therefore paid nothing at all.
 *
 * The rows are gone. What is left is one row per thing the map actually offers
 * - the base, the five axes, the zone share - each showing what it paid out of
 * what it could, and a Score line that comes from the scorer rather than from
 * this screen adding its own rows up.
 */
describe('the breakdown says what was on offer, not just what landed', () => {
  const withAxes = {
    ...scoreData,
    multipliedBase: 20,
    mapCeiling: 100,
    levelScore: 56,
    axes: {
      delivery: 18, craft: 0, tempo: 12, thrift: 6, greed: 0,
      total: 36,
      ratios: { delivery: 0.6, craft: 0, tempo: 0.6, thrift: 0.3, greed: 0 },
      ceilings: { delivery: 30, craft: 20, tempo: 20, thrift: 20, greed: 10 },
    },
  } as LevelScoreData;

  it('shows an axis that paid nothing, rather than hiding it', () => {
    // The empty axis is the more useful half of the readout: it is the hours
    // that were on the table and left there. A screen that lists only what you
    // earned cannot tell you what you passed up.
    renderOverlay({ scoreData: withAxes });
    fireEvent.click(screen.getByText('Score breakdown'));

    expect(screen.getByText('Craft')).toBeTruthy();
    expect(screen.getByText('0/20h'), 'an unearned axis is missing its row').toBeTruthy();
  });

  it('says what each axis paid, not only what it missed', () => {
    // The right-hand number was the bare shortfall ("-12h") back when the
    // itemised rows below carried the hours banked. With those rows deleted it
    // is the only number on the row, so an axis that paid 18h of 30h would
    // report nothing but its deficit.
    renderOverlay({ scoreData: withAxes });
    fireEvent.click(screen.getByText('Score breakdown'));

    expect(screen.getByText('18/30h'), 'the hours the axis paid are not shown').toBeTruthy();
    expect(screen.queryByText('-12h'), 'the row still shows only the shortfall').toBeNull();
  });

  it('no longer itemises the same hours a second time', () => {
    // The duplication itself. These rows restated axis income that the axis
    // block above them had already reported.
    renderOverlay({ scoreData: { ...withAxes, zoneLockCount: 1, zoneLockBonus: 9 } });
    fireEvent.click(screen.getByText('Score breakdown'));

    expect(screen.queryByText(/Thread Locks/)).toBeNull();
    expect(screen.queryByText(/Superior Locks/)).toBeNull();
    expect(screen.queryByText(/Zone Locks/)).toBeNull();
  });

  it("closes with the scorer's own numbers, not a sum of its rows", () => {
    // THE guard. Every earlier version of this screen recomputed some part of
    // the payout and drifted from it - the base row was showing 20h while the
    // scorer had paid 25h, a 5h gap, because the row applied the performance
    // multiplier and forgot the run's score multiplier. Both ends of this line
    // now come from the breakdown the scorer produced.
    renderOverlay({ scoreData: withAxes });
    fireEvent.click(screen.getByText('Score breakdown'));

    expect(screen.getByText('Score')).toBeTruthy();
    expect(screen.getByText('56'), 'the score is not what the scorer paid').toBeTruthy();
    expect(screen.getByText('/ 100h'), "the map ceiling is not the scorer's").toBeTruthy();
  });

  it('never claims a ceiling smaller than what was earned', () => {
    // A ceiling that has drifted below the payout renders "56 / 40h", which
    // reads as a bug in the player's favour and destroys trust in the line.
    renderOverlay({ scoreData: { ...withAxes, mapCeiling: 10 } });
    fireEvent.click(screen.getByText('Score breakdown'));
    expect(screen.queryByText('/ 10h')).toBeNull();
    expect(screen.getByText('/ 56h')).toBeTruthy();
  });
});
