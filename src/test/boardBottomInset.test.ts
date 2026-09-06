/**
 * The board must not be drawn under the bars pinned over it (issue #78).
 *
 * The bottom stack - fence slots, abilities, the context lane, the push-exit
 * bar, the map's control row - is `fixed` to the bottom of the viewport, and the
 * board was laid out in the whole surface with a flat 5% reserved beneath it.
 * The stack outgrew 5% the moment the fence slots became a row of their own, so
 * the bottom of the board sat behind buttons: not merely hidden, UNCUTTABLE,
 * because those buttons take the tap.
 *
 * The fix reserves the MEASURED height instead. Two properties matter and they
 * pull against each other, so both are pinned here: the board must clear the
 * bars, and it must not shrink to do it - there is a deep empty gutter above the
 * board on a portrait phone, and the board's job is to move up into it.
 */
import { describe, it, expect } from "vitest";
import {
  computeBoardRect, MAX_BOTTOM_INSET_PERCENT, BOTTOM_UI_PERCENT,
} from "@/lib/boardConstants";

/**
 * The canvas surface from the bug report, in PHYSICAL pixels: a 1344x2992 phone
 * at dpr 3, less the two-row top bar. computeBoardRect is fed physical pixels,
 * so the stack below is too - 800 of them is a ~267 CSS-pixel bar, which is
 * five rows with the ability row wrapped. That is the reported case.
 */
const PHONE = { w: 1344, h: 2700 };
const STACK = 800;

const bottom = (r: { top: number; height: number }) => r.top + r.height;

describe("a surface with nothing pinned over it", () => {
  it("lays out exactly as it always did", () => {
    // The inset defaults to zero, so every caller that has not been taught
    // about it - and every screen with no bottom stack - is untouched.
    expect(computeBoardRect(PHONE.w, PHONE.h)).toEqual(computeBoardRect(PHONE.w, PHONE.h, 0));
  });

  it("still centres the board in the band", () => {
    const r = computeBoardRect(1000, 1000);
    expect(r.left).toBe(Math.round((1000 - r.width) / 2));
  });
});

describe("with the stack measured", () => {
  const withBars = computeBoardRect(PHONE.w, PHONE.h, STACK);

  it("keeps the whole board clear of it", () => {
    expect(bottom(withBars)).toBeLessThanOrEqual(PHONE.h - STACK);
  });

  it("was NOT clear of it before, which is the bug", () => {
    // Guards the fixture as much as the fix: a stack this deep has to actually
    // reach the old board, or the assertion above proves nothing.
    const old = computeBoardRect(PHONE.w, PHONE.h);
    expect(bottom(old), "the fixture does not reproduce #78").toBeGreaterThan(PHONE.h - STACK);
  });

  it("moves the board up rather than shrinking it", () => {
    // A portrait board is limited by WIDTH, and the gutter above it is deep. So
    // there is room to lift it whole, and losing size instead would be paying
    // for the fix twice.
    const old = computeBoardRect(PHONE.w, PHONE.h);
    expect(withBars.width).toBe(old.width);
    expect(withBars.top).toBeLessThan(old.top);
  });

  it("gives up size only once there is nothing left to lift into", () => {
    // A short landscape window: the board is height-limited, so clearing the
    // bars has to cost width. Smaller and visible beats full-size and untappable.
    const short = computeBoardRect(2000, 800);
    const shortWithBars = computeBoardRect(2000, 800, 300);
    expect(shortWithBars.width).toBeLessThan(short.width);
    expect(bottom(shortWithBars)).toBeLessThanOrEqual(800 - 300);
  });
});

describe("a nonsense measurement", () => {
  /**
   * The inset comes from a live DOM read, so it can be wrong in ways a constant
   * cannot. None of these may produce a board that is inverted, invisible, or
   * off the surface - a bad measurement should cost a cramped board, never a
   * broken one.
   */
  const sane = (r: { top: number; width: number; height: number; scale: number }) => {
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    expect(r.scale).toBeGreaterThan(0);
    expect(r.top).toBeGreaterThanOrEqual(0);
  };

  it("ignores a negative inset instead of growing the board past the surface", () => {
    expect(computeBoardRect(PHONE.w, PHONE.h, -500)).toEqual(computeBoardRect(PHONE.w, PHONE.h));
  });

  it("ignores NaN rather than laying the board out in NaN", () => {
    expect(computeBoardRect(PHONE.w, PHONE.h, Number.NaN)).toEqual(computeBoardRect(PHONE.w, PHONE.h));
  });

  it("caps an inset that claims most of the screen", () => {
    const capped = computeBoardRect(PHONE.w, PHONE.h, PHONE.h * 10);
    sane(capped);
    // Held at the cap, so anything beyond it is the same board.
    expect(capped).toEqual(computeBoardRect(PHONE.w, PHONE.h, PHONE.h * MAX_BOTTOM_INSET_PERCENT));
  });

  it("survives an inset that is exactly the whole surface", () => {
    sane(computeBoardRect(PHONE.w, PHONE.h, PHONE.h));
  });
});

describe("the flat percentage this replaces", () => {
  it("is still what an uninset surface reserves, so nothing else moved", () => {
    // BOTTOM_UI_PERCENT is not deleted: it is the band a surface with NO pinned
    // bars keeps free. The point of the change is that the bars are no longer
    // assumed to fit inside it.
    expect(BOTTOM_UI_PERCENT).toBeGreaterThan(0);
    const r = computeBoardRect(1000, 1000);
    expect(bottom(r)).toBeLessThanOrEqual(1000 * (1 - BOTTOM_UI_PERCENT) + 1);
  });
});
