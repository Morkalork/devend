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

const RECT = { left: 0, top: 0, width: 900, height: 900, scale: 1 };
const SURFACE_ALPHA = 0.9;

const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255] as const;
const over = (fg: number, bg: number, a: number) => {
  const f = rgb(fg), b = rgb(bg);
  return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a));
};
/** Rough perceived lightness, good enough to compare two dark greens. */
const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The dimmest and brightest the live surface ever composites to. */
function liveSurfaceRange() {
  const light = lightScope(RECT, 0);
  const base = over(PALETTE.active, PALETTE.boardVoid, SURFACE_ALPHA);
  // The far corner from the monitor is the darkest point on the board; the
  // near one is the brightest. The light sits past the bottom-right.
  const dim = ambientAt(light, RECT.left, RECT.top);
  const bright = ambientAt(light, RECT.left + RECT.width, RECT.top + RECT.height);
  return {
    darkest: base.map(c => c * dim),
    brightest: base.map(c => c * bright),
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
    const live = luma(over(PALETTE.active, PALETTE.boardVoid, SURFACE_ALPHA));
    const cut = luma(over(PALETTE.captured, PALETTE.boardVoid, SURFACE_ALPHA));
    expect(cut, "captured no longer reads brighter than live space").toBeGreaterThan(live);
    // And by a real margin, not a hair.
    expect(cut / live, "the two surfaces are too close to tell apart").toBeGreaterThan(1.4);
  });

  it("keeps the board floating on a darker surround", () => {
    // The void being darker than the board is what makes the board read as a
    // lit object rather than as the whole screen.
    expect(luma(rgb(PALETTE.boardVoid))).toBeLessThan(
      luma(over(PALETTE.active, PALETTE.boardVoid, SURFACE_ALPHA)),
    );
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
