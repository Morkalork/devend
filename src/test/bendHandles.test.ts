/**
 * The editor's two bend gestures, checked as inverse pairs.
 *
 * A handle that does not come back to where you dropped it is the thing that
 * makes a direct-manipulation editor feel broken: you pull a wall to a shape,
 * let go, and it settles somewhere slightly else. So the assertions here are
 * mostly round trips - place a handle, read the value back, ask where the
 * handle goes, and expect the same point.
 */
import { describe, it, expect } from "vitest";
import {
  apexOffset, bendHandlePos, bendFromHandle, bendFrame,
  curveHandlePos, curveFromHandle, withCurve, previewOutline, MAX_BEND,
  anglePivot, angleHandlePos, angleFromHandle,
} from "@/lib/admin/bendHandles";
import type { Vector2 } from "@/lib/polygon";

/** A 400 x 24 bar, as the editor holds it: authored outline points. */
const BAR: Vector2[] = [
  { x: 100, y: 288 }, { x: 500, y: 288 }, { x: 500, y: 312 }, { x: 100, y: 312 },
];
const TALL: Vector2[] = BAR.map(p => ({ x: p.y, y: p.x }));

const near = (a: Vector2, b: Vector2, digits = 6) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

describe("the whole-object bend handle", () => {
  it("sits at the object's centre when it is straight", () => {
    near(bendHandlePos({ points: BAR }), { x: 300, y: 300 });
    near(bendHandlePos({ points: BAR, bend: 0 }), { x: 300, y: 300 });
  });

  it("moves along the normal, not along the length", () => {
    const h = bendHandlePos({ points: BAR, bend: 0.4 });
    expect(h.x).toBeCloseTo(300, 6);   // stays at mid-length
    expect(h.y).toBeGreaterThan(300);  // bows along +y, the wide bar's normal
  });

  it("uses the other normal for a tall object", () => {
    const { n } = bendFrame(TALL);
    expect(n).toEqual({ x: -1, y: 0 });
    const h = bendHandlePos({ points: TALL, bend: 0.4 });
    expect(h.y).toBeCloseTo(300, 6);
    expect(h.x).toBeLessThan(300);
  });

  it("comes back to the same bend it was placed from", () => {
    for (const bend of [-0.8, -0.35, -0.05, 0.05, 0.35, 0.8]) {
      const pos = bendHandlePos({ points: BAR, bend });
      expect(bendFromHandle({ points: BAR }, pos), `bend ${bend}`).toBeCloseTo(bend, 5);
    }
  });

  it("comes back to the same handle position it was read from", () => {
    // Every drop here is within reach. The bar is 400 long, and at MAX_BEND its
    // centre only stands about 123 units off the chord, so a drop past that is
    // not a round trip to test but the clamp to check - see below.
    for (const drop of [280, 295, 320, 380, 415]) {
      const world = { x: 300, y: drop };
      const bend = bendFromHandle({ points: BAR }, world);
      const back = bendHandlePos({ points: BAR, bend });
      expect(back.y, `drop at ${drop}`).toBeCloseTo(drop, 4);
    }
  });

  it("stops the handle at the tightest arc when dragged past it", () => {
    // Dragging further must pin the handle rather than let the value run on,
    // or the wall keeps curling after the cursor has left the shape behind.
    const far = bendHandlePos({ points: BAR, bend: bendFromHandle({ points: BAR }, { x: 300, y: 900 }) });
    const atMax = bendHandlePos({ points: BAR, bend: MAX_BEND });
    expect(far.y).toBeCloseTo(atMax.y, 9);
    expect(far.y).toBeLessThan(430);
  });

  it("clamps rather than folding the wall back through itself", () => {
    const far = bendFromHandle({ points: BAR }, { x: 300, y: 99999 });
    expect(far).toBe(MAX_BEND);
    expect(bendFromHandle({ points: BAR }, { x: 300, y: -99999 })).toBe(-MAX_BEND);
  });

  it("reads a drag on the far side of centre as the opposite bend", () => {
    expect(bendFromHandle({ points: BAR }, { x: 300, y: 340 })).toBeGreaterThan(0);
    expect(bendFromHandle({ points: BAR }, { x: 300, y: 260 })).toBeLessThan(0);
  });

  it("survives a degenerate target instead of dividing by its span", () => {
    expect(bendFromHandle({ points: [] }, { x: 5, y: 5 })).toBe(0);
    near(bendHandlePos({ points: [] }), { x: 0, y: 0 });
    const dot: Vector2[] = [{ x: 7, y: 7 }, { x: 7, y: 7 }];
    expect(bendFromHandle({ points: dot }, { x: 9, y: 9 })).toBe(0);
    expect(apexOffset(0.5, 0)).toBe(0);
  });
});

