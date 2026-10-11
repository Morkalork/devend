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
 *
 * The outline itself is checked in canvas/BoardPlaceholder.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeBoardRect, VISIBLE_BOARD_FRACTION, BOARD_FRAME_THICKNESS, BOARD_SIZE_PERCENT, BOARD_WIDTH,
} from "@/lib/boardConstants";
import { ARENA_MARGIN } from "@/lib/gameConstants";

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
