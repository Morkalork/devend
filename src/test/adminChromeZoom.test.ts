/**
 * The map builder's chrome is scaled up on a desktop screen. The canvas is not.
 *
 * The builder's panels are built from text-xs and text-[11px], which is right
 * for the phone-sized viewport the game targets and too small to work in on a
 * monitor. `.admin-chrome-zoom` scales the toolbars and the side panel.
 *
 * ── The failure this guards ────────────────────────────────────────────────
 *
 * Putting that class on the canvas column, or on any ancestor of it. MapCanvas
 * turns pointer positions into world coordinates through getBoundingClientRect,
 * so a zoomed ancestor silently offsets every click: obstacles would be placed
 * where the mouse was not, handles would grab from a distance, and nothing
 * would error. The game's board overlays already learned this the hard way -
 * board-aligned UI has to live in a coordinate space nothing has transformed.
 *
 * It is a source check because the failure is structural. A jsdom render proves
 * nothing here: jsdom does not implement `zoom`, so a layout test would report
 * everything fine in exactly the case that is broken in a browser.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BUILDER = readFileSync(
  resolve(process.cwd(), "src/components/admin/MapBuilder.tsx"), "utf8");
const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const STRIP = readFileSync(
  resolve(process.cwd(), "src/components/admin/RotationStrip.tsx"), "utf8");

/** Every JSX line carrying the zoom class. */
const zoomedLines = () =>
  BUILDER.split("\n").filter(l => l.includes("admin-chrome-zoom"));

describe("the zoom is defined at all", () => {
  it("exists, and only bites at desktop widths", () => {
    expect(CSS, "the zoom class is gone").toContain(".admin-chrome-zoom");
    // Below the breakpoint the panel is a short strip under the map with no
    // room to spare, so the default has to be 1.
    expect(CSS).toMatch(/--admin-chrome-zoom:\s*1\s*;/);
    expect(CSS).toMatch(/@media\s*\(min-width:\s*1024px\)/);
  });

  it("scales up rather than down", () => {
    const factors = [...CSS.matchAll(/--admin-chrome-zoom:\s*([\d.]+)/g)]
      .map(m => Number(m[1]));
    expect(factors.length).toBeGreaterThanOrEqual(2);
    for (const f of factors) {
      expect(f, "a zoom factor shrinks the panels").toBeGreaterThanOrEqual(1);
      // Past about 1.4 the side panel starts eating the map it is describing.
      expect(f, "the panels have grown enough to crowd out the canvas")
        .toBeLessThanOrEqual(1.5);
    }
  });

  it("uses zoom, not a transform", () => {
    // A transform leaves every element's layout box at its old size, so the
    // panel would look bigger and click like it was still small.
    expect(CSS).toMatch(/\.admin-chrome-zoom\s*\{[^}]*zoom:/);
    expect(CSS).not.toMatch(/\.admin-chrome-zoom\s*\{[^}]*transform:\s*scale/);
  });
});

describe("what is scaled, and what is left alone", () => {
  it("scales the chrome", () => {
    // Both toolbars and the side panel. If this drops to one, something was
    // removed rather than deliberately excluded.
    expect(zoomedLines().length).toBeGreaterThanOrEqual(3);
  });

  it("never scales the canvas column", () => {
    // THE guard. MapCanvas reads pointer positions against a bounding box; a
    // zoomed ancestor puts every click somewhere other than where it was made,
    // and nothing reports it.
    const lines = BUILDER.split("\n");
    const canvasAt = lines.findIndex(l => l.includes("<MapCanvas"));
    expect(canvasAt, "MapCanvas not found: has it been renamed?").toBeGreaterThan(-1);

    // Walk back to the element that opens the canvas column and check the few
    // lines wrapping it. The class is applied inline on the container, so a
    // mistake would appear here.
    const wrapper = lines.slice(Math.max(0, canvasAt - 4), canvasAt + 1).join("\n");
    expect(wrapper, "the canvas column is inside the zoom")
      .not.toContain("admin-chrome-zoom");
  });

  it("puts the zoom on containers that hold no canvas of their own", () => {
    // A cheap structural read of the same rule: none of the zoomed lines may be
    // the line that mounts the map.
    for (const line of zoomedLines()) {
      expect(line).not.toContain("MapCanvas");
    }
  });
});

describe("the thumbnails inside the zoomed panel", () => {
  it("size their backing store from the measured box, not dpr alone", () => {
    // RotationStrip is the one picture in the panel. devicePixelRatio knows
    // nothing about a CSS zoom, so drawing at SIZE x dpr and displaying over a
    // larger box would make the thumbnails the only thing that got BLURRIER as
    // the panel got bigger.
    expect(STRIP, "the thumbnails ignore the panel zoom")
      .toContain("getBoundingClientRect");
    expect(STRIP).toMatch(/devicePixelRatio\s*\|\|\s*1\)\s*\*\s*zoom/);
  });

  it("falls back to plain dpr when the box cannot be measured", () => {
    // getBoundingClientRect returns 0 before layout and in jsdom. Dividing by
    // SIZE there would set the canvas to zero and draw nothing at all.
    expect(STRIP).toMatch(/box > 0 \? box \/ SIZE : 1/);
  });
});