describe("the bend handle sits on the shape it controls", () => {
  // The claim the round trips above cannot check: they compare bendHandlePos
  // with bendFromHandle, which share a formula and agree with each other
  // whether or not either matches the geometry. This compares the handle
  // against the OUTLINE, which is the thing the user is looking at.
  it("lands on the bent outline, not out in space beside it", () => {
    for (const bend of [0.2, 0.35, 0.6, -0.45]) {
      const handle = bendHandlePos({ points: BAR, bend });
      const outline = previewOutline({ points: BAR, bend });
      const nearest = Math.min(...outline.map(p => Math.hypot(p.x - handle.x, p.y - handle.y)));
      // The bar is 24 thick and the handle rides its centreline, so anything
      // beyond half the thickness plus a tessellation step is off the shape.
      expect(nearest, `bend ${bend} put the handle ${nearest.toFixed(1)} from the wall`)
        .toBeLessThan(14);
    }
  });

  it("tracks the belly, so dragging it actually moves something", () => {
    // A handle parked on a point that never moves is a dead control.
    const a = bendHandlePos({ points: BAR, bend: 0.2 });
    const b = bendHandlePos({ points: BAR, bend: 0.5 });
    expect(Math.abs(b.y - a.y)).toBeGreaterThan(20);
  });
});

describe("the per-edge curve handle", () => {
  it("sits on the edge midpoint when the edge is straight", () => {
    near(curveHandlePos(BAR, 0, 0), { x: 300, y: 288 });
    near(curveHandlePos(BAR, 1, 0), { x: 500, y: 300 });
  });

  it("lands exactly on the apex of the curve it produces", () => {
    // Not approximately: curveEdge's apex is bow * length from the midpoint,
    // and the handle is placed by the same expression.
    const curve = 0.2;
    const handle = curveHandlePos(BAR, 0, curve);
    const outline = previewOutline({ points: BAR, curves: [curve, 0, 0, 0] });
    const closest = outline.reduce((best, p) =>
      Math.hypot(p.x - handle.x, p.y - handle.y) < Math.hypot(best.x - handle.x, best.y - handle.y)
        ? p : best);
    near(closest, handle, 6);
  });

  it("comes back to the same curve it was placed from", () => {
    for (const c of [-0.4, -0.1, 0.1, 0.4]) {
      for (const edge of [0, 1, 2, 3]) {
        const pos = curveHandlePos(BAR, edge, c);
        expect(curveFromHandle(BAR, edge, pos), `edge ${edge} curve ${c}`).toBeCloseTo(c, 9);
      }
    }
  });

  it("ignores movement along the edge and reads only movement across it", () => {
    // Sliding the handle down the edge should not change the bow at all.
    const along = curveFromHandle(BAR, 0, { x: 460, y: 288 });
    expect(along).toBeCloseTo(0, 9);
  });

  it("returns zero for a zero-length edge rather than NaN", () => {
    const degenerate: Vector2[] = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 9 }];
    expect(curveFromHandle(degenerate, 0, { x: 6, y: 6 })).toBe(0);
  });
});

