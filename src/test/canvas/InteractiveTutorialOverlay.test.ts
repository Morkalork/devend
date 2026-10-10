/**
 * The draw-hint hand: its path and its loop, with the DOM overlay's timing.
 */
import { describe, it, expect } from "vitest";
import {
  DRAG_HEIGHT, DRAG_WIDTH, FADE_IN_DURATION, PRESS_DURATION, DRAG_DURATION, RELEASE_DURATION, TOTAL_LOOP_DURATION,
  pressRipple, tutorialAnimState, tutorialDots, tutorialGesture,
} from "@/ui/game/tutorialModel";

const BOARD = { width: 400, height: 400, offsetTop: 50, offsetLeft: 0 };

describe("the tutorial hand", () => {
  it("centres the default swipe's whole span in the board", () => {
    const g = tutorialGesture(BOARD);
    expect((g.startX + g.endX) / 2).toBe(200);
    expect((g.startY + g.endY) / 2).toBe(250);
    expect(g.endX - g.startX).toBe(DRAG_WIDTH);
    expect(g.endY - g.startY).toBe(DRAG_HEIGHT);
  });

  it("traces an aimed gesture when one is given", () => {
    expect(tutorialGesture(BOARD, { fromX: 1, fromY: 2, toX: 3, toY: 4 })).toEqual({ startX: 1, startY: 2, endX: 3, endY: 4 });
  });

  it("fades in, presses, drags, releases and pauses, then loops", () => {
    const g = tutorialGesture(BOARD);
    expect(tutorialAnimState(0, g)).toMatchObject({ phase: "fadeIn", handOpacity: 0 });
    expect(tutorialAnimState(FADE_IN_DURATION + 0.01, g).phase).toBe("press");
    const mid = tutorialAnimState(FADE_IN_DURATION + PRESS_DURATION + DRAG_DURATION / 2, g);
    expect(mid.phase).toBe("drag");
    expect(mid.lineProgress).toBeCloseTo(0.5);
    expect(mid.handX).toBeCloseTo((g.startX + g.endX) / 2);
    const rel = tutorialAnimState(FADE_IN_DURATION + PRESS_DURATION + DRAG_DURATION + 0.01, g);
    expect(rel).toMatchObject({ phase: "release", handX: g.endX, handY: g.endY, lineProgress: 1 });
    const pause = tutorialAnimState(FADE_IN_DURATION + PRESS_DURATION + DRAG_DURATION + RELEASE_DURATION + 0.1, g);
    expect(pause).toMatchObject({ phase: "pause", handOpacity: 0 });
    expect(tutorialAnimState(TOTAL_LOOP_DURATION + 0.01, g).phase).toBe("fadeIn");
  });

  it("swells each guide dot once the hand has passed it", () => {
    const dots = tutorialDots(tutorialGesture(BOARD), 0.5);
    expect(dots).toHaveLength(11);
    expect(dots[5]).toMatchObject({ size: 10, alpha: 1 });
    expect(dots[6]).toMatchObject({ size: 8, alpha: 0.4 });
  });

  it("ripples out from the press and fades", () => {
    expect(pressRipple(0)).toEqual({ scale: 0.5, alpha: 0.8 });
    const end = pressRipple(1);
    expect(end.scale).toBeCloseTo(2);
    expect(end.alpha).toBeCloseTo(0);
  });
});
