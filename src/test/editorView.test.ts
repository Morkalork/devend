/**
 * Zooming the Map Builder.
 *
 * Reported as "zoomed in to a point where I can't see the whole map, and
 * ctrl+wheel doesn't work either". Both halves were true and they had different
 * causes: there was no zoom in the editor at all, so the view was whatever the
 * fit produced, and ctrl+wheel was the browser's own page zoom being swallowed
 * by the page rather than doing anything useful to the canvas.
 *
 * The maths worth testing is the cursor anchoring. Zooming about the centre is
 * the easy version and the wrong one, and the difference is invisible in a
 * screenshot: you only notice it as the corner you were inspecting sliding away
 * every time you zoom.
 */
import { describe, it, expect } from "vitest";
import {
  FIT_VIEW, MIN_ZOOM, MAX_ZOOM, clampZoom, computeEditorBoardRect, zoomAboutPoint,
} from "@/lib/editorView";
import { BOARD_WIDTH } from "@/lib/boardConstants";

const W = 800, H = 600;
const rectAt = (view = FIT_VIEW) => computeEditorBoardRect(W, H, view);
/** Where a world point lands on screen under a view. */
const project = (view: typeof FIT_VIEW, wx: number, wy: number) => {
  const r = computeEditorBoardRect(W, H, view);
  return { x: r.left + wx * r.scale, y: r.top + wy * r.scale };
};

describe("the fitted view", () => {
  it("is the largest square the container holds, centred", () => {
    const r = rectAt();
    expect(r.width).toBe(r.height);
    expect(r.width).toBe(Math.min(W, H) - 40);       // 20px padding each side
    expect(r.left + r.width / 2).toBeCloseTo(W / 2, 9);
    expect(r.top + r.height / 2).toBeCloseTo(H / 2, 9);
  });

  it("maps the whole board across it", () => {
    const r = rectAt();
    expect(r.scale).toBeCloseTo(r.width / BOARD_WIDTH, 9);
  });
});

describe("zooming", () => {
  it("makes the board bigger and smaller", () => {
    expect(rectAt({ ...FIT_VIEW, zoom: 2 }).width).toBeCloseTo(rectAt().width * 2, 9);
    expect(rectAt({ ...FIT_VIEW, zoom: 0.5 }).width).toBeCloseTo(rectAt().width * 0.5, 9);
  });

  /**
   * The reported symptom. The fit is the largest square the CANVAS can hold,
   * and when the canvas itself overflows the viewport, "fitted" is still bigger
   * than what you can see: there has to be room to go below 1.
   */
  it("can go below the fit, or a too-tall canvas has no way out", () => {
    expect(MIN_ZOOM).toBeLessThan(1);
    expect(rectAt({ ...FIT_VIEW, zoom: MIN_ZOOM }).width).toBeLessThan(rectAt().width);
  });

  it("clamps rather than inverting or vanishing", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(-4)).toBe(MIN_ZOOM);
    expect(clampZoom(1e6)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(rectAt({ ...FIT_VIEW, zoom: -4 }).width).toBeGreaterThan(0);
  });
});

describe("the cursor stays on what it was pointing at", () => {
  const CURSOR = { x: 120, y: 480 };   // deliberately off-centre and low

  it("keeps the world point under the cursor exactly where it was", () => {
    const before = FIT_VIEW;
    const r = rectAt(before);
    const wx = (CURSOR.x - r.left) / r.scale;
    const wy = (CURSOR.y - r.top) / r.scale;

    const after = zoomAboutPoint(before, 2.5, CURSOR.x, CURSOR.y, W, H);
    const p = project(after, wx, wy);
    expect(p.x).toBeCloseTo(CURSOR.x, 6);
    expect(p.y).toBeCloseTo(CURSOR.y, 6);
  });

  it("holds across a chain of steps, not just one", () => {
    // Wheel zooming is many small steps; error that compounds would drift the
    // board out from under the pointer over a single scroll.
    let view = FIT_VIEW;
    const r = rectAt(view);
    const wx = (CURSOR.x - r.left) / r.scale;
    const wy = (CURSOR.y - r.top) / r.scale;
    for (let i = 0; i < 25; i++) {
      view = zoomAboutPoint(view, view.zoom * 1.08, CURSOR.x, CURSOR.y, W, H);
    }
    const p = project(view, wx, wy);
    expect(p.x).toBeCloseTo(CURSOR.x, 4);
    expect(p.y).toBeCloseTo(CURSOR.y, 4);
  });

  it("is reversible: zoom in and back out returns the view", () => {
    const inn = zoomAboutPoint(FIT_VIEW, 3, CURSOR.x, CURSOR.y, W, H);
    const out = zoomAboutPoint(inn, 1, CURSOR.x, CURSOR.y, W, H);
    expect(out.zoom).toBeCloseTo(1, 9);
    expect(out.panX).toBeCloseTo(0, 6);
    expect(out.panY).toBeCloseTo(0, 6);
  });

  /** Centre-anchored zoom is the wrong implementation; prove this is not it. */
  it("does not simply zoom about the middle", () => {
    const anchored = zoomAboutPoint(FIT_VIEW, 3, CURSOR.x, CURSOR.y, W, H);
    const centred = zoomAboutPoint(FIT_VIEW, 3, W / 2, H / 2, W, H);
    expect(Math.hypot(anchored.panX - centred.panX, anchored.panY - centred.panY))
      .toBeGreaterThan(50);
  });

  it("leaves the pan alone when zooming about the centre", () => {
    const v = zoomAboutPoint(FIT_VIEW, 2, W / 2, H / 2, W, H);
    expect(v.panX).toBeCloseTo(0, 6);
    expect(v.panY).toBeCloseTo(0, 6);
  });

  it("survives a container with no size yet", () => {
    // The ResizeObserver has not fired on the first paint.
    const v = zoomAboutPoint(FIT_VIEW, 2, 0, 0, 0, 0);
    for (const n of [v.zoom, v.panX, v.panY]) expect(Number.isFinite(n)).toBe(true);
  });
});

describe("panning", () => {
  it("moves the board one-for-one with the pan", () => {
    const moved = rectAt({ zoom: 1, panX: 60, panY: -25 });
    const base = rectAt();
    expect(moved.left - base.left).toBeCloseTo(60, 9);
    expect(moved.top - base.top).toBeCloseTo(-25, 9);
  });

  it("does not change the scale", () => {
    expect(rectAt({ zoom: 2, panX: 300, panY: 300 }).scale)
      .toBeCloseTo(rectAt({ zoom: 2, panX: 0, panY: 0 }).scale, 9);
  });
});
