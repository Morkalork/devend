/**
 * The board's placeholder: drawn the instant the game screen opens, in exactly
 * the rectangle the real board will fill, and gone once the board is up.
 *
 * Reported as "it sometimes takes up to a second, or even two, and it looks
 * weird, even with the Loading label": the renderer is a lazily loaded WebGL
 * chunk, so the first map can be a blank frame for that long on a phone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import "@/i18n";
import { BoardPlaceholder } from "@/components/game/BoardPlaceholder";
import { computeBoardRect } from "@/lib/boardConstants";

const SURFACE = { width: 400, height: 700 };

beforeEach(() => {
  // jsdom has no layout and no ResizeObserver; give the canvas area a size.
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    ...SURFACE, x: 0, y: 0, top: 0, left: 0, right: SURFACE.width, bottom: SURFACE.height, toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the board placeholder", () => {
  it("sits exactly where the real board will be drawn", () => {
    const { getByTestId } = render(<BoardPlaceholder visible accentColor="#00ff88" bottomInsetPx={120} />);
    const frame = getByTestId("board-placeholder").firstElementChild as HTMLElement;
    const want = computeBoardRect(SURFACE.width, SURFACE.height, 120);
    expect(frame.style.left).toBe(`${want.left}px`);
    expect(frame.style.top).toBe(`${want.top}px`);
    expect(frame.style.width).toBe(`${want.width}px`);
    expect(frame.style.height).toBe(`${want.height}px`);
  });

  it("says it is loading", () => {
    const { getByTestId } = render(<BoardPlaceholder visible accentColor="#00ff88" bottomInsetPx={0} />);
    expect(getByTestId("board-placeholder").textContent).toMatch(/loading/i);
  });

  it("fades out, then leaves the page, once the board is up", () => {
    vi.useFakeTimers();
    const { queryByTestId, rerender } = render(<BoardPlaceholder visible accentColor="#00ff88" bottomInsetPx={0} />);
    rerender(<BoardPlaceholder visible={false} accentColor="#00ff88" bottomInsetPx={0} />);
    expect(queryByTestId("board-placeholder")?.className).toMatch(/opacity-0/);
    act(() => { vi.advanceTimersByTime(600); });
    expect(queryByTestId("board-placeholder")).toBeNull();
  });
});
