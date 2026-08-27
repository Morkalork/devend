/**
 * Carousel — a horizontal strip of cards, one read at a time.
 *
 * WHY THIS EXISTS
 *
 * Every tester said the same thing: too much text. The upgrade shop was the
 * worst of it, and the reason was not that any single card said too much. It
 * was that five cards said their piece simultaneously, in the smallest type in
 * the game, under nine stacked rows of header. Nothing was individually wrong
 * and the whole thing was unreadable.
 *
 * A grid forces that trade: fit N cards across a phone and each one gets a
 * fifth of the width, so the description has to shrink until it fits. A strip
 * does not. One card can take most of the screen, set its description at a size
 * people actually read, and let the other four wait their turn. The total text
 * is unchanged; the text ON SCREEN drops by a factor of five and grows by
 * about a third.
 *
 * WHAT IT COSTS, because this is a real trade and not a free win: a shop is a
 * comparison problem. "Which of these do I want for 80 hours" is harder when
 * you cannot see them side by side. Three things pay that back:
 *
 *   PEEK   the neighbours are visibly half-on-screen, so the strip reads as a
 *          strip. A single centred card reads as the only card, and players
 *          stop looking.
 *   PIPS   one per item, and each one shows whether that item is already
 *          picked. That is the "what have I chosen" readout the grid gave for
 *          free by having everything visible at once, and it is why the pips
 *          take a `marks` array rather than just tracking position.
 *   WIDTH  the strip is sized in viewport units, so a phone shows one card and
 *          a desktop shows three. Nobody is forced to swipe through a list that
 *          would have fitted.
 *
 * Built on CSS scroll-snap rather than a drag library: swipe, trackpad, mouse
 * wheel, keyboard and screen readers all work because it is a real scroll
 * container, and there is no dependency. The scrollport's own inline padding is
 * what lets the first and last cards reach the centre; without it they can only
 * ever sit against an edge.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CarouselProps {
  /** One node per item. Each is wrapped in a snap target of the card width. */
  items: React.ReactNode[];
  /**
   * Per-item "already chosen" flags, rendered into the pips.
   *
   * The point of the pips is not position, it is inventory: which of these have
   * I picked. Losing that was the main thing a strip took away from the grid.
   */
  marks?: boolean[];
  /** Accessible name for the scroll region. */
  label: string;
  prevLabel: string;
  nextLabel: string;
  /** "Offer {{index}} of {{total}}", for the pip buttons' accessible names. */
  positionLabel: (index: number, total: number) => string;
  /** Card width. Viewport-relative so a phone shows one and a desktop shows a few. */
  cardWidth?: string;
  className?: string;
}

