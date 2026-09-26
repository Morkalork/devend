/**
 * The board's loading outline, and the board it stands in for.
 *
 * Reported twice. First: "it sometimes takes up to a second, or even two, and
 * it looks weird, even with the Loading label" - so the board's frame is drawn
 * at once while the WebGL renderer loads. Then: "the outline should have the
 * exact same size as the board that then replaces it", and "there is too much
 * space left on the sides of the board".
 *
 * Both of the second pair had the same cause. The board's rectangle covers the
 * whole 900-unit world, but the arena only fills its middle (ARENA_MARGIN on
 * every side) and the frame is drawn just outside the arena. The outline was
 * sized to the world rectangle, so it was larger than the board; and the world
 * rectangle was what got 95% of the screen, so the board itself got about 88%.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@/i18n";
import { BoardPlaceholder, type BoardFrameCss } from "@/components/game/BoardPlaceholder";
import {
  computeBoardRect, VISIBLE_BOARD_FRACTION, BOARD_FRAME_THICKNESS, BOARD_SIZE_PERCENT, BOARD_WIDTH,
} from "@/lib/boardConstants";
import { ARENA_MARGIN } from "@/lib/gameConstants";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const FRAME: BoardFrameCss = { left: 6, top: 40, width: 388, height: 388, frame: 6 };

describe("the loading outline", () => {
  it("sits exactly on the frame the canvas hands it", () => {
    const { getByTestId } = render(<BoardPlaceholder visible accentColor="#00ff88" frame={FRAME} />);
    const el = getByTestId("board-placeholder-frame");
    expect(el.style.left).toBe("6px");
    expect(el.style.top).toBe("40px");
    expect(el.style.width).toBe("388px");
    expect(el.style.height).toBe("388px");
    expect(el.style.borderWidth || el.style.border).toMatch(/6px/);
  });

  it("says it is loading", () => {
    const { getByTestId } = render(<BoardPlaceholder visible accentColor="#00ff88" frame={FRAME} />);
    expect(getByTestId("board-placeholder").textContent).toMatch(/loading/i);
  });

  it("draws nothing until the canvas has been sized", () => {
    const { queryByTestId } = render(<BoardPlaceholder visible accentColor="#00ff88" frame={null} />);
    expect(queryByTestId("board-placeholder")).toBeNull();
  });

  it("fades out, then leaves the page, once the board is up", () => {
    vi.useFakeTimers();
    const { queryByTestId, rerender } = render(<BoardPlaceholder visible accentColor="#00ff88" frame={FRAME} />);
    rerender(<BoardPlaceholder visible={false} accentColor="#00ff88" frame={FRAME} />);
    expect(queryByTestId("board-placeholder")?.className).toMatch(/opacity-0/);
    act(() => { vi.advanceTimersByTime(600); });
    expect(queryByTestId("board-placeholder")).toBeNull();
  });
});

describe("the drawn board's size", () => {
  it("knows how much of the world is actually drawn", () => {
    // Pinned to the constants it is made of, since boardConstants cannot import
    // them: the arena inset on both sides, plus the frame outside it on both.
    const want = (BOARD_WIDTH - 2 * BOARD_WIDTH * ARENA_MARGIN + 2 * BOARD_FRAME_THICKNESS) / BOARD_WIDTH;
    expect(VISIBLE_BOARD_FRACTION).toBeCloseTo(want, 10);
  });

  it("draws the outer wall with the same thickness the outline uses", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/rendering/sleek/wallLayer.ts"), "utf8");
    expect(src).toMatch(/OUTER_WALL_THICKNESS = BOARD_FRAME_THICKNESS;/);
  });

  it("fills nearly the whole width of a portrait phone with the VISIBLE board", () => {
    // A 390x844 phone at dpr 3, physical pixels as GameCanvas passes them.
    const w = 1170, h = 2000;
    const r = computeBoardRect(w, h);
    const visible = r.width * VISIBLE_BOARD_FRACTION;
    expect(visible / w).toBeCloseTo(BOARD_SIZE_PERCENT, 2);
    expect(visible / w).toBeGreaterThan(0.95);
  });
});
