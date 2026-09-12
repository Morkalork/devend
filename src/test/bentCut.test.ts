/**
 * Bent fences (issue #66): the path the fence is drawn along.
 *
 * The projection off each end is the engine's existing ray cast, so what is
 * pinned here is the part that is new: turning a raw finger-drag into the
 * polyline the fence follows, and refusing the drags a fence cannot follow.
 */
import { describe, it, expect } from "vitest";
import {
  BEND_TOLERANCE,
  MIN_SEGMENT_LENGTH,
  drawnFencePath,
  simplifyPath,
  joinProjection,
  outgoingDirection,
  incomingDirection,
} from "@/lib/physics/bentCut";
import type { Vector2 } from "@/types/game";

/** Samples along a straight line, the way a steady drag arrives. */
function line(from: Vector2, to: Vector2, n = 20): Vector2[] {
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / n,
    y: from.y + ((to.y - from.y) * i) / n,
  }));
}

/** An L: out along +x, then turn and go +y. */
function elbow(): Vector2[] {
  return [...line({ x: 100, y: 100 }, { x: 300, y: 100 }), ...line({ x: 300, y: 100 }, { x: 300, y: 300 })];
}

describe("simplifyPath", () => {
  it("reduces a straight run to its endpoints", () => {
    expect(simplifyPath(line({ x: 0, y: 0 }, { x: 400, y: 0 }), 5)).toEqual([
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ]);
  });

  it("keeps the corner of an L", () => {
    const simple = simplifyPath(elbow(), 5);
    expect(simple).toHaveLength(3);
    expect(simple[1]).toEqual({ x: 300, y: 100 });
  });

  it("keeps the endpoints whatever the tolerance", () => {
    const raw = elbow();
    const simple = simplifyPath(raw, 10_000);
    expect(simple[0]).toEqual(raw[0]);
    expect(simple[simple.length - 1]).toEqual(raw[raw.length - 1]);
  });
});

describe("drawnFencePath", () => {
  it("returns null without the loadout, however bent the drag", () => {
    expect(drawnFencePath(elbow(), 0)).toBeNull();
  });

  it("returns null for a straight drag, so the ordinary cut still runs", () => {
    expect(drawnFencePath(line({ x: 100, y: 100 }, { x: 500, y: 100 }), 2)).toBeNull();
  });

  it("treats a wobbly line as straight", () => {
    // A hand-drawn "straight" line, off by less than the bend tolerance.
    const wobbly = line({ x: 100, y: 400 }, { x: 600, y: 400 }, 40).map((p, i) => ({
      x: p.x,
      y: p.y + Math.sin(i) * (BEND_TOLERANCE * 0.5),
    }));
    expect(drawnFencePath(wobbly, 3)).toBeNull();
  });

  it("finds the corner of a deliberate elbow", () => {
    const path = drawnFencePath(elbow(), 2);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(3);
    expect(path![1].x).toBeCloseTo(300, 0);
    expect(path![1].y).toBeCloseTo(100, 0);
  });

  it("never returns more corners than the budget allows", () => {
    // A staircase: four corners drawn, and the budget says two.
    const stair = [
      ...line({ x: 100, y: 100 }, { x: 250, y: 100 }),
      ...line({ x: 250, y: 100 }, { x: 250, y: 250 }),
      ...line({ x: 250, y: 250 }, { x: 400, y: 250 }),
      ...line({ x: 400, y: 250 }, { x: 400, y: 400 }),
    ];
    for (const budget of [1, 2, 3]) {
      const path = drawnFencePath(stair, budget);
      expect(path).not.toBeNull();
      expect(path!.length - 2).toBeLessThanOrEqual(budget);
    }
  });

  it("keeps the sharpest corners when it has to drop some", () => {
    // A near-straight kink followed by a right angle: with one corner to spend,
    // the right angle is the one the player was aiming at.
    const raw = [
      ...line({ x: 100, y: 100 }, { x: 300, y: 100 }),
      ...line({ x: 300, y: 100 }, { x: 500, y: 140 }), // gentle
      ...line({ x: 500, y: 140 }, { x: 500, y: 400 }), // sharp
    ];
    const path = drawnFencePath(raw, 1);
    expect(path).toHaveLength(3);
    expect(path![1].x).toBeCloseTo(500, 0);
    expect(path![1].y).toBeCloseTo(140, 0);
  });

  it("refuses a fold-back, rather than quietly drawing a smear", () => {
    const doubled = [...line({ x: 100, y: 100 }, { x: 400, y: 100 }), ...line({ x: 400, y: 100 }, { x: 120, y: 108 })];
    expect(drawnFencePath(doubled, 2)).toBeNull();
  });

  it("drops a corner too close to its neighbour to aim", () => {
    const nub = [
      ...line({ x: 100, y: 100 }, { x: 400, y: 100 }),
      // A flick a few units long: a corner nobody could have meant.
      ...line({ x: 400, y: 100 }, { x: 400, y: 100 + MIN_SEGMENT_LENGTH / 4 }, 4),
    ];
    expect(drawnFencePath(nub, 2)).toBeNull();
  });

  it("returns null for a tap or a stub", () => {
    expect(drawnFencePath([], 2)).toBeNull();
    expect(drawnFencePath([{ x: 10, y: 10 }], 2)).toBeNull();
    expect(drawnFencePath(line({ x: 10, y: 10 }, { x: 14, y: 12 }), 2)).toBeNull();
  });

  it("copies its points, so the caller cannot mutate the drag buffer through them", () => {
    const raw = elbow();
    const path = drawnFencePath(raw, 2)!;
    path[0].x = -999;
    expect(raw[0].x).toBe(100);
  });
});

describe("joining the drawn path to its projection", () => {
  it("drops the duplicated seam point", () => {
    // castRayWithReflections starts its waypoints AT the origin it was given,
    // which is the drawn path's last point; repeating it would be a
    // zero-length segment, which the growth loop reads as "already arrived".
    const drawn = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }];
    const cast = [{ x: 300, y: 300 }, { x: 300, y: 855 }];
    expect(joinProjection(drawn, cast)).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
      { x: 300, y: 855 },
    ]);
  });

  it("copies, so the joined path shares no point object with its inputs", () => {
    const drawn = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
    const joined = joinProjection(drawn, [{ x: 2, y: 2 }, { x: 3, y: 3 }]);
    joined[0].x = 99;
    expect(drawn[0].x).toBe(1);
  });

  it("reads the tangents off the right ends", () => {
    const path = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }];
    // Leaves the far end heading +y, and the near end heading -x (backwards).
    expect(outgoingDirection(path).x).toBeCloseTo(0);
    expect(outgoingDirection(path).y).toBeCloseTo(1);
    expect(incomingDirection(path).x).toBeCloseTo(-1);
    expect(incomingDirection(path).y).toBeCloseTo(0);
  });
});
