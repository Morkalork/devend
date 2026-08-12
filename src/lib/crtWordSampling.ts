/**
 * Picking a visible word out of the scrolling CRT background text.
 *
 * The background highlights one declaration every 8-14 seconds. Finding it used
 * to mean measuring EVERY declaration in EVERY <pre> - about 160
 * Range.getBoundingClientRect() calls in a single synchronous loop, each
 * resolving a character offset to a rect inside a very large text node - and then
 * discarding all but one result. On a phone that was the heaviest piece of
 * JavaScript in the game and the long-task source behind a periodic stutter, on
 * exactly this cadence.
 *
 * One visible word is all anyone needs, so this probes at random and stops early.
 * The measurement count is bounded by PROBE_LIMIT regardless of how much text
 * there is, which is the property the tests pin: the old loop's cost grew with
 * the size of the code block, and this one does not.
 *
 * Measurement is injected rather than done here so the bound can be asserted
 * without a layout engine - jsdom returns zero-sized rects, so a test going
 * through the real Range API would measure nothing and prove nothing.
 */

export interface WordPos {
  charOffset: number;
  length: number;
}

/** A word's box, relative to the code container rather than the viewport. */
export interface SampledWord {
  absX: number;
  absY: number;
  width: number;
  height: number;
}

/** Just the parts of a DOMRect this needs, so tests need not build a real one. */
export interface MeasuredRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** Rect measurements per highlight. The old loop did roughly 160. */
export const PROBE_LIMIT = 24;

/** Stop once there are this many to choose between; more adds nothing visible. */
export const ENOUGH_CANDIDATES = 5;

export interface SampleOptions {
  /** The text node of each <pre> in the layer (original plus seamless-loop clone). */
  textNodes: Node[];
  wordPositions: WordPos[];
  containerLeft: number;
  containerTop: number;
  viewportHeight: number;
  /** Returns null when the offset does not resolve in that node. */
  measure: (node: Node, charOffset: number, length: number) => MeasuredRect | null;
  /** Injectable for deterministic tests. */
  rand?: () => number;
  probeLimit?: number;
  enough?: number;
}

export function sampleVisibleWords(opts: SampleOptions): SampledWord[] {
  const {
    textNodes, wordPositions, containerLeft, containerTop, viewportHeight, measure,
    rand = Math.random, probeLimit = PROBE_LIMIT, enough = ENOUGH_CANDIDATES,
  } = opts;

  const found: SampledWord[] = [];
  if (textNodes.length === 0 || wordPositions.length === 0) return found;

  for (let probe = 0; probe < probeLimit && found.length < enough; probe++) {
    const node = textNodes[(rand() * textNodes.length) | 0];
    const word = wordPositions[(rand() * wordPositions.length) | 0];
    if (!node || !word) continue;

    const rect = measure(node, word.charOffset, word.length);
    if (!rect) continue;

    // Fully on screen, with a margin: a callout is drawn beside the word, and one
    // anchored to a half-scrolled word points at nothing.
    const visible =
      rect.top >= viewportHeight * 0.25 && rect.bottom <= viewportHeight - 20 && rect.width > 0;
    if (!visible) continue;

    found.push({
      absX: rect.left - containerLeft,
      absY: rect.top - containerTop,
      width: rect.width,
      height: rect.height,
    });
  }

  return found;
}
