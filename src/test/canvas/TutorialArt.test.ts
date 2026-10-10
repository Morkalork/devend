/**
 * The canvas TutorialArt drawings (src/ui/game/TutorialArtDraw.ts): each draws
 * without throwing, and the board helpers clip the way the SVG's clipPath did.
 */
import { describe, it, expect } from "vitest";
import { Graphics } from "pixi.js";
import {
  ART_BOARD, drawBreakArt, drawCircuitArt, drawFenceArt, drawLockArt, drawLockedBallArt, drawMoverArt,
  drawPickupArt, insideRounded,
} from "@/ui/game/TutorialArtDraw";

describe("the tutorial art", () => {
  it.each([
    ["fence", drawFenceArt], ["lock", drawLockArt], ["mover", drawMoverArt], ["break", drawBreakArt],
    ["pickup", drawPickupArt], ["circuit", drawCircuitArt],
    // jsdom has no 2D canvas to build the gradient texture with: a flat fill stands in.
    ["locked ball", (g: Graphics) => drawLockedBallArt(g, 0xff5a52)],
  ] as const)("draws the %s picture inside its box", (_name, draw) => {
    const g = new Graphics();
    expect(() => draw(g)).not.toThrow();
    const b = g.getLocalBounds();
    // Nothing runs off the 152x134 box (the larger of the two picture sizes).
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(152);
    expect(b.maxY).toBeLessThanOrEqual(134);
    g.destroy();
  });

  it("clips the dot grid to the rounded board", () => {
    expect(insideRounded(ART_BOARD, 75, 60)).toBe(true);
    // The very corner of the bounding rect is outside the rounded corner.
    expect(insideRounded(ART_BOARD, 7, 7)).toBe(false);
    expect(insideRounded(ART_BOARD, 3, 60)).toBe(false);
  });
});
