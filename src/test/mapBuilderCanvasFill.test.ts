/**
 * The map canvas must fill its column, and take that height from the LAYOUT.
 *
 * Reported from a phone: "the bottom half of the map area is black on top of
 * the map, so if I move it downwards it disappears."
 *
 * Measured in a real browser at 448x997, before the fix:
 *
 *   column   635px      the space the canvas is given
 *   box      400px      the black rounded box  <- its min-height, not its parent
 *   canvas   216px      the drawing surface    <- an intrinsic fallback
 *
 * So 184px of the black box had no canvas under it, and a board dragged into
 * that band left the drawing surface and stopped being rendered. It read as
 * something black lying ON the map; it was the absence of map.
 *
 * ── The CSS, and why the obvious fix is the broken one ─────────────────────
 *
 * `height: 100%` needs a containing block with a DEFINITE height. The column is
 * a flex ITEM whose height comes from flexing, and a percentage against that
 * resolves to auto - so `h-full` gave nothing, `min-h-[400px]` quietly caught
 * the box at 400, and the canvas inside fell back further to an intrinsic
 * default. Every one of those is a silent fallback: nothing errors, and the
 * result looks like a rendering bug rather than a layout one.
 *
 * `flex-1` inside a flex-column parent takes the height from the layout instead
 * of asking a percentage to resolve, which cannot fall back.
 *
 * Asserted at the source because jsdom lays nothing out: a render test here
 * would report 0x0 for every box and pass against the broken version.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const CANVAS = read("src/components/admin/MapCanvas.tsx");
const BUILDER = read("src/components/admin/MapBuilder.tsx");

/** The className of the box that holds the canvas. */
const boxClass = () => {
  const m = CANVAS.match(/<div ref=\{containerRef\} className="([^"]+)"/);
  expect(m, "the canvas box moved or was renamed").toBeTruthy();
  return m![1];
};

describe("the black box the canvas lives in", () => {
  it("takes its height from the flex layout", () => {
    expect(boxClass()).toMatch(/\bflex-1\b/);
  });

  it("does NOT ask a percentage to resolve against a flex item", () => {
    // The whole bug in one class. It reads as correct and silently gives up.
    expect(boxClass(), "h-full is back, and it resolves to auto here")
      .not.toMatch(/\bh-full\b/);
  });

  it("sits in a column that can give it that height", () => {
    // flex-1 only means anything inside a flex container; in a plain block the
    // box would collapse to its min-height again, which is where it started.
    expect(BUILDER).toMatch(/relative flex-1 min-h-0 min-w-0 p-2 flex flex-col/);
  });

  it("keeps a floor for a very short window", () => {
    expect(boxClass()).toMatch(/min-h-\[400px\]/);
  });
});

describe("the drawing surface", () => {
  it("fills the box absolutely, so it cannot fall back to an intrinsic size", () => {
    // The buffer is sized from THIS element's own rect (see updateSize), so a
    // height that quietly defaults is the same bug one level down - and that
    // level is the one that decides how much board is drawable.
    expect(CANVAS).toMatch(/className="absolute inset-0 w-full h-full"/);
  });

  it("is still measured from its own rect, which is what makes filling matter", () => {
    expect(CANVAS).toMatch(/const cssRect = canvas\.getBoundingClientRect\(\)/);
    expect(CANVAS).toMatch(/canvas\.width = w;\s*\n\s*canvas\.height = h;/);
  });

  it("stays below the zoom controls, which are absolute too", () => {
    // Both are absolute in the same box now, so the ordering is z-index, not
    // document order.
    expect(CANVAS).toMatch(/className="absolute top-2 right-2 z-10/);
  });
});
