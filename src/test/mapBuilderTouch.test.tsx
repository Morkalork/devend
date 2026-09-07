/**
 * Moving the board, and undoing, on the device this editor is used from.
 *
 * Reported: "it is hard to move the map on mobile, two fingers doesn't work" and
 * "can you add an undo / redo button in mobile view".
 *
 * Both had the same shape - a control that exists for a mouse and has no
 * equivalent for a thumb.
 *
 *   PANNING was bound to `e.button === 1`, the MIDDLE MOUSE BUTTON, and to
 *   nothing else. A phone has no middle button, so there was no way to move the
 *   board at all. Two fingers failed twice over: nothing listened for it, and
 *   without `touch-action: none` the browser claims the gesture for page zoom
 *   before any handler sees it - the same trap the wheel listener documents.
 *
 *   UNDO/REDO existed only in the top toolbar, which is nine controls in a row
 *   that neither wrapped nor scrolled, so on a phone the far end was clipped
 *   and unreachable - and the top of the screen is the wrong end for the two
 *   most-used actions in an editor anyway.
 *
 * Checked at the source: MapCanvas owns a 2000-line canvas and a ResizeObserver,
 * and jsdom lays out nothing and synthesises no pinch, so a render test here
 * would assert that the code it cannot run has not thrown.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const CANVAS = read("src/components/admin/MapCanvas.tsx");
const BUILDER = read("src/components/admin/MapBuilder.tsx");

describe("moving the board with two fingers", () => {
  it("lets the gesture reach a handler at all", () => {
    // The single line without which none of the rest of this file matters.
    expect(CANVAS, "the browser still takes the gesture as page zoom")
      .toMatch(/touchAction: 'none'/);
  });

  it("starts on the SECOND finger, not the first", () => {
    // One finger stays what it was: select, drag an entity, pull a handle.
    expect(CANVAS).toMatch(/if \(touchesRef\.current\.size === 2\) \{/);
  });

  it("abandons whatever the first finger had started", () => {
    // Finishing an entity drag while the board moves under it would drop the
    // entity somewhere nobody aimed at.
    expect(CANVAS).toMatch(/setDragMode\(\{ type: 'none' \}\);\s*\n\s*panRef\.current = null;\s*\n\s*const \[a, b\]/);
  });

  it("measures from where the gesture began, not from the last frame", () => {
    // Per-frame deltas accumulate rounding, so a pinch that ends where it began
    // would leave the board somewhere else.
    expect(CANVAS).toMatch(/gesture\.panX \+ \(mid\.x - gesture\.startMid\.x\)/);
    expect(CANVAS).toMatch(/gesture\.startZoom \* \(dist \/ gesture\.startDist\)/);
  });

  it("cannot divide by a zero separation", () => {
    // Two fingers landing on one pixel is rare and entirely possible.
    expect(CANVAS).toMatch(/startDist: Math\.hypot\(a\.x - b\.x, a\.y - b\.y\) \|\| 1/);
    expect(CANVAS).toMatch(/const dist = Math\.hypot\(a\.x - b\.x, a\.y - b\.y\) \|\| 1/);
  });

  it("ends the gesture when a finger lifts, rather than handing it to the survivor", () => {
    expect(CANVAS).toMatch(/touchesRef\.current\.delete\(e\.pointerId\)/);
    expect(CANVAS).toMatch(/if \(touchesRef\.current\.size < 2\) gestureRef\.current = null/);
  });

  it("releases a touch the OS takes back", () => {
    // A cancelled pointer never fires `up`, so without this its id stays in the
    // map and the next single finger reads as the second of a pair.
    expect(CANVAS).toMatch(/onPointerCancel=\{handlePointerUp\}/);
  });

  it("keeps the middle-button pan for the desk", () => {
    expect(CANVAS).toMatch(/if \(e\.button === 1\) \{/);
  });
});

describe("undo and redo on a phone", () => {
  it("are reachable without the toolbar", () => {
    expect(BUILDER).toMatch(/lg:hidden absolute bottom-4 left-4/);
  });

  it("drive the same history as the toolbar pair", () => {
    // A second, separate history would be the actual disaster here.
    expect((BUILDER.match(/applyHistory\('undo'\)/g) ?? []).length).toBe(2);
    expect((BUILDER.match(/applyHistory\('redo'\)/g) ?? []).length).toBe(2);
  });

  it("grey out with the same rule, so neither pair lies about what is possible", () => {
    expect((BUILDER.match(/disabled=\{!canUndo\(history\)\}/g) ?? []).length).toBe(2);
    expect((BUILDER.match(/disabled=\{!canRedo\(history\)\}/g) ?? []).length).toBe(2);
  });

  it("are big enough to hit with a thumb", () => {
    // 44px is the smallest a touch target should be; the toolbar's are 32.
    expect(BUILDER).toMatch(/w-11 h-11 rounded-full/);
  });

  it("are labelled, having no visible text", () => {
    expect(BUILDER).toMatch(/aria-label="Undo"/);
    expect(BUILDER).toMatch(/aria-label="Redo"/);
  });
});

describe("the toolbar that was clipping them", () => {
  it("scrolls instead of hiding its far end", () => {
    const bar = BUILDER.slice(BUILDER.indexOf("admin-chrome-zoom flex-shrink-0 p-3"));
    expect(bar.slice(0, 200)).toMatch(/overflow-x-auto/);
  });

  it("keeps its buttons from being squeezed to nothing", () => {
    // Without this the scroller never engages: the buttons just compress.
    expect(BUILDER).toMatch(/flex-shrink-0 p-2 rounded-lg bg-muted/);
  });
});
