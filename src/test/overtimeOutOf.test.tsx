/**
 * "Overtime x / y" on the always-visible row.
 *
 * The itemised breakdown already carried a "Score: x / y" line, but it lives
 * behind a toggle that is collapsed by default, so the fraction only existed
 * for players who opened a panel most never open. The headline number on its
 * own cannot answer the only question it raises: was 84h the whole map, or a
 * third of it?
 *
 * The denominator is deliberately the SAME one the Score row uses - the
 * scorer's own map ceiling - because two fractions on one screen that disagree
 * are worse than one fraction that is hidden.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise react-i18next synchronously
import { LevelCompleteOverlay } from '@/components/game/LevelCompleteOverlay';
import type { LevelScoreData } from '@/types/game';

const base: LevelScoreData = {
  levelNumber: 4,
  levelId: 'level-4',
  cutCount: 3,
  expectedCuts: 5,
  basePoints: 20,
  levelScore: 56,
  remainingPercent: 12,
  performanceMultiplier: 1,
  multipliedBase: 20,
  mapCeiling: 100,
};

function renderOverlay(scoreData: LevelScoreData) {
  return render(
    <LevelCompleteOverlay
      scoreData={scoreData}
      totalScore={120}
      onContinue={vi.fn()}
      buttonDelay={0}
    />,
  );
}

afterEach(cleanup);

describe('the Overtime row states what the map could have paid', () => {
  it('shows the ceiling without opening the breakdown', () => {
    renderOverlay(base);

    // The breakdown is shut: this is the whole point of the change.
    expect(screen.queryByText('Score'), 'the breakdown opened itself').toBeNull();
    expect(screen.getByText('Overtime Earned')).toBeTruthy();
    expect(screen.getByText('/ 100'), 'the ceiling is not on the collapsed screen').toBeTruthy();
  });

  it('drops the fraction when the map paid everything it had', () => {
    // "112h" says the same thing as "112 / 112h" and reads better. This is the
    // one case the user singled out as not needing the second number.
    renderOverlay({ ...base, levelScore: 100 });

    expect(screen.getByText('Overtime Earned')).toBeTruthy();
    expect(screen.queryByText(/\/ 100/), 'a full map still shows a fraction').toBeNull();
  });

  it('never renders a ceiling below the payout', () => {
    // A win premium or a highscore multiplier pays ABOVE the map's ceiling, so
    // the raw numbers would render "140 / 100h" - which reads as a bug in the
    // player's favour and destroys trust in the line. It floors at the payout,
    // which makes it a full map, which drops the fraction entirely.
    renderOverlay({ ...base, levelScore: 140 });

    expect(screen.queryByText(/\/ 100/), 'the ceiling drifted below the payout').toBeNull();
    expect(screen.queryByText(/\/ 140/), 'a full map still shows a fraction').toBeNull();
  });

  it('agrees with the Score row rather than inventing a second denominator', () => {
    // The mutation this catches: computing the Overtime ceiling from the axis
    // ceilings by hand instead of taking the scorer's mapCeiling. It would
    // agree on the fixture that built it and diverge on every real run, and
    // the screen would then carry two fractions claiming different totals.
    renderOverlay(base);
    fireEvent.click(screen.getByText('Score breakdown'));

    expect(screen.getByText('/ 100h'), "the Score row's ceiling moved").toBeTruthy();
    expect(screen.getByText('/ 100'), "the Overtime row's ceiling moved").toBeTruthy();
  });

  it('stays quiet when the scorer gave it no ceiling to report', () => {
    // Old saves and the game-over path carry no mapCeiling. Rendering "56 / 0"
    // - or worse, "0 / 0" - would be a lie; the floor at the payout turns the
    // missing ceiling into a full map and the fraction disappears.
    const { mapCeiling: _drop, ...noCeiling } = base;
    renderOverlay(noCeiling as LevelScoreData);

    expect(screen.getByText('Overtime Earned')).toBeTruthy();
    expect(screen.queryByText(/\s\/\s\d/), 'invented a ceiling from nothing').toBeNull();
  });
});
