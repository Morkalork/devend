/**
 * The CRT background's word sampling.
 *
 * Field report: "the dips happen every 3 or 4 seconds" with no cutting. Measured
 * on the device as JavaScript long tasks - 14 in a minute, worst 97ms, one
 * landing 12.9ms before a 166ms frame - and traced to the background's word
 * highlighter, which measured every declaration in every <pre> (~160
 * Range.getBoundingClientRect() calls, each resolving a character offset inside a
 * very large text node) and then used exactly one of the results.
 *
 * The property that matters is therefore a BOUND on measurements, independent of
 * how much text is on screen. That is what these tests pin; the old loop would
 * fail every one of them.
 */
import { describe, it, expect, vi } from "vitest";
import {
  sampleVisibleWords,
  PROBE_LIMIT,
  type WordPos,
  type MeasuredRect,
} from "@/lib/crtWordSampling";

const VH = 1000;

/** Sequential values, so probing is deterministic instead of random. */
const cyclingRand = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

const words = (n: number): WordPos[] =>
  Array.from({ length: n }, (_, i) => ({ charOffset: i * 10, length: 5 }));

/** A rect comfortably inside the visible band (top >= 25% vh, bottom <= vh-20). */
const visibleRect = (): MeasuredRect => ({ left: 200, top: 500, bottom: 520, width: 40, height: 20 });

/** Above the band: the highlighter skips these. */
const offscreenRect = (): MeasuredRect => ({ left: 200, top: 10, bottom: 30, width: 40, height: 20 });

const node = () => ({}) as unknown as Node;

const base = (over: Partial<Parameters<typeof sampleVisibleWords>[0]> = {}) => ({
  textNodes: [node(), node()],
  wordPositions: words(80),
  containerLeft: 0,
  containerTop: 0,
  viewportHeight: VH,
  measure: () => visibleRect(),
  rand: cyclingRand([0.1, 0.3, 0.5, 0.7, 0.9]),
  ...over,
});

describe("measurement is bounded", () => {
  /**
   * The regression. 80 declarations across 2 text nodes is 160 measurements in
   * the old loop; the cost must not scale with the text at all.
   */
  it("never measures more than the probe limit, however much text there is", () => {
    const measure = vi.fn(() => offscreenRect()); // worst case: nothing visible
    sampleVisibleWords(base({ measure, wordPositions: words(500) }));
    expect(measure.mock.calls.length).toBeLessThanOrEqual(PROBE_LIMIT);
  });

  it("costs the same for a huge code block as a small one", () => {
    const small = vi.fn(() => offscreenRect());
    const huge = vi.fn(() => offscreenRect());
    sampleVisibleWords(base({ measure: small, wordPositions: words(20) }));
    sampleVisibleWords(base({ measure: huge, wordPositions: words(2000) }));
    expect(huge.mock.calls.length).toBe(small.mock.calls.length);
  });

  /**
   * Guards against the bound passing for the wrong reason - if the loop stopped
   * for some other cause, raising the limit would change nothing and the test
   * above would be vacuous.
   */
  it("is the probe limit doing the limiting", () => {
    const measure = vi.fn(() => offscreenRect());
    sampleVisibleWords(base({ measure, wordPositions: words(500), probeLimit: 100 }));
    expect(measure.mock.calls.length).toBe(100);
  });

  it("stops early once it has enough to choose between", () => {
    const measure = vi.fn(() => visibleRect());
    const found = sampleVisibleWords(base({ measure }));
    // Everything is visible here, so it should bail well before the limit.
    expect(measure.mock.calls.length).toBeLessThan(PROBE_LIMIT);
    expect(found.length).toBeGreaterThan(0);
  });
});

describe("what counts as a usable word", () => {
  it("rejects words above the visible band", () => {
    expect(sampleVisibleWords(base({ measure: () => offscreenRect() }))).toEqual([]);
  });

  it("rejects words running past the bottom margin", () => {
    const belowMargin = (): MeasuredRect => ({ left: 0, top: 900, bottom: VH - 5, width: 40, height: 20 });
    expect(sampleVisibleWords(base({ measure: () => belowMargin() }))).toEqual([]);
  });

  // A zero-width rect means the offset did not resolve to a laid-out box; a
  // callout anchored there points at nothing.
  it("rejects a zero-width measurement", () => {
    const zero = (): MeasuredRect => ({ left: 200, top: 500, bottom: 520, width: 0, height: 20 });
    expect(sampleVisibleWords(base({ measure: () => zero() }))).toEqual([]);
  });

  it("skips an offset the node cannot resolve rather than throwing", () => {
    expect(() => sampleVisibleWords(base({ measure: () => null }))).not.toThrow();
    expect(sampleVisibleWords(base({ measure: () => null }))).toEqual([]);
  });
});

describe("coordinates", () => {
  // The highlight is positioned inside the code container, not the viewport, so
  // an un-subtracted container offset would draw the box in the wrong place.
  it("returns positions relative to the container, not the viewport", () => {
    const found = sampleVisibleWords(base({ containerLeft: 50, containerTop: 100 }));
    expect(found[0]).toEqual({ absX: 150, absY: 400, width: 40, height: 20 });
  });
});

describe("degenerate input", () => {
  it("returns nothing when there is no text node yet", () => {
    const measure = vi.fn(() => visibleRect());
    expect(sampleVisibleWords(base({ textNodes: [], measure }))).toEqual([]);
    expect(measure).not.toHaveBeenCalled();
  });

  it("returns nothing when no declarations were parsed", () => {
    expect(sampleVisibleWords(base({ wordPositions: [] }))).toEqual([]);
  });
});
