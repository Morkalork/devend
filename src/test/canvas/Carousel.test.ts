/**
 * The canvas offer strip (src/ui/screens/Carousel.tsx), carried over from
 * carousel.test.tsx. The DOM strip asked the browser which card was nearest
 * the scrollport's middle; the canvas strip is an index a drag moves, so the
 * same questions are asked of carouselModel.ts: where am I, where does a
 * released drag land, which offers are picked.
 */
import { describe, it, expect } from "vitest";
import {
  CAROUSEL_GAP, SWIPE_THRESHOLD_PX, canStep, clampIndex, parseCardWidth, pipsFor, releaseIndex, stripOffset,
} from "@/ui/screens/carouselModel";

const CARD_W = 340;
const VIEW = 400;
const PITCH = CARD_W + CAROUSEL_GAP;

describe("the offer strip", () => {
  it("gives every item a pip, so the count is never hidden by the strip", () => {
    expect(pipsFor(5, 0)).toHaveLength(5);
  });

  it("follows the drag, forwards and back, however many times", () => {
    // A drag one card's pitch to the left lands on the next card, and so on.
    let active = 0;
    for (const target of [1, 2, 3, 4, 5, 0, 3]) {
      active = releaseIndex(active, -(target - active) * PITCH, CARD_W, 6);
      expect(active, `stopped following at card ${target}`).toBe(target);
    }
  });

  it("picks the NEAREST card when released between two, on both sides of the midpoint", () => {
    expect(releaseIndex(1, -PITCH * 0.55, CARD_W, 4, CAROUSEL_GAP, Infinity), "past halfway").toBe(2);
    expect(releaseIndex(1, -PITCH * 0.45, CARD_W, 4, CAROUSEL_GAP, Infinity), "short of halfway").toBe(1);
  });

  it("steps one card for a short flick past the threshold, and not for a nudge", () => {
    expect(releaseIndex(1, -(SWIPE_THRESHOLD_PX + 1), CARD_W, 4)).toBe(2);
    expect(releaseIndex(1, SWIPE_THRESHOLD_PX + 1, CARD_W, 4)).toBe(0);
    expect(releaseIndex(1, -(SWIPE_THRESHOLD_PX - 1), CARD_W, 4)).toBe(1);
  });

  it("never drags past the ends", () => {
    expect(releaseIndex(0, PITCH * 3, CARD_W, 4)).toBe(0);
    expect(releaseIndex(3, -PITCH * 3, CARD_W, 4)).toBe(3);
  });

  it("shows which offers are already picked", () => {
    const picked = pipsFor(4, 0, [false, true, false, true]).map((p, i) => (p.picked ? i + 1 : null)).filter(Boolean);
    expect(picked).toEqual([2, 4]);
  });

  it("marks the current offer", () => {
    expect(pipsFor(5, 3).findIndex(p => p.active)).toBe(3);
  });

  it("centres the tapped (or stepped-to) card, the first and last included", () => {
    // The card's centre lands on the view's centre.
    for (const i of [0, 3, 4]) {
      expect(stripOffset(i, CARD_W, VIEW) + i * PITCH + CARD_W / 2).toBe(VIEW / 2);
    }
  });

  it("steps one offer at a time with the arrows and stops at the ends", () => {
    expect(canStep(0, 3, -1)).toBe(false);
    expect(canStep(0, 3, 1)).toBe(true);
    expect(canStep(2, 3, 1)).toBe(false);
    expect(clampIndex(0 + 1, 3)).toBe(1);
  });

  it("drops the pips for a single offer, which has nothing to navigate", () => {
    expect(pipsFor(1, 0)).toEqual([]);
  });

  it("keeps the active card inside a strip that changed length", () => {
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(0, 0)).toBe(0);
  });

  it("reads the card width the shop passes, relative to the screen", () => {
    expect(parseCardWidth("min(76vw, 340px)", 390)).toBeCloseTo(296.4);
    expect(parseCardWidth("min(76vw, 340px)", 1200)).toBe(340);
    expect(parseCardWidth("250px", 390)).toBe(250);
    expect(parseCardWidth("nonsense", 1200)).toBe(340);
    expect(parseCardWidth(undefined, 390)).toBeCloseTo(304.2);
  });
});
