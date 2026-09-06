/**
 * The measured height of GameScreen's fixed bottom stack, in CSS pixels.
 *
 * ── Why this is measured and not a constant ────────────────────────────────
 *
 * The stack is up to five rows deep - fence slots, abilities, the context lane,
 * the push-exit bar, the map's own control row - and the ability row wraps, so
 * its height depends on how many abilities are banked and how wide the phone is.
 * Every attempt to state it as a number has been wrong: 96 put the Playground's
 * ability tester straight across the fence slots, 104 put it across them again,
 * and the board's own 5% bottom band let the stack grow over the bottom of the
 * board, where it swallowed cuts (issue #78).
 *
 * Two callers, one measurement, deliberately: the board reserves this space and
 * the Playground floats its testers above it, and a board and a tester that
 * disagreed about where the bars end would each be right about a different
 * screen.
 */
import { useState, useLayoutEffect } from 'react';

/** Marks the stack. The bar sets it; everything that must clear the bar reads it. */
export const BOTTOM_BARS_SELECTOR = '[data-bottom-bars]';

/**
 * Used until the first real measurement lands, and if the node is not there at
 * all. Generous on purpose: reserving slightly too much costs a little board,
 * while reserving too little costs cuts.
 */
export const BOTTOM_BARS_FALLBACK_PX = 200;

/**
 * @param resetKey re-query the node when this changes (a remount replaces it).
 */
export function useBottomBarsHeight(resetKey?: unknown): number {
  const [height, setHeight] = useState(BOTTOM_BARS_FALLBACK_PX);

  // Layout effect, not a passive one: this decides where the board is drawn, so
  // a measurement that lands after paint is a visible jump on every map start.
  useLayoutEffect(() => {
    const el = document.querySelector(BOTTOM_BARS_SELECTOR);
    if (!(el instanceof HTMLElement)) return;
    const read = () => {
      const h = el.getBoundingClientRect().height;
      // Zero means "cannot measure right now", never "there is no bar". The
      // stack empties itself the instant a map is won (its children unmount
      // while the wrapper stays), and a fresh mount has a frame before layout.
      // Holding the last real height keeps the board still through the win
      // animation instead of dropping it into the space the bars just left.
      if (h > 0) setHeight(h);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;   // jsdom, old webviews
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [resetKey]);

  return height;
}