describe("writing a curve back into the entity", () => {
  it("pads to the edge count so entry i always means edge i", () => {
    expect(withCurve(undefined, 4, 2, 0.3)).toEqual([0, 0, 0.3, 0]);
    expect(withCurve([0.1], 4, 3, -0.2)).toEqual([0.1, 0, 0, -0.2]);
  });

  it("drops the field entirely when everything is straightened again", () => {
    // Otherwise every polygon anyone ever clicked grows a row of zeroes in
    // map.yml, and the diffs stop meaning anything.
    expect(withCurve([0, 0, 0.3, 0], 4, 2, 0)).toBeUndefined();
    expect(withCurve(undefined, 4, 0, 0)).toBeUndefined();
  });

  it("keeps the other edges' curves when one changes", () => {
    expect(withCurve([0.1, 0.2, 0.3, 0.4], 4, 1, -0.9)).toEqual([0.1, -0.9, 0.3, 0.4]);
  });
});

describe("what the editor draws", () => {
  it("shows the straight outline untouched when nothing is bent", () => {
    expect(previewOutline({ points: BAR })).toEqual(BAR);
  });

  it("shows the bend, so the editor is not lying about the map", () => {
    const bent = previewOutline({ points: BAR, bend: 0.4 });
    expect(bent.length).toBeGreaterThan(BAR.length);
    expect(bent).not.toEqual(BAR);
  });
});

describe("the turn knob", () => {
  it("sits straight up from the centre at zero", () => {
    const k = angleHandlePos(BAR, 0);
    expect(k.x).toBeCloseTo(300, 6);
    expect(k.y).toBeLessThan(300);
  });

  it("carries round with the angle, so its position reads the rotation", () => {
    const right = angleHandlePos(BAR, 90);
    expect(right.y).toBeCloseTo(300, 6);
    expect(right.x).toBeGreaterThan(300);

    const down = angleHandlePos(BAR, 180);
    expect(down.x).toBeCloseTo(300, 6);
    expect(down.y).toBeGreaterThan(300);
  });

  it("comes back to the angle it was placed from", () => {
    for (const deg of [-170, -90, -30, 0, 15, 45, 120, 179]) {
      const pos = angleHandlePos(BAR, deg);
      expect(angleFromHandle(BAR, pos), `angle ${deg}`).toBeCloseTo(deg, 4);
    }
  });

  it("stays clear of a thin bar rather than landing inside it", () => {
    // The bar is 24 tall, so half its height is 12: without the minimum arm the
    // knob would sit 17 units above centre, on top of the shape and under the
    // bend handle.
    const k = angleHandlePos(BAR, 0);
    expect(300 - k.y).toBeGreaterThan(40);
  });

  it("snaps to 15 when asked, so a right angle actually lands on 90", () => {
    const nearlyRight = { x: 300 + 100, y: 300 - 3 };
    expect(angleFromHandle(BAR, nearlyRight, 0)).not.toBe(90);
    expect(angleFromHandle(BAR, nearlyRight, 15)).toBe(90);
  });

  it("normalises what it returns, so a knob dragged twice round stays readable", () => {
    for (const p of [{ x: 300, y: 100 }, { x: 500, y: 300 }, { x: 300, y: 500 }, { x: 100, y: 300 }]) {
      const a = angleFromHandle(BAR, p);
      expect(a).toBeGreaterThan(-180);
      expect(a).toBeLessThanOrEqual(180);
    }
  });

  it("survives a drop exactly on the pivot instead of returning NaN", () => {
    expect(angleFromHandle(BAR, anglePivot(BAR))).toBe(0);
    expect(angleFromHandle([], { x: 5, y: 5 })).toBe(0);
  });

  it("shows the turn in the preview, so the editor is not lying", () => {
    const turned = previewOutline({ points: BAR, angle: 40 });
    expect(turned).not.toEqual(BAR);
    // A rigid turn: the outline keeps its vertex count and its centre.
    expect(turned).toHaveLength(BAR.length);
    const mean = (pts: typeof BAR) => ({
      x: pts.reduce((n, p) => n + p.x, 0) / pts.length,
      y: pts.reduce((n, p) => n + p.y, 0) / pts.length,
    });
    near(mean(turned), mean(BAR), 6);
  });
});
