/**
 * The shapes a bomb blast leaves (lib/blastGeometry.ts): "make them able to
 * blast holes in walls". A wall minus the blast must be exactly the wall with
 * the circle taken out, as simple polygons with no holes.
 */
import { describe, it, expect } from "vitest";
import type { Polygon } from "@/lib/polygon";
import { createRectPolygon, pointInPolygon } from "@/lib/polygon";
import {
  circlePolygon, polygonMinusConvex, polygonTouchesCircle, segmentMinusCircle, segmentTouchesCircle,
} from "@/lib/blastGeometry";

/** Sample the plane: every sample must be in the result exactly when it is in the wall and out of the blast. */
function expectExactDifference(subject: Polygon, clip: Polygon, result: Polygon[], step = 2) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of [...subject.vertices, ...clip.vertices]) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  let wrong = 0, total = 0;
  for (let x = minX + step / 3; x < maxX; x += step) {
    for (let y = minY + step / 3; y < maxY; y += step) {
      const p = { x, y };
      const want = pointInPolygon(p, subject) && !pointInPolygon(p, clip);
      const inAny = result.filter(r => pointInPolygon(p, r)).length;
      total++;
      if ((want ? 1 : 0) !== inAny) wrong++;
    }
  }
  // Only samples right on an edge may disagree (float rounding at the seam).
  expect(wrong / total).toBeLessThan(0.002);
}

describe("a wall minus the blast", () => {
  it("bites a corner off", () => {
    const wall = createRectPolygon(0, 0, 100, 100);
    const blast = circlePolygon({ x: 100, y: 100 }, 50);
    const out = polygonMinusConvex(wall, blast);
    expect(out).toHaveLength(1);
    expectExactDifference(wall, blast, out);
  });

  it("cuts a thin wall clean through into two", () => {
    const wall = createRectPolygon(0, 0, 300, 20);
    const blast = circlePolygon({ x: 150, y: 10 }, 40);
    const out = polygonMinusConvex(wall, blast);
    expect(out).toHaveLength(2);
    expectExactDifference(wall, blast, out);
  });

  it("splits a big wall in two rather than leaving a hole, when the blast is wholly inside it", () => {
    const wall = createRectPolygon(0, 0, 400, 300);
    const blast = circlePolygon({ x: 180, y: 150 }, 60);
    const out = polygonMinusConvex(wall, blast);
    expect(out.length).toBe(2);
    expectExactDifference(wall, blast, out);
  });

  it("leaves a wall the blast misses alone, and takes one it swallows", () => {
    const wall = createRectPolygon(0, 0, 50, 50);
    expect(polygonMinusConvex(wall, circlePolygon({ x: 400, y: 400 }, 50))).toEqual([wall]);
    expect(polygonMinusConvex(wall, circlePolygon({ x: 25, y: 25 }, 200))).toEqual([]);
  });

  it("handles a concave wall", () => {
    const L: Polygon = { vertices: [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 200 }, { x: 0, y: 200 },
    ] };
    const blast = circlePolygon({ x: 30, y: 30 }, 45);
    const out = polygonMinusConvex(L, blast);
    expect(out).toHaveLength(2);
    expectExactDifference(L, blast, out);
  });

  it("survives a blast whose edge lands exactly on a corner", () => {
    const wall = createRectPolygon(0, 0, 100, 100);
    // A vertex of the blast polygon sits exactly on the wall's corner.
    const blast = circlePolygon({ x: 150, y: 100 }, 50, 40, Math.PI);
    const out = polygonMinusConvex(wall, blast);
    expect(out.length).toBeGreaterThan(0);
    expectExactDifference(wall, blast, out, 3);
  });

  it("drops a sliver too thin to be a wall", () => {
    const wall = createRectPolygon(0, 0, 100, 100);
    const blast = circlePolygon({ x: 50, y: 50 }, 70.5);
    for (const p of polygonMinusConvex(wall, blast, 30)) {
      let area = 0;
      const v = p.vertices;
      for (let i = 0; i < v.length; i++) { const j = (i + 1) % v.length; area += v[i].x * v[j].y - v[j].x * v[i].y; }
      expect(Math.abs(area / 2)).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("a fence minus the blast", () => {
  it("leaves the two ends standing", () => {
    const blast = circlePolygon({ x: 100, y: 0 }, 30);
    const out = segmentMinusCircle({ x: 0, y: 0 }, { x: 200, y: 0 }, blast);
    expect(out).toHaveLength(2);
    expect(out[0].end.x).toBeCloseTo(70, 0);
    expect(out[1].start.x).toBeCloseTo(130, 0);
  });

  it("takes a fence that lies wholly inside it, and drops a stub too short to stand", () => {
    const blast = circlePolygon({ x: 0, y: 0 }, 50);
    expect(segmentMinusCircle({ x: -10, y: 0 }, { x: 10, y: 0 }, blast)).toEqual([]);
    expect(segmentMinusCircle({ x: 0, y: 0 }, { x: 52, y: 0 }, blast, 4)).toEqual([]);
  });
});

describe("what the blast touches", () => {
  it("knows a fence or wall in reach from one out of it", () => {
    expect(segmentTouchesCircle({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 20 }, 30)).toBe(true);
    expect(segmentTouchesCircle({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 40 }, 30)).toBe(false);
    expect(polygonTouchesCircle(createRectPolygon(0, 0, 10, 10), { x: 5, y: 5 }, 1)).toBe(true);
    expect(polygonTouchesCircle(createRectPolygon(0, 0, 10, 10), { x: 50, y: 50 }, 10)).toBe(false);
  });
});
