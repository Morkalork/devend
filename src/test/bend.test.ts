/**
 * The bend maths, checked on the properties that make it usable rather than on
 * the numbers it happens to produce.
 *
 * A bent wall is still a wall: it has to keep its thickness, keep its ends
 * where they were put, and turn back into a straight one when the bend is
 * dialled to zero. Those are the things a level designer would notice, and
 * asserting on coordinates instead would pin the tessellation density and break
 * every time it is tuned.
 */
import { describe, it, expect } from "vitest";
import {
  bendVertices, curveEdge, applyEdgeCurves, bendOutline, bendsAlongX, hasBend, segmentsFor,
} from "@/lib/bend";
import type { Vector2 } from "@/lib/polygon";

/** A 400 x 24 bar lying on its side, as a plain rect outline. */
const BAR: Vector2[] = [
  { x: 100, y: 288 }, { x: 500, y: 288 }, { x: 500, y: 312 }, { x: 100, y: 312 },
];

const dist = (a: Vector2, b: Vector2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Nearest distance from a point to a polyline, for measuring a bent bar's thickness. */
function distToPolyline(p: Vector2, line: Vector2[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
      : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

/**
 * The bar's two long sides, pulled back out of a bent outline.
 *
 * bendOutline subdivides every edge including the 24-unit end caps, so the
 * outline is [top, cap, bottom, cap] with the lengths segmentsFor decides.
 * Slicing it in half lands mid-cap and measures a corner against a corner,
 * which is how this test first "found" a thickness of 8.
 */
function longSides(outline: Vector2[]): { top: Vector2[]; bottom: Vector2[] } {
  const longN = segmentsFor(400);
  const capN = segmentsFor(24);
  return {
    top: outline.slice(0, longN),
    // + 1 to take in the corner that closes the bottom side. Without it the
    // polyline stops one subdivision short, the first top point has nothing
    // under it to project onto, and the measurement reads 25.66 against 24.00
    // everywhere else - an artefact of the ruler, not of the shape.
    bottom: outline.slice(longN + capN, longN + capN + longN + 1).reverse(),
  };
}

describe("a bend that is not a bend", () => {
  it("leaves the shape alone at zero", () => {
    expect(bendVertices(BAR, 0)).toEqual(BAR);
    expect(bendOutline(BAR, {})).toEqual(BAR);
    expect(bendOutline(BAR, { bend: 0, curves: [0, 0, 0, 0] })).toEqual(BAR);
  });

  it("treats a bend far below a pixel as straight rather than dividing by it", () => {
    // R is span/(bend*PI), so a bend of 1e-9 asks for a radius of 1e11 and the
    // arithmetic stops being meaningful long before the shape stops looking
    // straight. The epsilon is the guard, not an optimisation.
    expect(bendVertices(BAR, 1e-9)).toEqual(BAR);
    expect(hasBend({ bend: 1e-9 })).toBe(false);
    expect(hasBend({ bend: 0.3 })).toBe(true);
    expect(hasBend({ curves: [0, 0.2] })).toBe(true);
    expect(hasBend({ curves: [0, 0] })).toBe(false);
    expect(hasBend(undefined)).toBe(false);
  });

  it("returns copies, so a caller cannot write through into the level config", () => {
    const out = bendVertices(BAR, 0);
    out[0].x = -999;
    expect(BAR[0].x).toBe(100);
  });
});

describe("a bent bar keeps its thickness", () => {
  // THE property, and the reason this is an arc warp rather than the three-line
  // sideways shear. Under a shear the ends come out visibly thinner than the
  // middle, which on a wall is the first thing you see.
  it("measures the same across the middle and across the ends", () => {
    const bent = bendOutline(BAR, { bend: 0.5 });
    const { top, bottom } = longSides(bent);
    const thickness = top.map(p => distToPolyline(p, bottom));
    const min = Math.min(...thickness);
    const max = Math.max(...thickness);
    expect(min).toBeGreaterThan(23.9);
    expect(max).toBeLessThan(24.1);
  });

  it("holds at a hard bend, where a shear would be obviously wrong", () => {
    const bent = bendOutline(BAR, { bend: 0.9 });
    const { top, bottom } = longSides(bent);
    const thickness = top.map(p => distToPolyline(p, bottom));
    expect(Math.min(...thickness)).toBeGreaterThan(23.9);
    expect(Math.max(...thickness)).toBeLessThan(24.1);
  });

  it("keeps two points either side of the axis exactly their distance apart", () => {
    // The invariant stated directly, without tessellation in the way: same
    // position along the axis, 24 apart across it, so they land on the same ray
    // at radii 24 apart.
    const pair: Vector2[] = [{ x: 340, y: 288 }, { x: 340, y: 312 }, { x: 100, y: 300 }, { x: 500, y: 300 }];
    const out = bendVertices(pair, 0.6, "x");
    expect(dist(out[0], out[1])).toBeCloseTo(24, 6);
  });
});

describe("which way a bend runs", () => {
  it("follows the longer side when nobody says", () => {
    expect(bendsAlongX(BAR)).toBe(true);                                  // 400 wide
    expect(bendsAlongX(BAR.map(p => ({ x: p.y, y: p.x })))).toBe(false);  // 400 tall
  });

  it("obeys an explicit axis over the shape", () => {
    expect(bendsAlongX(BAR, "y")).toBe(false);
    expect(bendsAlongX(BAR, "x")).toBe(true);
  });

  it("gives a square to x rather than letting it flip", () => {
    // A tie has to resolve the same way every time: a square whose axis flipped
    // between two runs of the same seed would deal a different board.
    const square: Vector2[] = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }];
    expect(bendsAlongX(square)).toBe(true);
  });

  it("bows opposite ways for opposite signs", () => {
    const up = bendOutline(BAR, { bend: 0.4 });
    const down = bendOutline(BAR, { bend: -0.4 });
    // Mean y of the whole outline, not a point picked by index: the first
    // version of this read index length/4, which lands near the START of the
    // top edge where the bow has barely moved anything, and dutifully reported
    // the bar's own half-thickness for both signs.
    const meanY = (pts: Vector2[]) => pts.reduce((n, p) => n + p.y, 0) / pts.length;
    expect(meanY(up)).not.toBeCloseTo(meanY(down), 1);
    // Mirror image about the bar's own centre line, y = 300.
    expect(meanY(up) - 300).toBeCloseTo(-(meanY(down) - 300), 6);
  });
});

describe("bowing a single edge", () => {
  it("pushes the midpoint out by the fraction it was given", () => {
    const pts = curveEdge({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.25);
    // curveEdge rounds its segment count up to even precisely so that this
    // point exists: index n/2 is t = 0.5, the apex.
    const mid = pts[pts.length / 2];
    expect(mid.x).toBeCloseTo(50, 6);
    // A quadratic reaches half its control offset at t = 0.5, and the control
    // is pushed 2 * bow * length, so the curve peaks at bow * length.
    expect(mid.y).toBeCloseTo(25, 6);
  });

  it("bows the same shape on a short edge and a long one", () => {
    // bow is a fraction of the edge, not an absolute distance, so a curve looks
    // like itself wherever it is used.
    const shortE = curveEdge({ x: 0, y: 0 }, { x: 40, y: 0 }, 0.25);
    const longE = curveEdge({ x: 0, y: 0 }, { x: 400, y: 0 }, 0.25);
    const peak = (pts: Vector2[], len: number) =>
      Math.max(...pts.map(p => p.y)) / len;
    expect(peak(shortE, 40)).toBeCloseTo(peak(longE, 400), 3);
  });

  it("stops short of the far end, so an outline has no doubled corners", () => {
    const pts = curveEdge({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.25);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts.at(-1)!.x).toBeLessThan(100);
  });

  it("degenerates to the single start point when there is no bow", () => {
    expect(curveEdge({ x: 3, y: 4 }, { x: 9, y: 4 }, 0)).toEqual([{ x: 3, y: 4 }]);
  });
});

describe("curving edges of an outline", () => {
  it("bows only the edges it was given, and leaves the rest as corners", () => {
    const out = applyEdgeCurves(BAR, [0, 0, 0.3, 0], false);
    // Three untouched edges contribute one point each; the fourth is a curve.
    expect(out.length).toBeGreaterThan(4);
    expect(out).toContainEqual({ x: 100, y: 288 });
    expect(out).toContainEqual({ x: 500, y: 288 });
  });

  it("treats a short curves array as zeros rather than throwing", () => {
    expect(() => applyEdgeCurves(BAR, [0.2], false)).not.toThrow();
    expect(applyEdgeCurves(BAR, [], false)).toEqual(BAR);
  });

  it("subdivides the straight edges too when a bend is coming", () => {
    // Four corners warped through an arc give a trapezoid, not a banana: the
    // bend needs points to bow.
    const plain = applyEdgeCurves(BAR, undefined, false);
    const forBending = applyEdgeCurves(BAR, undefined, true);
    expect(plain).toHaveLength(4);
    expect(forBending.length).toBeGreaterThan(40);
  });

  it("survives a degenerate outline", () => {
    expect(applyEdgeCurves([], undefined, true)).toEqual([]);
    expect(applyEdgeCurves([{ x: 1, y: 1 }], undefined, true)).toEqual([{ x: 1, y: 1 }]);
  });
});

describe("the two gestures together", () => {
  it("curves the silhouette first, then carries it round the bend", () => {
    // Both applied is not the same as either alone, and the curve is not lost.
    const both = bendOutline(BAR, { bend: 0.4, curves: [0, 0, 0.25, 0] });
    const bendOnly = bendOutline(BAR, { bend: 0.4 });
    expect(both).not.toEqual(bendOnly);
    expect(both.length).toBeGreaterThan(40);
  });

  it("keeps every vertex finite, whatever it is handed", () => {
    // This feeds the space grid and the ball collider; one NaN here is a ball
    // that vanishes off the board.
    for (const bend of [-0.9, -0.3, 0, 0.3, 0.9]) {
      for (const curve of [-0.5, 0, 0.5]) {
        const out = bendOutline(BAR, { bend, curves: [curve, curve, curve, curve] });
        for (const p of out) {
          expect(Number.isFinite(p.x), `x for bend ${bend} curve ${curve}`).toBe(true);
          expect(Number.isFinite(p.y), `y for bend ${bend} curve ${curve}`).toBe(true);
        }
      }
    }
  });

  it("caps how many vertices one edge can become", () => {
    // An 8000-unit edge must not turn into a thousand-vertex obstacle that the
    // grid carver then has to clip against.
    expect(segmentsFor(8000)).toBeLessThanOrEqual(48);
    expect(segmentsFor(0)).toBe(1);
    expect(segmentsFor(-5)).toBe(1);
  });
});
