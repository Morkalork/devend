/**
 * The map's rule, named where the player can see it.
 *
 * A mutator changes how the whole map behaves, and its name lived only inside
 * the Specs panel, which is shut by default. Technical Gravity bends every path
 * on the board; with nothing on screen naming it, it was reported three times
 * as a malfunction ("the gravity has gone bananas").
 *
 * The board cue built alongside this says WHAT is happening. The chip says what
 * it is CALLED, and opens the panel that explains it, which is the part a cue
 * cannot do.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@/i18n';
import { GameTopBar } from '@/components/game/GameTopBar';
import type { ActiveMapMutator } from '@/types/mapMutator';

const GRAVITY: ActiveMapMutator = {
  id: 'gravity_well',
  name: 'Technical Gravity',
  description: 'Everything is pulled one way, and the way keeps changing.',
  behavior: 'gravity',
};

const CRUNCH: ActiveMapMutator = {
  id: 'crunch', name: 'Crunch', description: 'd', behavior: 'crunch',
};

function bar(over: Partial<React.ComponentProps<typeof GameTopBar>> = {}) {
  return render(
    <GameTopBar
      levelNumber={16}
      cutsUsed={0}
      parCuts={8}
      lives={3}
      spaceRemaining={89}
      spaceRequired={11}
      lockedBalls={0}
      {...over}
    />,
  );
}

afterEach(cleanup);

describe('the mutator chip', () => {
  it('names the rule the map is playing by', () => {
    bar({ mapMutator: GRAVITY });
    expect(screen.getByText('Technical Gravity')).toBeTruthy();
  });

  it('is absent on an ordinary map', () => {
    // Most maps have no mutator, and a chip that is always there stops meaning
    // anything.
    bar({});
    expect(screen.queryByText('Technical Gravity')).toBeNull();
  });

  it('is a real control, not a coloured label', () => {
    // The row it sits in already opens the Specs panel on tap, so asserting
    // that a click reaches onExpand proves nothing about the chip: a mutation
    // removing its handler entirely left that test green. What is actually
    // this component's job is making the chip a BUTTON - focusable, and named
    // for a reader who cannot see that it is violet.
    bar({ mapMutator: GRAVITY });
    const chip = screen.getByRole('button', { name: /map rule/i });
    expect(chip.textContent).toContain('Technical Gravity');
  });

  it('reaches the Specs panel when activated', () => {
    // The behaviour the player depends on, however it is delivered: today by
    // bubbling to the row's own handler.
    const onExpand = vi.fn();
    bar({ mapMutator: GRAVITY, onExpand });
    fireEvent.click(screen.getByRole('button', { name: /map rule/i }));
    expect(onExpand, 'activating the chip explains nothing').toHaveBeenCalled();
  });

  it('works for any mutator, not just the one that caused the report', () => {
    bar({ mapMutator: CRUNCH });
    expect(screen.getByText('Crunch')).toBeTruthy();
  });

  it('says what it is in its label, for a reader who cannot see colour', () => {
    bar({ mapMutator: GRAVITY });
    expect(screen.getByLabelText(/map rule/i)).toBeTruthy();
  });
});

describe('the screen actually supplies it', () => {
  it('passes the map mutator down to the bar', () => {
    // The prop is optional, so a screen that stops passing it makes the chip
    // silently vanish and nothing else fails. This is the guard for that.
    const src = readFileSync(resolve(process.cwd(), 'src/components/game/GameScreen.tsx'), 'utf8');
    const i = src.indexOf('<GameTopBar');
    expect(i, 'the top bar is gone').toBeGreaterThan(-1);
    expect(
      src.slice(i, i + 900),
      'GameScreen renders the bar without telling it the map rule',
    ).toContain('mapMutator={mapMutator}');
  });
});
