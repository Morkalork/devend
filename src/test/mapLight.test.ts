/**
 * A map can be authored dark, as a challenge.
 *
 * "I thought I might have some maps be a lot darker, as part of the challenge."
 * The board's wash already darkens the surface; this makes how much of it a
 * property of the map, defaulting to the normal board when unset.
 *
 * The thing that makes it safe to offer at all is that the wash is a MULTIPLY.
 * It scales live and captured space by the same factor, so the ratio between
 * them survives every darkness unchanged (to within a rounding error, since
 * the shadow colour is near-black rather than black). A dark map costs you your view of the
 * board at rest, and never the ability to tell what you have already taken,
 * which is the one read the game cannot be played without. That property is
 * pinned below, because it is the difference between a hard map and a broken
 * one, and it would be lost the moment anyone implemented this as a flat
 * overlay instead.
 */
import { describe, it, expect } from "vitest";
import {
  washAlphaAt, washProfile, washStops, washSpriteAlpha,
  MIN_MAP_LIGHT, WASH_FLOOR, WASH_FAR, DARK_FLOOR, DARK_FAR,
} from "@/lib/rendering/sleek/boardWash";
import { PALETTE } from "@/lib/rendering/sleek/palette";

const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const over = (fg: number, bg: number, a: number) => {
  const f = rgb(fg), b = rgb(bg);
  return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a));
};
const washed = (c: number[], alpha: number) => {
  const s = rgb(PALETTE.shadow);
  return [0, 1, 2].map(i => c[i] * (1 - alpha) + (c[i] * s[i] / 255) * alpha);
};
const LIVE = over(PALETTE.active, PALETTE.boardVoid, 0.9);
const CUT = over(PALETTE.captured, PALETTE.boardVoid, 0.9);

describe("an unset map light", () => {
  it("is exactly the board every other map already had", () => {
    // The whole point of a default: adding the setting must not change a single
    // map that does not use it.
    expect(washProfile(undefined).floor).toBeCloseTo(WASH_FLOOR, 6);
    expect(washProfile(undefined).far).toBeCloseTo(WASH_FAR, 6);
    expect(washProfile(1).floor).toBeCloseTo(WASH_FLOOR, 6);
    expect(washAlphaAt(1, 1, undefined)).toBeCloseTo(washAlphaAt(1, 1, 1), 6);
  });
});

describe("a darker map", () => {
  it("actually gets darker", () => {
    const normal = luma(washed(LIVE, washAlphaAt(1, 1, 1)));
    const dim = luma(washed(LIVE, washAlphaAt(1, 1, 0.6)));
    const darkest = luma(washed(LIVE, washAlphaAt(1, 1, MIN_MAP_LIGHT)));
    expect(dim).toBeLessThan(normal);
    expect(darkest).toBeLessThan(dim);
  });

  it("moves smoothly rather than in steps", () => {
    // A designer turning the dial should see it respond, not snap between two
    // presets.
    let prev = Infinity;
    for (let l = 1; l >= MIN_MAP_LIGHT - 1e-9; l -= 0.05) {
      const v = luma(washed(LIVE, washAlphaAt(1, 1, l)));
      expect(v, `not monotonic at light=${l.toFixed(2)}`).toBeLessThan(prev);
      prev = v;
    }
  });

  it("bottoms out at MIN_MAP_LIGHT however far past it you ask", () => {
    // The bound is not advice. A map you cannot read is not a hard map.
    const floorAlpha = washAlphaAt(1, 1, MIN_MAP_LIGHT);
    expect(washAlphaAt(1, 1, 0)).toBeCloseTo(floorAlpha, 6);
    expect(washAlphaAt(1, 1, -5)).toBeCloseTo(floorAlpha, 6);
    expect(washProfile(MIN_MAP_LIGHT).far).toBeCloseTo(DARK_FAR, 6);
    expect(washProfile(MIN_MAP_LIGHT).floor).toBeCloseTo(DARK_FLOOR, 6);
  });

  it("is capped above 1 too, so a typo cannot brighten the board", () => {
    expect(washAlphaAt(1, 1, 4)).toBeCloseTo(washAlphaAt(1, 1, 1), 6);
  });

  it("falls back to the normal board on a value that is not a number", () => {
    // This comes from a number field an author types into. A half-typed or
    // cleared value would otherwise carry NaN through every alpha and paint the
    // board with a gradient of nothing - which is a blank screen, not a dark
    // map, and would look like the renderer had died.
    expect(washProfile(NaN).far).toBeCloseTo(WASH_FAR, 6);
    expect(washAlphaAt(1, 1, NaN)).toBeCloseTo(washAlphaAt(1, 1, 1), 6);
    expect(Number.isFinite(washAlphaAt(0.5, 1, NaN))).toBe(true);
  });
});

