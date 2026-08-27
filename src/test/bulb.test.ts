/**
 * A ball has a bulb in it.
 *
 * "I was thinking more of a light bulb in each so that they light up the
 * surrounding, and are easier to see." The first pass put a pool of light on
 * the FLOOR around each ball and left the ball itself as it was: a sphere lit
 * by the monitor, with a highlight aimed at it and a dark terminator on the
 * limb turning away. So the board around the ball got brighter and the ball did
 * not, which is the half of the ask that mattered.
 *
 * The bulb is that second half, and it lives in two gradients whose important
 * properties are invisible in the numbers. Neither can be checked where it is
 * used, because the bakes need a 2D canvas context that a test environment does
 * not have, which is exactly why the arithmetic is out here.
 */
import { describe, it, expect } from "vitest";
import { bulbStops, coronaStops, luma, mixRgb, CORONA_RADII } from "@/lib/rendering/sleek/bulb";
import { PALETTE } from "@/lib/rendering/sleek/palette";
import { SELF_LIT_SHADOW } from "@/lib/rendering/sleek/ballLayer";

/** The live board surface, composited the way boardBrightness.test.ts does it. */
const SURFACE_ALPHA = 0.9;
function boardLuma(): number {
  const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  const f = rgb(PALETTE.active), b = rgb(PALETTE.boardVoid);
  const c = [0, 1, 2].map(i => f[i] * SURFACE_ALPHA + b[i] * (1 - SURFACE_ALPHA));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

const RED = 0xff5b5b;
const DARKEST_BALL = 0x2d5e43; // the dimmest colour any ball type ships with

describe("the bulb body", () => {
  it("has no dark side, which is the whole difference from a lit sphere", () => {
    // THE regression. The old bake's last stop was PALETTE.shadow: the darkest
    // pixel in the entire scene sat on the one object the player tracks. Every
    // stop must now be brighter than the board the ball is sitting on.
    const board = boardLuma();
    for (const colour of [RED, DARKEST_BALL, 0x5b8cff]) {
      for (const stop of bulbStops(colour)) {
        expect(
          luma(stop.color),
          `stop at ${stop.offset} of ball ${colour.toString(16)} is darker than the board`,
        ).toBeGreaterThan(board);
        // And opaque: a translucent limb lets the board show through and reads
        // as the same dark edge by another route.
        expect(stop.alpha).toBeGreaterThan(0.9);
      }
    }
  });

  it("is brightest at the centre, so it reads as a source and not a disc", () => {
    const stops = bulbStops(RED);
    const centre = stops[0];
    expect(centre.offset).toBe(0);
    for (const stop of stops.slice(1)) {
      expect(luma(stop.color), `stop at ${stop.offset} outshines the filament`)
        .toBeLessThan(luma(centre.color));
    }
  });

  it("keeps the ball's own hue through the body", () => {
    // A bulb whitened all the way through is a white ball, and which ball is
    // which is load-bearing information on this board.
    const body = bulbStops(RED).find(s => s.offset === 0.55)!;
    expect(body.color).toBe(RED);
  });

  it("lifts the rim rather than letting it fall away", () => {
    // Glass catching its own light. The direction is the point: brighter than
    // the body it surrounds, not darker.
    const stops = bulbStops(RED);
    const body = stops.find(s => s.offset === 0.55)!;
    const rim = stops[stops.length - 1];
    expect(rim.offset).toBe(1);
    expect(luma(rim.color)).toBeGreaterThan(luma(body.color));
    // ...but only just, or it reads as a drawn ring around the ball.
    expect(luma(rim.color)).toBeLessThan(luma(body.color) * 1.35);
  });
});

describe("the corona", () => {
  const stops = coronaStops();
  const at = (offset: number) => stops.find(s => Math.abs(s.offset - offset) < 1e-9);

  it("is transparent at the centre, so it cannot wash the ball out", () => {
    // It is drawn ADDITIVELY OVER the body. Any brightness at the middle blows
    // the ball to white and throws away the colour that identifies it, which is
    // the failure mode a "glow" usually has.
    expect(stops[0].offset).toBe(0);
    expect(stops[0].alpha).toBe(0);
  });

  it("peaks exactly on the ball's outline", () => {
    // Not near it. The bloom has to start where the body stops, or there is a
    // visible gap or a visible overlap ring.
    const edge = 1 / CORONA_RADII;
    const peak = stops.reduce((a, b) => (b.alpha > a.alpha ? b : a));
    expect(peak.offset).toBeCloseTo(edge, 10);
    expect(at(edge)).toBeTruthy();
  });

  it("fades to nothing before its own edge", () => {
    // A corona that still has alpha at the texture boundary is a hard-edged
    // disc of light, which is worse than no corona.
    const last = stops[stops.length - 1];
    expect(last.offset).toBe(1);
    expect(last.alpha).toBe(0);
  });

  it("falls monotonically once past the peak", () => {
    // Any bump on the way out reads as a second ring.
    const edge = 1 / CORONA_RADII;
    const outward = stops.filter(s => s.offset >= edge);
    for (let i = 1; i < outward.length; i++) {
      expect(outward[i].alpha, `bump at ${outward[i].offset}`)
        .toBeLessThan(outward[i - 1].alpha);
    }
  });

  it("reaches past the ball far enough to read as a bleed", () => {
    // If the whole falloff happens within a hair of the outline it is an
    // outline, not a glow.
    const edge = 1 / CORONA_RADII;
    const stillLit = stops.filter(s => s.alpha > 0.04).map(s => s.offset);
    expect(Math.max(...stillLit) / edge).toBeGreaterThan(1.8);
  });
});

describe("a lamp's own shadow", () => {
  it("is kept, but softened", () => {
    // Both halves matter. Removing it entirely floats the ball off the board;
    // leaving it at full strength puts a hard dark ellipse beside a bulb, which
    // reads as a bug rather than as shading.
    expect(SELF_LIT_SHADOW).toBeGreaterThan(0);
    expect(SELF_LIT_SHADOW).toBeLessThan(1);
  });
});

describe("mixRgb", () => {
  it("blends per channel and keeps the ends exact", () => {
    expect(mixRgb(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixRgb(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixRgb(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });
});
