/**
 * Measuring the bottom stack, and the two things that read the measurement.
 *
 * The height is a fact the layout already knows, and every copy of it in a
 * constant has been free to be wrong: 96 and 104 each put the Playground's
 * ability tester across the fence slots, and the board's flat 5% bottom band let
 * the stack grow over the board, where it swallowed cuts (issue #78). So there
 * is one measurement and two readers, and the readers must not drift apart.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  useBottomBarsHeight, BOTTOM_BARS_SELECTOR, BOTTOM_BARS_FALLBACK_PX,
} from "@/hooks/useBottomBarsHeight";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** A stand-in for the stack: jsdom lays nothing out, so the rect is stubbed. */
function mountBar(height: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-bottom-bars", "");
  el.getBoundingClientRect = () => ({ height } as DOMRect);
  document.body.appendChild(el);
  return el;
}

/** ResizeObserver does not exist in jsdom; this one can be fired on demand. */
function installResizeObserver(): { fire: () => void } {
  const callbacks: Array<() => void> = [];
  class FakeRO {
    constructor(private cb: () => void) {}
    observe() { callbacks.push(this.cb); }
    disconnect() { callbacks.length = 0; }
  }
  vi.stubGlobal("ResizeObserver", FakeRO);
  return { fire: () => act(() => { for (const cb of [...callbacks]) cb(); }) };
}

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the measurement", () => {
  it("reports the stack's real height", () => {
    mountBar(233);
    const { result } = renderHook(() => useBottomBarsHeight());
    expect(result.current).toBe(233);
  });

  it("falls back rather than reserving nothing when there is no stack", () => {
    // No node at all: an old screen, a test harness, a GameScreen mid-teardown.
    // Reserving nothing would put the board straight back under the bars.
    const { result } = renderHook(() => useBottomBarsHeight());
    expect(result.current).toBe(BOTTOM_BARS_FALLBACK_PX);
    expect(BOTTOM_BARS_FALLBACK_PX).toBeGreaterThan(0);
  });

  it("follows the stack when it grows, so a wrapped ability row is not ignored", () => {
    const el = mountBar(180);
    const ro = installResizeObserver();
    const { result } = renderHook(() => useBottomBarsHeight());
    expect(result.current).toBe(180);
    el.getBoundingClientRect = () => ({ height: 260 } as DOMRect);
    ro.fire();
    expect(result.current).toBe(260);
  });

  it("does NOT give the space back when the stack shrinks", () => {
    // The stack changes size mid-map: the ability row gains a button when a
    // chest grants a new ability, the push-exit bar comes and goes. The board
    // is laid out against this number, and a board that moves while you are
    // drawing a fence is its own bug - so growing is followed (the new row
    // would otherwise land back over the board) and shrinking is not.
    const el = mountBar(240);
    const ro = installResizeObserver();
    const { result } = renderHook(() => useBottomBarsHeight());
    expect(result.current).toBe(240);
    el.getBoundingClientRect = () => ({ height: 150 } as DOMRect);
    ro.fire();
    expect(result.current, "the board was dropped into space the bars want back")
      .toBe(240);
  });

  it("re-measures from scratch when the viewport changes", () => {
    // The one thing that may hand space back. Turning a phone landscape really
    // does un-wrap the ability row, and the board is height-limited there, so
    // holding a portrait reservation would cost real board.
    const el = mountBar(240);
    installResizeObserver();
    const { result } = renderHook(() => useBottomBarsHeight());
    expect(result.current).toBe(240);
    el.getBoundingClientRect = () => ({ height: 120 } as DOMRect);
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(result.current).toBe(120);
  });

  it("can settle BELOW the fallback, which is a starting guess and not a floor", () => {
    // A fallback used as a floor would over-reserve for the whole run on any
    // screen whose stack is genuinely shorter than the guess.
    mountBar(BOTTOM_BARS_FALLBACK_PX - 60);
    const { result } = renderHook(() => useBottomBarsHeight());
    expect(result.current).toBe(BOTTOM_BARS_FALLBACK_PX - 60);
  });

  it("HOLDS its last height when the stack measures zero", () => {
    // The stack empties itself the instant a map is won - its children unmount
    // while the wrapper stays - so a zero reading arrives right as the board is
    // playing its clear animation. Believing it would drop the board into the
    // space the bars just vacated, mid-dissolve. Zero means "cannot measure",
    // never "there is no bar".
    const el = mountBar(210);
    const ro = installResizeObserver();
    const { result } = renderHook(() => useBottomBarsHeight());
    expect(result.current).toBe(210);
    el.getBoundingClientRect = () => ({ height: 0 } as DOMRect);
    ro.fire();
    expect(result.current).toBe(210);
  });

  it("survives a browser with no ResizeObserver, keeping the first read", () => {
    // Old Android WebViews, and jsdom. One measurement is still far better than
    // a guess, so this must degrade rather than throw.
    mountBar(190);
    const { result } = renderHook(() => useBottomBarsHeight());
    expect(result.current).toBe(190);
  });
});

describe("the readers", () => {
  it("both find the stack by the same marker", () => {
    const bar = read("src/components/game/GameScreen.tsx");
    expect(bar).toContain("data-bottom-bars");
    expect(BOTTOM_BARS_SELECTOR).toBe("[data-bottom-bars]");
  });

  it("leaves the Playground no private copy of the height", () => {
    // It had one, and it was wrong twice. A second measurement is a second
    // chance to disagree with the board about where the bars end.
    const src = read("src/components/admin/PlaygroundScreen.tsx");
    expect(src).toContain("from '@/hooks/useBottomBarsHeight'");
    expect(src, "the Playground grew its own measurement again")
      .not.toMatch(/function useBottomBarsHeight/);
  });

  it("hands the board the measured height, not a constant", () => {
    const src = read("src/components/game/GameScreen.tsx");
    expect(src).toMatch(/bottomInsetPx=\{bottomBarsPx\}/);
    expect(src).toMatch(/const bottomBarsPx = useBottomBarsHeight\(\)/);
  });

  it("converts the inset to the pixels computeBoardRect works in", () => {
    // The bar is measured in CSS pixels and the board is laid out in physical
    // ones. Passing the raw number would under-reserve by the whole DPR, which
    // on the reported phone is a factor of three.
    const src = read("src/components/game/GameCanvas.tsx");
    expect(src).toMatch(/computeBoardRect\(physW, physH, bottomInsetRef\.current \* dpr\)/);
  });

  it("re-lays out on a changed inset without restarting the map", () => {
    // The setup effect builds the renderer, the loop and the level. Putting the
    // inset in its dependencies would remount the game every time a bar wrapped.
    const src = read("src/components/game/GameCanvas.tsx");
    expect(src).toMatch(/useEffect\(\(\) => \{ resizeCanvasRef\.current\?\.\(\); \}, \[bottomInsetPx\]\)/);
  });
});
