/**
 * The board has to be visible on a phone in daylight.
 *
 * Recurring tester feedback: the game is too dark. It was arithmetic, not
 * taste. Live space was `0x111e19` = RGB(17, 30, 25); composited at the
 * surface's 0.9 alpha over a near-black void that is RGB(16, 28, 23), and then
 * the ambient wash took up to 45% more off toward the far corner, leaving
 * RGB(9, 15, 13). That is black on anything but a good screen in a dark room.
 *
 * These pin the floor as a RULE rather than a preference, because "too dark" is
 * exactly the kind of thing that creeps back one palette tweak at a time. They
 * check the composited result the player actually sees, not the constants: the
 * surface alpha and the ambient falloff are as much a part of the answer as the
 * colours are, and testing a hex value would miss both.
 */
import { describe, it, expect } from "vitest";
import { PALETTE } from "@/lib/rendering/sleek/palette";
import { ambientAt, lightScope } from "@/lib/rendering/sleek/light";
import { washAlphaAt, WASH_FLOOR, WASH_FAR } from "@/lib/rendering/sleek/boardWash";

const RECT = { left: 0, top: 0, width: 900, height: 900, scale: 1 };
const SURFACE_ALPHA = 0.9;

const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255] as const;
const over = (fg: number, bg: number, a: number) => {
  const f = rgb(fg), b = rgb(bg);
  return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a));
};
/** Rough perceived lightness, good enough to compare two dark greens. */
const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Multiply a composited colour by the wash, which is how it is blended. */
const washed = (c: readonly number[], alpha: number) => {
  const s = rgb(PALETTE.shadow);
  return [0, 1, 2].map(i => c[i] * (1 - alpha) + (c[i] * s[i] / 255) * alpha);
};

/**
 * The dimmest and brightest the live surface ever composites to.
 *
 * Through the WASH, which is what actually darkens the board. This modelled the
 * falloff with `ambientAt` for a long time and was wrong the whole time: the
 * surface is a flat fill, and `ambientAt` is a helper OTHER layers use to tint
 * themselves. The error was conservative - it reported the board darker than it
 * is - but it meant this file could not have caught an over-darkening of the
 * one layer that actually does the darkening, which is precisely the thing it
 * exists to prevent.
 */
function liveSurfaceRange() {
  const base = over(PALETTE.active, PALETTE.boardVoid, SURFACE_ALPHA);
  return {
    // The far corner from the light is the darkest point on the board.
    darkest: washed(base, washAlphaAt(1)),
    brightest: washed(base, washAlphaAt(0)),
  };
}

describe("the live board surface", () => {
  it("never composites darker than the floor testers could not see past", () => {
    // The old far corner was RGB(9, 15, 13), luma ~13. Anything at or under
    // that is the state that was reported.
    const { darkest } = liveSurfaceRange();
    expect(
      luma(darkest),
      `darkest live pixel is rgb(${darkest.map(Math.round).join(", ")})`,
    ).toBeGreaterThan(20);
  });

  it("is still darker than captured territory, which is the read the game runs on", () => {
    // Lifting the board must never come at the cost of telling cut space from
    // uncut: that distinction IS the game.
    const w = washAlphaAt(1); // the worst case: the most-washed corner
    const live = luma(washed(over(PALETTE.active, PALETTE.boardVoid, SURFACE_ALPHA), w));
    const cut = luma(washed(over(PALETTE.captured, PALETTE.boardVoid, SURFACE_ALPHA), w));
    expect(cut, "captured no longer reads brighter than live space").toBeGreaterThan(live);
    // And by a real margin, not a hair.
    expect(cut / live, "the two surfaces are too close to tell apart").toBeGreaterThan(1.4);
  });

  it("keeps the board floating on a darker surround", () => {
    // The void being darker than the board is what makes the board read as a
    // lit object rather than as the whole screen.
    expect(luma(rgb(PALETTE.boardVoid))).toBeLessThan(luma(liveSurfaceRange().darkest));
  });

  it("leaves the shadow colour room to be a shadow", () => {
    // A shadow cast onto something near-black is not a shadow. The palette
    // comment says so, and the lift only widens this gap.
    const surface = luma(over(PALETTE.active, PALETTE.boardVoid, SURFACE_ALPHA));
    expect(luma(rgb(PALETTE.shadow)), "shadows have nowhere to darken into")
      .toBeLessThan(surface * 0.4);
  });
});

describe("the ambient wash", () => {
  it("shades the board rather than dimming it", () => {
    // It exists to stop the surface reading as a flat sheet. At 45% it was
    // doing a different job: half the darkness complaint came from here.
    const light = lightScope(RECT, 0);
    const near = ambientAt(light, RECT.left + RECT.width, RECT.top + RECT.height);
    const far = ambientAt(light, RECT.left, RECT.top);
    // Measured: 0.82 at the current 0.30 falloff, 0.71 at the old 0.45. The
    // threshold sits between them on purpose - a looser one passed with the
    // old value still in place, which made this test decorative.
    expect(far / near, "the far corner loses too much light").toBeGreaterThan(0.78);
    // ...but it must still be a gradient, or the board is a flat sheet again.
    expect(far / near, "there is no falloff left at all").toBeLessThan(0.95);

    // The absolute floor matters too: a gentle ratio over a dim light is still
    // a dim board.
    expect(far, "the far corner is unlit whatever the ratio says").toBeGreaterThan(0.6);
  });
});

describe("the board wash", () => {
  it("darkens the whole board, not just the far corner", () => {
    // The floor is what makes a ball's pool read as a pool rather than as a
    // slightly warmer patch of an already-bright surface. It used to be zero:
    // the gradient started fully transparent, so the middle of the board got no
    // darkening at all and the light there had nothing to stand against.
    expect(washAlphaAt(0), "the centre of the board is unwashed").toBeCloseTo(WASH_FLOOR, 3);
    expect(WASH_FLOOR).toBeGreaterThan(0.1);
  });

  it("still falls off toward the far corner", () => {
    // All floor and no falloff is a flat sheet again, which is the thing the
    // wash was originally added to fix.
    expect(washAlphaAt(1)).toBeCloseTo(WASH_FAR, 3);
    expect(WASH_FAR - WASH_FLOOR, "the wash lost its direction").toBeGreaterThan(0.05);
  });

  it("eases the darkening off as the monitor brightens", () => {
    // Subtractive, so it has to move opposite to the light.
    expect(washAlphaAt(1, 1.18)).toBeLessThan(washAlphaAt(1, 1.0));
    expect(washAlphaAt(1, 0.62)).toBeGreaterThan(washAlphaAt(1, 1.0));
  });

  it("never darkens the board past the floor testers reacted to", () => {
    // The real ceiling on all of this, at every point on the board and through
    // the whole flicker range.
    const base = over(PALETTE.active, PALETTE.boardVoid, SURFACE_ALPHA);
    for (const level of [0.62, 0.8, 1.0, 1.18]) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const l = luma(washed(base, washAlphaAt(t, level)));
        expect(l, `too dark at t=${t} level=${level}`).toBeGreaterThan(20);
      }
    }
  });
});
