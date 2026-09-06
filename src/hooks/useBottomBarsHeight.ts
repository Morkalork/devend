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
 *
 * ── Why it only ever grows ─────────────────────────────────────────────────
 *
 * The reported height is the DEEPEST the stack has been, not its height right
 * now, because the board is laid out against it and a board that moves while
 * you are drawing a fence is its own bug. The stack genuinely changes size mid-
 * map: the ability row gains a button when a chest grants a new ability, and the
 * push-exit bar appears when there is a push to bank. Growing has to be followed
 * or the new row lands back over the board; shrinking does not, and following it
 * would drop the board down into space it is about to want back.
 *
 * This is the same argument the context lane already makes for itself in
 * GameScreen ("the wrapper reserves its height whether or not a lane is using
 * it, which is the part that stops the shifting"), applied to the stack as a
 * whole.
 *
 * A viewport resize is the one thing that re-measures from scratch: turning a
 * phone landscape genuinely un-wraps the ability row, and there the board is
 * height-limited, so holding a portrait reservation would cost real board.
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
  // null, not the fallback, so the first real measurement can be SMALLER than
  // the fallback. A fallback used as a floor would over-reserve for the whole
  // run on any screen whose stack is shorter than the guess.
  const [height, setHeight] = useState<number | null>(null);

  // Layout effect, not a passive one: this decides where the board is drawn, so
  // a measurement that lands after paint is a visible jump on every map start.
  useLayoutEffect(() => {
    const el = document.querySelector(BOTTOM_BARS_SELECTOR);
    if (!(el instanceof HTMLElement)) return;

    let deepest = 0;
    const read = () => {
      const h = el.getBoundingClientRect().height;
      // Zero means "cannot measure right now", never "there is no bar". The
      // stack empties itself the instant a map is won (its children unmount
      // while the wrapper stays), and a fresh mount has a frame before layout.
      if (h <= 0) return;
      // Grow only. See the header.
      if (h <= deepest) return;
      deepest = h;
      setHeight(h);
    };
    // The one event that may hand space back: the stack's height is allowed to
    // fall when the viewport it is laid out in changes.
    const remeasure = () => { deepest = 0; read(); };

    read();
    window.addEventListener('resize', remeasure);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {   // absent in jsdom, old webviews
      ro = new ResizeObserver(read);
      ro.observe(el);
    }
    return () => {
      window.removeEventListener('resize', remeasure);
      ro?.disconnect();
    };
  }, [resetKey]);

  return height ?? BOTTOM_BARS_FALLBACK_PX;
}
