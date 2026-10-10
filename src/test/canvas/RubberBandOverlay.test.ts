/**
 * The Rubber Band's drag on the canvas (carried over from
 * rubberBandOverlay.test.tsx): what a release does, the world-unit reading of
 * the pointer, the live catch, and the tutorial hand's one-time flag.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import i18n from "@/i18n";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import {
  BAND_TUTORIAL_KEY, bandCatches, bandColour, bandRelease, bandTutorialSeen, containerToWorld,
  markBandTutorialSeen, worldToContainer, type BandTarget, type BoardBox,
} from "@/ui/game/rubberBandModel";
import { bandShape, type BandShape } from "@/lib/rubberBand";

// 1:1 with the board, so container pixels ARE world units and a wrong
// conversion shows up as a wrong number rather than a wrong scale.
const ONE_TO_ONE: BoardBox = { canvasWidth: BOARD_WIDTH, canvasHeight: BOARD_HEIGHT, canvasOffsetTop: 0, canvasOffsetLeft: 0 };

function release(box: BoardBox, from: [number, number], to: [number, number]) {
  const start = containerToWorld(box, { x: from[0], y: from[1] });
  return bandRelease(start, containerToWorld(box, { x: to[0], y: to[1] }));
}

beforeEach(() => localStorage.clear());

describe("rubber band overlay", () => {
  it("spends nothing on a tap: too short a pull disarms instead of firing", () => {
    expect(release(ONE_TO_ONE, [400, 400], [404, 402])).toEqual({ cancel: true });
  });

  it("fires a band that throws back the way the finger came", () => {
    const out = release(ONE_TO_ONE, [300, 400], [500, 400]);
    expect("fire" in out).toBe(true);
    const shape = (out as { fire: BandShape }).fire;
    expect(shape.heading.x).toBeCloseTo(-1, 5);
    expect(shape.heading.y).toBeCloseTo(0, 5);
    // The band sits under the finger, not at the press point.
    expect(shape.centre.x).toBeCloseTo(500, 5);
    expect(shape.centre.y).toBeCloseTo(400, 5);
  });

  it("reads the pointer in world units, so the drag survives a scaled board", () => {
    // Half-size board: a 100px drag on screen is a 200-unit pull in the world.
    const half: BoardBox = { canvasWidth: BOARD_WIDTH / 2, canvasHeight: BOARD_HEIGHT / 2, canvasOffsetTop: 0, canvasOffsetLeft: 0 };
    const shape = (release(half, [100, 200], [200, 200]) as { fire: BandShape }).fire;
    expect(shape.centre.x).toBeCloseTo(400, 5);
    expect(shape.centre.y).toBeCloseTo(400, 5);
  });

  it("measures from the board's own corner, not the container's", () => {
    const offset: BoardBox = { canvasWidth: BOARD_WIDTH, canvasHeight: BOARD_HEIGHT, canvasOffsetTop: 40, canvasOffsetLeft: -12 };
    expect(containerToWorld(offset, { x: 88, y: 140 })).toEqual({ x: 100, y: 100 });
    expect(worldToContainer(offset, { x: 100, y: 100 })).toEqual({ x: 88, y: 140 });
  });

  it("rings what it would catch while the band is still being pulled", () => {
    // A ball between the band and the press point is inside the sweep; one
    // behind the band is not.
    const targets: BandTarget[] = [
      { x: 460, y: 400, radius: 18, kind: "ball" },
      { x: 560, y: 400, radius: 18, kind: "ball" },
    ];
    const caught = bandCatches(bandShape({ x: 300, y: 400 }, { x: 500, y: 400 }), targets);
    expect(caught.length).toBe(1);
    expect(caught[0].kind).toBe("ball");
    expect(bandCatches(null, targets)).toEqual([]);
  });

  it("turns hot amber only at full stretch", () => {
    expect(bandColour(0.5)).toBe(0x7fe3d4);
    expect(bandColour(1)).toBe(0xffb347);
  });
});

describe("rubber band tutorial hand", () => {
  it("teaches the gesture until a band has really been thrown, then stays retired", () => {
    expect(bandTutorialSeen()).toBe(false);
    markBandTutorialSeen();
    expect(localStorage.getItem(BAND_TUTORIAL_KEY)).toBe("1");
    expect(bandTutorialSeen()).toBe(true);
  });

  it("says real words, not a raw i18n key", () => {
    expect(i18n.t("rubberBand.tutorial")).toMatch(/pull back through them/i);
    expect(i18n.t("rubberBand.pullToFire")).not.toContain("rubberBand.");
  });

  it("retires the hand only on a fire, never on a cancelled tap", () => {
    // Pinned by source: the flag is written in the fire branch alone.
    const src = readFileSync("src/ui/game/RubberBandOverlay.tsx", "utf8");
    const fireAt = src.indexOf('if ("fire" in outcome)');
    const markAt = src.indexOf("markBandTutorialSeen();");
    const cancelAt = src.indexOf("onCancel();");
    expect(fireAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(fireAt);
    expect(markAt).toBeLessThan(cancelAt);
  });
});
