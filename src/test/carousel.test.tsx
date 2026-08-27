/**
 * The strip that replaced the shop's grid.
 *
 * Testers all reported the same thing: too much text. The fix was to stop
 * showing five cards at once and show one big one, which trades simultaneous
 * text for a swipe. That trade only works if the strip tells you where you are
 * and what you have already picked, and BOTH of those are arithmetic over
 * offsets, which is exactly the kind of thing that looks fine and is silently
 * wrong.
 *
 * It was wrong twice while being built, in ways no screenshot would show:
 *
 *   1. `card.offsetLeft` is measured against the offsetParent, and the track
 *      was `position: static`, so the offsets and `scrollLeft` were in
 *      DIFFERENT coordinate spaces. The pips just stopped following.
 *   2. The scroll handler coalesced through requestAnimationFrame with a
 *      "already pending" guard. Drop one frame and the handle never clears and
 *      the pips stop following forever.
 *
 * Both produce a strip that looks perfect in a still frame, so these tests
 * drive the scroll directly. jsdom has no layout, so the geometry is stubbed:
 * that is the point, since the geometry is what is being asserted about.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Carousel } from '@/components/game/Carousel';

afterEach(cleanup);

const CARD_W = 340;
const GAP = 16;
const VIEW = 400;
/** Where card `i` sits in the track's scroll space, matching the real layout. */
const PAD = (VIEW - CARD_W) / 2;
const offsetOf = (i: number) => PAD + i * (CARD_W + GAP);

function mount(count: number, marks?: boolean[]) {
  const items = Array.from({ length: count }, (_, i) => <div key={i}>card {i}</div>);
  const view = render(
    <Carousel
      items={items}
      marks={marks}
      label="offers"
      prevLabel="prev"
      nextLabel="next"
      positionLabel={(index, total) => `Offer ${index} of ${total}`}
    />,
  );

  const track = screen.getByRole('group', { name: 'offers' });
  // jsdom lays nothing out, so give the strip the geometry a browser would.
  Object.defineProperty(track, 'clientWidth', { value: VIEW, configurable: true });
  let scrollLeft = 0;
  Object.defineProperty(track, 'scrollLeft', {
    get: () => scrollLeft,
    set: (v: number) => { scrollLeft = v; },
    configurable: true,
  });
  track.querySelectorAll<HTMLElement>('[data-carousel-card]').forEach((card, i) => {
    Object.defineProperty(card, 'offsetLeft', { value: offsetOf(i), configurable: true });
    Object.defineProperty(card, 'offsetWidth', { value: CARD_W, configurable: true });
  });

  /** Scroll as a browser would: move the position, then fire the event. */
  const scrollToCard = (i: number) => {
    track.scrollLeft = offsetOf(i) + CARD_W / 2 - VIEW / 2;
    fireEvent.scroll(track);
  };
  return { view, track, scrollToCard };
}

const currentPip = () =>
  screen.getAllByRole('button')
    .find(b => b.getAttribute('aria-current') === 'true')
    ?.getAttribute('aria-label');

describe('the offer strip', () => {
  it('gives every item a pip, so the count is never hidden by the scroll', () => {
    // A strip that shows one card has to say how many there are, or a player
    // who does not swipe never learns the other four exist.
    mount(5);
    expect(screen.getByLabelText('Offer 1 of 5')).toBeTruthy();
    expect(screen.getByLabelText('Offer 5 of 5')).toBeTruthy();
    expect(screen.queryByLabelText('Offer 6 of 5')).toBeNull();
  });

  it('keeps the track as the offsetParent of its cards', () => {
    // The stubs in this file hand the cards their offsets directly, so the
    // arithmetic tests below would pass even with the CSS bug that broke this
    // for real: `offsetLeft` is measured against the offsetParent, and a
    // static track puts the cards' offsets in a different space from
    // `scrollLeft`. `relative` is the whole fix, and nothing else in this file
    // can see it, so it is pinned here explicitly.
    const { track } = mount(3);
    expect(track.className.split(/\s+/), 'the track is no longer the offsetParent')
      .toContain('relative');
  });

  it('follows the scroll', () => {
    // THE regression. Both bugs above pass every static check and leave the
    // pips frozen on the first item while the strip scrolls underneath.
    const { scrollToCard } = mount(5);
    expect(currentPip()).toBe('Offer 1 of 5');

    scrollToCard(3);
    expect(currentPip(), 'the pips stopped following the strip').toBe('Offer 4 of 5');

    scrollToCard(1);
    expect(currentPip(), 'the pips only follow forwards').toBe('Offer 2 of 5');
  });

  it('keeps following after many scrolls, not just the first', () => {
    // The rAF version passed the test above and failed this one: its guard
    // cleared once and then jammed. A single scroll is not evidence.
    const { scrollToCard } = mount(6);
    for (const i of [1, 2, 3, 4, 5, 0, 3]) {
      scrollToCard(i);
      expect(currentPip(), `stopped following at card ${i}`).toBe(`Offer ${i + 1} of 6`);
    }
  });

  it('picks the NEAREST card when the strip is resting between two', () => {
    // Snap points are the browser's business and a drag can be released
    // anywhere, so the readout has to round rather than pick a side. It has to
    // be checked on BOTH sides of the midpoint: "first card past the middle"
    // gives the same answer as "nearest" for everything past halfway, so a
    // test that only looks there cannot tell the two apart, and the first
    // version of this one could not.
    const { track } = mount(4);
    const rest = (from: number, fraction: number) => {
      track.scrollLeft = offsetOf(from) + (CARD_W + GAP) * fraction + CARD_W / 2 - VIEW / 2;
      fireEvent.scroll(track);
    };

    rest(1, 0.55);
    expect(currentPip(), 'past the midpoint it should read as the next card').toBe('Offer 3 of 4');

    rest(1, 0.45);
    expect(currentPip(), 'short of the midpoint it jumped ahead anyway').toBe('Offer 2 of 4');
  });

  it('shows which offers are already picked', () => {
    // The one thing a grid gave for free by showing everything at once. Without
    // it a player mid-strip cannot tell what they have already spent on.
    mount(4, [false, true, false, true]);
    const picked = screen.getAllByRole('button')
      .filter(b => b.getAttribute('data-picked') === 'true')
      .map(b => b.getAttribute('aria-label'));
    expect(picked).toEqual(['Offer 2 of 4', 'Offer 4 of 4']);
  });

  it('jumps to an offer when its pip is tapped', () => {
    const { track } = mount(5);
    const scrollTo = vi.fn();
    track.scrollTo = scrollTo as unknown as typeof track.scrollTo;

    fireEvent.click(screen.getByLabelText('Offer 4 of 5'));
    expect(scrollTo).toHaveBeenCalledWith({
      left: offsetOf(3) + CARD_W / 2 - VIEW / 2,
      behavior: 'smooth',
    });
  });

  it('steps one offer at a time with the arrows and stops at the ends', () => {
    const { track } = mount(3);
    const scrollTo = vi.fn();
    track.scrollTo = scrollTo as unknown as typeof track.scrollTo;

    // At the first offer there is nowhere left to go.
    expect((screen.getByLabelText('prev') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('next'));
    expect(scrollTo).toHaveBeenCalledWith({
      left: offsetOf(1) + CARD_W / 2 - VIEW / 2,
      behavior: 'smooth',
    });
  });

  it('drops the pips for a single offer, which has nothing to navigate', () => {
    mount(1);
    expect(screen.queryByLabelText('Offer 1 of 1')).toBeNull();
  });
});
