/**
 * A bent wall must survive being turned.
 *
 * Every map is dealt in one of four orientations, so the same authored wall is
 * built rotated three times out of four. The property that has to hold is
 * commutation:
 *
 *     bend(rotate(entity))  ==  rotate(bend(entity))
 *
 * Bend it then turn it, or turn it then bend it, and you get the same wall.
 * Anything else means a map that reads well in one orientation has a wall
 * bowing into the wrong half of the board in another - and because rotation is
 * seeded per run, it would only show up on some runs of some maps.
 *
 * This is written as a property over all four rotations and both shape
 * orientations rather than as expected coordinates, because the sign rule is
 * exactly the thing under test. A table of expected numbers derived from the
 * same reasoning as the code would agree with the code and prove nothing: the
 * first version of that table was self-consistent for wide shapes and still
 * wrong, because two left turns disagreed with one half turn.
 */
import { describe, it, expect } from "vitest";
import { rotateEntity, rotatePoint, type MapRotation } from "@/lib/mapRotation";
import { rotateBend, rotateBendAxis, rotateCurves } from "@/lib/bendRotation";
import { bendOutline } from "@/lib/bend";
import type { Vector2 } from "@/lib/polygon";
import type { LevelEntity, WallRectEntity, WallPolygonEntity } from "@/types/level";

const ROTATIONS: MapRotation[] = [0, 1, 2, 3];

/** A wide bar and a tall one: the sign rule differs between them. */
const WIDE: WallRectEntity = {
  id: "wide", kind: "wall", shape: "rect", x: 100, y: 288, width: 400, height: 24,
};
const TALL: WallRectEntity = {
  id: "tall", kind: "wall", shape: "rect", x: 288, y: 100, width: 24, height: 400,
};
const POLY: WallPolygonEntity = {
  id: "poly", kind: "wall", shape: "polygon",
  points: [[120, 200], [480, 210], [470, 250], [130, 244]],
};

/** The outline an entity would be built with, before rotation is considered. */
function outlineOf(e: LevelEntity): Vector2[] {
  const base: Vector2[] = e.shape === "rect"
    ? [{ x: e.x, y: e.y }, { x: e.x + e.width, y: e.y },
       { x: e.x + e.width, y: e.y + e.height }, { x: e.x, y: e.y + e.height }]
    : e.shape === "polygon"
      ? e.points.map(([x, y]) => ({ x, y }))
      : [];
  return bendOutline(base, {
    bend: e.kind === "wall" || e.kind === "mover" ? e.bend : undefined,
    bendAxis: e.kind === "wall" || e.kind === "mover" ? e.bendAxis : undefined,
    curves: e.kind === "wall" || e.kind === "mover" ? e.curves : undefined,
  });
}

const rotateAll = (pts: Vector2[], r: MapRotation) =>
  pts.map(p => rotatePoint(p.x, p.y, r));

/** Outlines match as SETS: rotation can start the ring at a different vertex. */
function expectSameShape(a: Vector2[], b: Vector2[], label: string) {
  expect(a.length, `${label}: vertex count`).toBe(b.length);
  const key = (p: Vector2) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
  expect(new Set(a.map(key)).size, `${label}: degenerate`).toBeGreaterThan(3);
  expect([...a.map(key)].sort(), label).toEqual([...b.map(key)].sort());
}

describe("bending commutes with rotating the map", () => {
  for (const [name, base] of [["a wide bar", WIDE], ["a tall bar", TALL]] as const) {
    for (const bend of [0.4, -0.55]) {
      it(`${name} bent ${bend} comes out the same either way round`, () => {
        for (const r of ROTATIONS) {
          const bendThenTurn = rotateAll(outlineOf({ ...base, bend }), r);
          const turnThenBend = outlineOf(rotateEntity({ ...base, bend }, r));
          expectSameShape(turnThenBend, bendThenTurn, `${name} bend ${bend} rotation ${r}`);
        }
      });
    }
  }

  it("holds for a polygon with per-edge curves", () => {
    const curved: WallPolygonEntity = { ...POLY, curves: [0.3, 0, -0.2, 0] };
    for (const r of ROTATIONS) {
      expectSameShape(
        outlineOf(rotateEntity(curved, r)),
        rotateAll(outlineOf(curved), r),
        `curves rotation ${r}`,
      );
    }
  });

  it("holds for both gestures at once", () => {
    const both: WallPolygonEntity = { ...POLY, bend: 0.35, curves: [0.25, 0, 0, 0] };
    for (const r of ROTATIONS) {
      expectSameShape(
        outlineOf(rotateEntity(both, r)),
        rotateAll(outlineOf(both), r),
        `both rotation ${r}`,
      );
    }
  });

  it("holds for an explicit axis, which the auto rule would get wrong", () => {
    // bendAxis "y" on a WIDE bar is the case auto can never produce, so it is
    // the one that catches an axis that fails to swap on a quarter turn.
    const across: WallRectEntity = { ...WIDE, bend: 0.4, bendAxis: "y" };
    for (const r of ROTATIONS) {
      expectSameShape(
        outlineOf(rotateEntity(across, r)),
        rotateAll(outlineOf(across), r),
        `explicit axis rotation ${r}`,
      );
    }
  });
});

describe("the rotation rules compose like rotations do", () => {
  // Independent of the outlines: turning left twice must equal a half turn.
  // This is the check the first hand-derived sign table failed.
  it("two left turns equal one half turn", () => {
    const once = rotateBend(0.4, true, 1);            // wide -> becomes tall
    const twice = rotateBend(once, false, 1);          // now tall
    expect(twice).toBeCloseTo(rotateBend(0.4, true, 2)!, 9);
  });

  it("a left turn then a right turn is a no-op", () => {
    const left = rotateBend(0.4, true, 1);
    expect(rotateBend(left, false, 3)).toBeCloseTo(0.4, 9);
  });

  it("four left turns come back to where they started", () => {
    let b: number | undefined = 0.4;
    let wide = true;
    for (let i = 0; i < 4; i++) { b = rotateBend(b, wide, 1); wide = !wide; }
    expect(b).toBeCloseTo(0.4, 9);
  });
});

describe("what rotation leaves alone", () => {
  it("does not touch anything at rotation zero", () => {
    expect(rotateBend(0.4, true, 0)).toBe(0.4);
    expect(rotateBendAxis("x", 0)).toBe("x");
    expect(rotateCurves([0.2, -0.1], 0)).toEqual([0.2, -0.1]);
  });

  it("leaves an absent bend absent rather than writing a zero into the map", () => {
    expect(rotateBend(undefined, true, 2)).toBeUndefined();
    expect(rotateBendAxis(undefined, 1)).toBeUndefined();
    expect(rotateCurves(undefined, 1)).toBeUndefined();
  });

  it("keeps auto as auto, since it re-reads the rotated shape itself", () => {
    for (const r of ROTATIONS) expect(rotateBendAxis("auto", r)).toBe("auto");
  });

  it("does not add bend fields to an entity that had none", () => {
    // A straight wall must round-trip through rotation byte for byte, or every
    // map.yml written back out by the admin grows noise on three maps in four.
    const rotated = rotateEntity(WIDE, 2);
    expect("bend" in rotated).toBe(false);
    expect("bendAxis" in rotated).toBe(false);
    expect("curves" in rotated).toBe(false);
  });
});
