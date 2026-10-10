/**
 * The offer strip's arithmetic (canvas port of components/game/Carousel.tsx).
 *
 * On the DOM the browser's scroll-snap owned the position and the component
 * asked which card was nearest the middle. On the canvas there is no scroller:
 * the strip IS an index, and a drag moves it. The questions are the same -
 * which card is centred, where does a released drag land, which pips are
 * picked - so they are answered here, once, where they can be tested.
 */

/** Space between cards (Tailwind gap-4). */
export const CAROUSEL_GAP = 16;
/** A horizontal drag further than this steps the strip even if it ends short of halfway. */
export const SWIPE_THRESHOLD_PX = 40;
/** The DOM's default card width. */
export const DEFAULT_CARD_WIDTH = "min(78vw, 340px)";

/**
 * A card width spec as px. Accepts the forms the DOM passed as CSS:
 * `Npx`, `Nvw`, and `min(a, b)` of those; anything else falls back to the
 * default. Never wider than the screen.
 */
export function parseCardWidth(spec: string | undefined, screenWidth: number): number {
  const one = (s: string): number | null => {
    const m = /^\s*([\d.]+)\s*(px|vw)\s*$/.exec(s);
    if (!m) return null;
    const n = Number.parseFloat(m[1]);
    return m[2] === "vw" ? (n / 100) * screenWidth : n;
  };
  const read = (s: string): number | null => {
    const min = /^\s*min\((.*)\)\s*$/.exec(s);
    if (min) {
      const parts = min[1].split(",").map(one);
      if (parts.some(p => p === null)) return null;
      return Math.min(...(parts as number[]));
    }
    return one(s);
  };
  const w = read(spec ?? DEFAULT_CARD_WIDTH) ?? read(DEFAULT_CARD_WIDTH)!;
  return Math.max(1, Math.min(w, screenWidth));
}

export function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(Math.max(0, count - 1), index));
}

/**
 * The strip's x translation that centres card `index` in a view `viewWidth`
 * wide. The DOM got the same effect from padding the scrollport by
 * (100% - card) / 2, which is what lets the first and last cards reach the
 * CENTRE rather than resting against an edge.
 */
export function stripOffset(index: number, cardWidth: number, viewWidth: number, gap = CAROUSEL_GAP): number {
  return viewWidth / 2 - (index * (cardWidth + gap) + cardWidth / 2);
}

/**
 * Which card a released drag lands on. The NEAREST card to the middle, so a
 * drag released past halfway reads as the next card and one short of it does
 * not; and a quick flick past the threshold still steps one, because a swipe
 * that moves nothing reads as a broken strip.
 *
 * `dx` is the finger's travel: dragging left (negative) moves toward later cards.
 */
export function releaseIndex(
  active: number,
  dx: number,
  cardWidth: number,
  count: number,
  gap = CAROUSEL_GAP,
  threshold = SWIPE_THRESHOLD_PX,
): number {
  let next = Math.round(active - dx / (cardWidth + gap));
  if (next === active && Math.abs(dx) > threshold) next = active - Math.sign(dx);
  return clampIndex(next, count);
}

export interface Pip {
  /** That item is already chosen: the pips are inventory, not just position. */
  picked: boolean;
  active: boolean;
}

/** One pip per item, or none for a single item, which has nothing to navigate. */
export function pipsFor(count: number, active: number, marks: boolean[] = []): Pip[] {
  if (count <= 1) return [];
  return Array.from({ length: count }, (_, i) => ({ picked: marks[i] === true, active: i === active }));
}

/** The step buttons are disabled at the ends. */
export function canStep(active: number, count: number, delta: -1 | 1): boolean {
  return delta < 0 ? active > 0 : active < count - 1;
}
