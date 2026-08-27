/**
 * The strip that says this map is not playing by normal rules.
 *
 * A mutator changes how a whole map behaves. Technical Gravity bends every path
 * on the board and was reported three times as a malfunction, because its name
 * lived only inside the collapsed Specs panel.
 *
 * The first attempt put a chip in the top bar's stats row, and that was
 * reported straight back: "the technical gravity sign isn't working up there,
 * it has to be clearer, like a warning sign." It was competing with six numbers
 * the player reads constantly, at the same size and weight as all of them. A
 * rule that changes the physics is not a stat, and rendering it as one is what
 * made it disappear.
 *
 * It has its own strip now, between the top bar and the board.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@/i18n';
import { MapRuleBanner } from '@/components/game/MapRuleBanner';
import type { ActiveMapMutator } from '@/types/mapMutator';

const GRAVITY: ActiveMapMutator = {
  id: 'gravity_well',
  name: 'Technical Gravity',
  description: 'Everything is pulled one way, and the way keeps changing.',
  behavior: 'gravity',
};

const CRUNCH: ActiveMapMutator = {
  id: 'crunch', name: 'Crunch', description: 'The board speeds up per lock.', behavior: 'crunch',
};

afterEach(cleanup);

describe('the map rule banner', () => {
  it('names the rule', () => {
    render(<MapRuleBanner mutator={GRAVITY} />);
    expect(screen.getByText('Technical Gravity')).toBeTruthy();
  });

  it('says what the rule DOES, not just what it is called', () => {
    // The name alone is a label. "Everything is pulled one way" is the sentence
    // that stops bent trajectories reading as a bug, which is the whole point.
    render(<MapRuleBanner mutator={GRAVITY} />);
    expect(screen.getByText(/pulled one way/i)).toBeTruthy();
  });

  it('renders nothing at all on an ordinary map', () => {
    // Most maps have no mutator, and a strip that is always there stops meaning
    // anything - and would eat board height for nothing.
    const { container } = render(<MapRuleBanner mutator={null} />);
    expect(container.firstChild, 'the banner takes space with no rule to state').toBeNull();
  });

  it('is a control that leads to the explanation', () => {
    // Naming a thing the player cannot then ask about is half a fix: the
    // hold-to-clarify text lives in the Specs panel.
    const onExplain = vi.fn();
    render(<MapRuleBanner mutator={GRAVITY} onExplain={onExplain} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onExplain).toHaveBeenCalledTimes(1);
  });

  it('is named for a reader who cannot see the colour', () => {
    render(<MapRuleBanner mutator={GRAVITY} />);
    expect(screen.getByRole('button', { name: /map rule/i })).toBeTruthy();
  });

  it('works for any mutator, not just the one that caused the report', () => {
    render(<MapRuleBanner mutator={CRUNCH} />);
    expect(screen.getByText('Crunch')).toBeTruthy();
    expect(screen.getByText(/speeds up per lock/i)).toBeTruthy();
  });
});

describe('where it sits', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

  it('is rendered between the top bar and the board', () => {
    // In the flow, in the slack a square board leaves in a taller frame -
    // not floating over the play surface where it would cover the board.
    const src = read('src/components/game/GameScreen.tsx');
    const bar = src.indexOf('<GameTopBar');
    const banner = src.indexOf('<MapRuleBanner');
    const canvas = src.indexOf('{/* Game Canvas Area */}');
    expect(banner, 'the banner is never rendered').toBeGreaterThan(-1);
    expect(banner, 'the banner is above the top bar').toBeGreaterThan(bar);
    expect(banner, 'the banner is below the board').toBeLessThan(canvas);
  });

  it('is given the map mutator to state', () => {
    // The prop is optional, so a screen that stopped passing it would make the
    // banner silently vanish with nothing else failing.
    const src = read('src/components/game/GameScreen.tsx');
    const i = src.indexOf('<MapRuleBanner');
    expect(src.slice(i, i + 200)).toContain('mutator={mapMutator}');
  });

  it('no longer duplicates itself as a chip in the stats row', () => {
    // Two weak indicators for one thing is worse than one clear one, and the
    // chip was the one that did not work.
    const bar = read('src/components/game/GameTopBar.tsx');
    expect(bar, 'the top bar still renders a mutator chip').not.toContain('mapMutator');
  });
});
