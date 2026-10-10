/**
 * The canvas TutorialOverlay's spotlight geometry (src/ui/game/TutorialOverlayModel.ts):
 * the scrim leaves the top or bottom strip clear and darkens everything else,
 * and the arrow points at the strip.
 */
import { describe, it, expect } from "vitest";
import {
  SCRIM_ALPHA, arrowBob, arrowShape, scrimBands, spotlightHole, spotlightSeparator, tutorialCardWidth, tutorialSpotlight,
} from "@/ui/game/TutorialOverlayModel";

const SCREEN = { width: 400, height: 800 };

/** How dark the scrim is at a row (the darkest band covering it). */
const darkAt = (bands: ReturnType<typeof scrimBands>, y: number) =>
  Math.max(0, ...bands.filter(b => y >= b.y && y < b.y + b.h).map(b => b.alpha));

describe("the tutorial spotlight", () => {
  it("has no hole without an area or a height", () => {
    expect(tutorialSpotlight(undefined, 120, "none").hasSpotlight).toBe(false);
    expect(tutorialSpotlight("top", 0, "none").hasSpotlight).toBe(false);
    expect(scrimBands(SCREEN, undefined, 0)).toEqual([{ x: 0, y: 0, w: 400, h: 800, alpha: SCRIM_ALPHA }]);
  });

  it("points the arrow at the hole", () => {
    expect(tutorialSpotlight("top", 100, "down").isArrowUp).toBe(true);
    expect(tutorialSpotlight("bottom", 100, "up").isArrowUp).toBe(false);
    // Without a spotlight the direction prop decides, as in the DOM.
    expect(tutorialSpotlight(undefined, 0, "up").isArrowUp).toBe(true);
  });

  it("leaves the top strip clear and darkens the rest", () => {
    const bands = scrimBands(SCREEN, "top", 100);
    expect(darkAt(bands, 0)).toBe(0);
    expect(darkAt(bands, 99)).toBe(0);
    expect(darkAt(bands, 100)).toBeGreaterThan(0);
    expect(darkAt(bands, 100)).toBeLessThan(SCRIM_ALPHA);
    expect(darkAt(bands, 104)).toBe(SCRIM_ALPHA);
    expect(darkAt(bands, 799)).toBe(SCRIM_ALPHA);
  });

  it("leaves the bottom strip clear and darkens the rest", () => {
    const bands = scrimBands(SCREEN, "bottom", 150);
    expect(darkAt(bands, 0)).toBe(SCRIM_ALPHA);
    expect(darkAt(bands, 645)).toBe(SCRIM_ALPHA);
    expect(darkAt(bands, 649)).toBeGreaterThan(0);
    expect(darkAt(bands, 650)).toBe(0);
    expect(darkAt(bands, 799)).toBe(0);
  });

  it("frames the hole and puts the separator on the scrim side of its edge", () => {
    expect(spotlightHole(SCREEN, "top", 100)).toEqual({ x: 0, y: 0, w: 400, h: 100 });
    expect(spotlightHole(SCREEN, "bottom", 100)).toEqual({ x: 0, y: 700, w: 400, h: 100 });
    expect(spotlightSeparator(SCREEN, "top", 100)).toEqual({ x: 0, y: 100, w: 400, h: 3 });
    expect(spotlightSeparator(SCREEN, "bottom", 100)).toEqual({ x: 0, y: 697, w: 400, h: 3 });
  });

  it("bobs the arrow toward the hole", () => {
    expect(arrowBob(1, true)).toBe(-14);
    expect(arrowBob(1, false)).toBe(14);
    expect(arrowBob(0, true)).toBe(-0);
    // The head is at the end nearest the hole.
    expect(arrowShape(true).head[1]).toBe(0);
    expect(arrowShape(false).head[1]).toBe(220);
  });

  it("caps the card at max-w-md inside the side padding", () => {
    expect(tutorialCardWidth(1000)).toBe(448);
    expect(tutorialCardWidth(360)).toBe(312);
  });
});
