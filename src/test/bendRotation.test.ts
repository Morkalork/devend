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
import { normaliseDegrees, rotateAngle, rotateBend, rotateBendAxis, rotateCurves } from "@/lib/bendRotation";
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
      // Circles were [] here, which quietly excused the circle branch of
      // rotateAngle from the commutation property - the one branch whose rule
      // differs from the other two, and the one I got wrong by reasoning.
      // Sampled the way initGame samples it.
      : Array.from({ length: 64 }, (_, i) => {
          const a = (i / 64) * Math.PI * 2;
          return { x: e.cx + Math.cos(a) * e.radius, y: e.cy + Math.sin(a) * e.radius };
        });
  return bendOutline(base, {
    bend: e.kind === "wall" || e.kind === "mover" ? e.bend : undefined,
    bendAxis: e.kind === "wall" || e.kind === "mover" ? e.bendAxis : undefined,
    curves: e.kind === "wall" || e.kind === "mover" ? e.curves : undefined,
    angle: e.kind === "wall" || e.kind === "mover" ? e.angle : undefined,
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

describe("turning an object commutes with turning the map", () => {
  // The same property the bend is held to, for the same reason: a turned wall
  // has to come out looking like the same wall, just rotated, whichever of the
  // four ways the board is dealt.
  //
  // This one has a wrinkle the bend does not. A rect and a polygon absorb the
  // board's quarter turn differently - rotateEntity gives a rect another
  // AXIS-ALIGNED rect with width and height swapped (shape changed, orientation
  // unchanged), while it rotates a polygon's points outright (orientation baked
  // in). So the angle gains the board turn for one and not the other, and this
  // test is what says which.
  for (const angle of [30, -45, 90, 157]) {
    it(`holds for a rect turned ${angle}`, () => {
      for (const r of ROTATIONS) {
        expectSameShape(
          outlineOf(rotateEntity({ ...WIDE, angle }, r)),
          rotateAll(outlineOf({ ...WIDE, angle }), r),
          `rect angle ${angle} rotation ${r}`,
        );
      }
    });

    it(`holds for a polygon turned ${angle}`, () => {
      for (const r of ROTATIONS) {
        expectSameShape(
          outlineOf(rotateEntity({ ...POLY, angle }, r)),
          rotateAll(outlineOf({ ...POLY, angle }), r),
          `polygon angle ${angle} rotation ${r}`,
        );
      }
    });
  }

  it("holds for a bent circle, whose rule is the odd one out", () => {
    // A plain circle is rotationally symmetric and would pass under any rule at
    // all. Bending it gives it an orientation to get wrong.
    const circle = {
      id: "c", kind: "wall", shape: "circle", cx: 400, cy: 350, radius: 90,
      bend: 0.4, angle: 40,
    } as unknown as LevelEntity;
    for (const r of ROTATIONS) {
      expectSameShape(
        outlineOf(rotateEntity(circle, r)),
        rotateAll(outlineOf(circle), r),
        `bent circle rotation ${r}`,
      );
    }
  });

  it("holds for a bent SQUARE rect, the other shape auto cannot turn", () => {
    // Same defect as the circle and the same fix: a square has no longer side,
    // so bendsAlongX resolves the tie to x on every rotation and the bow never
    // follows the board. Non-square rects were fine all along, which is why the
    // original bend tests missed it.
    const square: WallRectEntity = {
      id: "sq", kind: "wall", shape: "rect", x: 300, y: 300, width: 200, height: 200,
      bend: 0.45,
    };
    for (const r of ROTATIONS) {
      expectSameShape(
        outlineOf(rotateEntity(square, r)),
        rotateAll(outlineOf(square), r),
        `bent square rotation ${r}`,
      );
    }
  });

  it("holds for a turn and a bend together", () => {
    const both: WallRectEntity = { ...WIDE, bend: 0.4, angle: 35 };
    for (const r of ROTATIONS) {
      expectSameShape(
        outlineOf(rotateEntity(both, r)),
        rotateAll(outlineOf(both), r),
        `bend+angle rotation ${r}`,
      );
    }
  });
});

describe("the angle the rotation rule produces", () => {
  it("leaves the angle alone for every shape", () => {
    // A board rotation is rigid: it adds the same quarter turn to everything on
    // the board, including the object that was already turned. So the stored
    // angle carries through untouched. The first two rules tried to compensate
    // for how much of the turn each shape had "already absorbed" - a rect's
    // width/height swap, a polygon's rotated points - and the commutation
    // property above rejected both.
    for (const r of ROTATIONS) {
      expect(rotateAngle(30, "polygon", r)).toBe(30);
      expect(rotateAngle(30, "rect", r)).toBe(30);
      expect(rotateAngle(30, "circle", r)).toBe(30);
    }
  });

  it("normalises degrees, so map.yml never accumulates 450", () => {
    // Not used by rotateAngle any more, but the editor writes through it: a
    // knob dragged round twice must not leave 450 in the file, and 180 must not
    // come back as -180, which is the same angle and a different diff.
    expect(normaliseDegrees(180)).toBe(180);
    expect(normaliseDegrees(-180)).toBe(180);
    expect(normaliseDegrees(450)).toBe(90);
    expect(normaliseDegrees(-270)).toBe(90);
    expect(Object.is(normaliseDegrees(-360), 0)).toBe(true);
  });

  it("leaves an absent angle absent rather than writing a zero into the map", () => {
    expect(rotateAngle(undefined, "circle", 2)).toBeUndefined();
  });
});