export function Carousel({
  items,
  marks = [],
  label,
  prevLabel,
  nextLabel,
  positionLabel,
  cardWidth = 'min(78vw, 340px)',
  className = '',
}: CarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  /**
   * Which card is centred right now.
   *
   * Measured from the scrollport rather than derived from scrollLeft: the cards
   * are a fixed width but the end padding is not, and snap points land where
   * the browser decides. Asking the DOM which child is nearest the middle is
   * both simpler and correct at the ends of the strip, where arithmetic on
   * scrollLeft is off by half a gutter.
   */
  const syncActive = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    const cards = track.querySelectorAll<HTMLElement>('[data-carousel-card]');
    cards.forEach((card, i) => {
      const centre = card.offsetLeft + card.offsetWidth / 2;
      const d = Math.abs(centre - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setActive(best);
  }, []);

  /**
   * Straight onto the scroll event, with no rAF coalescing.
   *
   * The first version guarded with a rAF handle and skipped any scroll while
   * one was pending. That is the standard trick and it is wrong here twice
   * over: scroll already fires at most once a frame, so there is nothing to
   * coalesce; and if a single frame is ever dropped the handle never clears
   * and the pips stop following the strip FOREVER, silently. Reading six
   * offsets during a scroll costs nothing (layout is clean at that point) and
   * `setActive` to the same value does not re-render.
   */

  // The item count changes when the shop restocks; re-measure so the pips and
  // the active index do not describe a strip that no longer exists.
  useEffect(syncActive, [syncActive, items.length]);

  const scrollTo = useCallback((index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelectorAll<HTMLElement>('[data-carousel-card]')[index];
    if (!card) return;
    track.scrollTo({
      left: card.offsetLeft + card.offsetWidth / 2 - track.clientWidth / 2,
      behavior: 'smooth',
    });
  }, []);

  const step = useCallback((delta: number) => {
    scrollTo(Math.max(0, Math.min(items.length - 1, active + delta)));
  }, [scrollTo, active, items.length]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  }, [step]);

  return (
    <div className={`relative w-full flex flex-col items-center gap-3 ${className}`}>
      {/* Arrows sit OUTSIDE the scrollport and are hidden on touch-sized
          screens, where the swipe is the gesture and a chevron over the card
          would just cover it. */}
      <button
        type="button"
        aria-label={prevLabel}
        onClick={() => step(-1)}
        disabled={active === 0}
        className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 items-center justify-center
                   w-9 h-9 rounded-full border border-white/15 bg-black/40 text-foreground/70
                   hover:text-foreground hover:border-white/40 disabled:opacity-20 disabled:pointer-events-none"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        type="button"
        aria-label={nextLabel}
        onClick={() => step(1)}
        disabled={active >= items.length - 1}
        className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 items-center justify-center
                   w-9 h-9 rounded-full border border-white/15 bg-black/40 text-foreground/70
                   hover:text-foreground hover:border-white/40 disabled:opacity-20 disabled:pointer-events-none"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      <div
        ref={trackRef}
        role="group"
        aria-label={label}
        tabIndex={0}
        onScroll={syncActive}
        onKeyDown={onKeyDown}
        // `relative` is load-bearing, not styling: it makes the track the
        // offsetParent of its cards, so `card.offsetLeft` and `scrollLeft` are
        // measured in the SAME coordinate space. Without it offsetLeft is
        // relative to some ancestor outside the scroller and the active card is
        // computed against a number that means something else - the pips simply
        // stop following the scroll.
        className="relative w-full flex gap-4 overflow-x-auto snap-x snap-mandatory
                   focus:outline-none [&::-webkit-scrollbar]:hidden"
        style={{
          scrollbarWidth: 'none',
          // The scrollport's own inline padding is what lets the first and last
          // cards reach the CENTRE. Without it they can only ever rest against
          // an edge, and the strip reads as broken at both ends.
          paddingInline: `max(0px, calc((100% - ${cardWidth}) / 2))`,
          // Snap to the same line the padding centres on, so a keyboard or
          // programmatic scroll lands exactly where a swipe would.
          scrollPaddingInline: `max(0px, calc((100% - ${cardWidth}) / 2))`,
        }}
      >
        {items.map((item, i) => (
          <div
            key={i}
            data-carousel-card
            className="shrink-0 snap-center"
            style={{ width: cardWidth }}
          >
            {item}
          </div>
        ))}
      </div>

      {/* Pips: position AND inventory. A filled ring means that offer is
          already picked, which is the one thing the old grid told you for free
          by showing everything at once. */}
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-2">
          {items.map((_, i) => {
            const picked = marks[i] === true;
            const isActive = i === active;
            return (
              <button
                key={i}
                type="button"
                aria-label={positionLabel(i + 1, items.length)}
                aria-current={isActive ? 'true' : undefined}
                // The card itself carries the selection for a screen reader (a
                // check icon and a ring); this is the at-a-glance shortcut, and
                // an attribute so it can be asserted on.
                data-picked={picked ? 'true' : undefined}
                onClick={() => scrollTo(i)}
                className="p-1 -m-1"
              >
                <span
                  className={`block rounded-full transition-all duration-200
                    ${isActive ? 'w-5 h-2' : 'w-2 h-2'}
                    ${picked
                      ? 'bg-green-400'
                      : isActive ? 'bg-foreground/80' : 'bg-foreground/25'}`}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