describe("what a dark map may never cost you", () => {
  it("keeps captured space exactly as distinguishable from live space", () => {
    // THE property. A multiply scales both surfaces by the same factor, so the
    // ratio survives. Implemented as a flat dark overlay instead, it would
    // compress toward 1 as the map darkens and the board would stop telling you
    // what you had taken - unplayable, not hard.
    //
    // Invariant to about one part in ten thousand rather than exactly, because
    // the wash multiplies by PALETTE.shadow and that is near-black, not black.
    // The tolerance is set to what the arithmetic actually delivers; asking for
    // more would be asserting something untrue and would fail the first time
    // anyone nudged the shadow colour.
    const ratioAt = (light: number) => {
      const a = washAlphaAt(1, 1, light);
      return luma(washed(CUT, a)) / luma(washed(LIVE, a));
    };
    const normal = ratioAt(1);
    expect(normal).toBeGreaterThan(1.4);
    for (const light of [0.8, 0.6, 0.45, MIN_MAP_LIGHT]) {
      expect(ratioAt(light), `the read collapsed at light=${light}`).toBeCloseTo(normal, 3);
    }
  });

  it("leaves the darkest board still lit enough for the ball pools to read", () => {
    // Dramatic, not black. The pool adds a fixed amount, so the darker the
    // board the higher the contrast - what has to be checked is the floor the
    // pool is landing on, at the flicker's deepest dip.
    const POOL_ADD = 255 * 0.60 * 0.55;
    const darkest = washed(LIVE, washAlphaAt(1, 0.62, MIN_MAP_LIGHT));
    expect(luma(darkest), "the darkest authored map is effectively black")
      .toBeGreaterThan(8);
    const lit = darkest.map(v => Math.min(255, v + POOL_ADD));
    expect(luma(lit) / luma(darkest), "the ball light stops reading").toBeGreaterThan(4);
  });

  it("still falls off toward the far corner at every light", () => {
    // All floor and no falloff is a flat sheet, at any brightness.
    for (const light of [1, 0.7, MIN_MAP_LIGHT]) {
      const p = washProfile(light);
      expect(p.far - p.floor, `no direction left at light=${light}`).toBeGreaterThan(0.05);
    }
  });
});

describe("the bake stays valid at every light", () => {
  it("never needs a gradient stop above 1", () => {
    // A stop over 1 clamps silently inside the canvas bake, and the map would
    // quietly stop getting darker past some setting with nothing to show why.
    for (const light of [1, 0.8, 0.6, 0.45, MIN_MAP_LIGHT]) {
      for (const stop of washStops(light)) {
        expect(stop.alpha, `stop ${stop.offset} clamps at light=${light}`)
          .toBeLessThanOrEqual(1);
        expect(stop.alpha).toBeGreaterThan(0);
      }
    }
  });

  it("hits its stated floor and far exactly at the monitor's idle level", () => {
    for (const light of [1, 0.7, MIN_MAP_LIGHT]) {
      const p = washProfile(light);
      expect(washAlphaAt(0, 1, light)).toBeCloseTo(p.floor, 5);
      expect(washAlphaAt(1, 1, light)).toBeCloseTo(p.far, 5);
    }
  });

  it("keeps the flicker from driving any map past its own cap", () => {
    for (const light of [1, 0.6, MIN_MAP_LIGHT]) {
      const p = washProfile(light);
      for (const level of [0.62, 0.8, 1.0, 1.18]) {
        expect(washAlphaAt(1, level, light), `over cap at light=${light} level=${level}`)
          .toBeLessThanOrEqual(p.max + 1e-9);
      }
      expect(washSpriteAlpha(0.62, light)).toBeLessThanOrEqual(1);
    }
  });
});
