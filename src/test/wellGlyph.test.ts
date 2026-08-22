/**
 * The gravity-well glyph's motion lines.
 *
 * Reported from play: it was not clear the falling lines came from the ball.
 * They did not, geometrically. Their near ends were placed at hand-picked
 * heights that left a gap of roughly a quarter of the glyph between the lines
 * and the ball's surface, and a gap is all it takes: detached lines read as a
 * barcode hanging above the ball rather than as speed coming off it.
 *
 * So the property under test is contact, not appearance. Every line must start
 * ON the ball's surface (within a small constant clearance), at every glyph
 * size, which is exactly what a table of hand-picked offsets cannot promise.
 */
import { describe, it, expect } from "vitest";
import {
  wellGlyphLines, WELL_GLYPH_BALL, WELL_GLYPH_CLEARANCE,
} from "@/lib/rendering/sleek/areaLayer";

/** Distance from the ball's CENTRE to a line's near end. */
const distToCentre = (unit: number, l: { s: number; nearF: number }) =>
  Math.hypot(l.s, l.nearF - unit * WELL_GLYPH_BALL.offset);

// A well is drawn at whatever size the map authored, on whatever screen, so
// every claim below has to hold across the range rather than at one size.
const SIZES = [40, 80, 170, 400];

describe("the lines start on the ball", () => {
  it("touches the surface at every glyph size", () => {
    for (const unit of SIZES) {
      const r = unit * WELL_GLYPH_BALL.radius;
      for (const l of wellGlyphLines(unit)) {
        const gap = distToCentre(unit, l) - r;
        expect(gap, `unit ${unit}, offset ${l.s.toFixed(1)}`)
          .toBeCloseTo(unit * WELL_GLYPH_CLEARANCE, 6);
      }
    }
  });

  /**
   * The regression, in the terms it was reported in. The old near ends sat a
   * quarter of the glyph away; the clearance is now a small fraction of the
   * ball's own radius, which is what "attached" looks like numerically.
   */
  it("leaves a gap far smaller than the ball, not comparable to the glyph", () => {
    const unit = 100;
    const r = unit * WELL_GLYPH_BALL.radius;
    for (const l of wellGlyphLines(unit)) {
      const gap = distToCentre(unit, l) - r;
      expect(gap).toBeLessThan(r * 0.25);
      expect(gap, "and they must not overlap the outline either").toBeGreaterThan(0);
    }
  });

  it("keeps the clearance a constant fraction, so it survives scaling", () => {
    const small = wellGlyphLines(40)[0];
    const large = wellGlyphLines(400)[0];
    const gapOf = (unit: number, l: typeof small) =>
      (distToCentre(unit, l) - unit * WELL_GLYPH_BALL.radius) / unit;
    expect(gapOf(40, small)).toBeCloseTo(gapOf(400, large), 9);
  });
});

describe("the lines trail behind it", () => {
  it("runs backwards along the pull, never forwards", () => {
    for (const l of wellGlyphLines(100)) {
      expect(l.farF, "far end must be further back than the near end")
        .toBeLessThan(l.nearF);
      expect(l.nearF, "and the near end must not be past the ball's centre")
        .toBeLessThanOrEqual(100 * WELL_GLYPH_BALL.offset);
    }
  });

  it("sits within the ball's width, so they read as its own wake", () => {
    const r = 100 * WELL_GLYPH_BALL.radius;
    for (const l of wellGlyphLines(100)) expect(Math.abs(l.s)).toBeLessThan(r);
  });

  /** Equal lengths read as a barcode, whatever they are attached to. */
  it("gives them uneven lengths", () => {
    const lengths = wellGlyphLines(100).map(l => l.nearF - l.farF);
    expect(new Set(lengths.map(n => n.toFixed(3))).size).toBe(lengths.length);
  });

  /**
   * Solving against the circle fans them for free: the outer lines meet the
   * surface further forward than the inner ones. Worth pinning, because a
   * "simplification" back to one flat height would silently lose it.
   */
  it("fans them, because the ball is round", () => {
    const lines = wellGlyphLines(100);
    const inner = lines.filter(l => Math.abs(l.s) < 6);
    const outer = lines.filter(l => Math.abs(l.s) > 6);
    for (const o of outer) {
      for (const i of inner) {
        expect(o.nearF, "an outer line meets the surface further forward")
          .toBeGreaterThan(i.nearF);
      }
    }
  });
});

describe("degenerate input", () => {
  it("produces no NaN at zero size", () => {
    for (const l of wellGlyphLines(0)) {
      expect(Number.isFinite(l.s) && Number.isFinite(l.nearF) && Number.isFinite(l.farF))
        .toBe(true);
    }
  });
});
