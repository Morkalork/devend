/**
 * A bearing on a rect has to turn with the board.
 *
 * Every map above ROTATION_MIN_LEVEL is dealt in one of four orientations, and
 * an entity that names ONE OF ITS SIDES is only correct if that name turns too.
 * A launcher's `facing` is the open side it fires out of; a delivery box's
 * `mouth` is the side its membrane sits on. They are the same kind of field and
 * must rotate by the same rule.
 *
 * ── The bug this was written for ───────────────────────────────────────────
 *
 * `mouth` was NOT rotated, and never had been. It rode through rotateEntity on
 * the object spread untouched, so in three of the four orientations a box's
 * membrane sat on the wrong side: the side the designer meant to be solid let
 * balls straight through, and the side meant to admit them bounced them off.
 * Level 23 is nineteen levels above ROTATION_MIN_LEVEL, so that was live on
 * three deals out of four for the whole life of the feature. It was found while
 * adding `facing`, which would have inherited exactly the same hole.
 *
 * The check is against the GEOMETRY - does the named side still sit where that
 * side physically moved to - rather than against a table of expected bearings,
 * because a table is the same derivation written twice and agrees with itself
 * when both copies are wrong.
 */
import { describe, it, expect } from "vitest";
import { rotateEntity, rotateWellPull, rotatePoint, type MapRotation } from "@/lib/mapRotation";
import { type Bearing } from "@/lib/physics/obstacleRules";

type Rect = { x: number; y: number; width: number; height: number };
import type { LevelEntity } from "@/types/level";

const ROTATIONS: MapRotation[] = [0, 1, 2, 3];   // quarter turns, not degrees
const BEARINGS: Bearing[] = ["up", "down", "left", "right"];

const launcher = (facing: Bearing): LevelEntity => ({
  id: "cup", kind: "launcher", shape: "rect",
  x: 100, y: 200, width: 110, height: 92, facing,
} as LevelEntity);

const box = (mouth: Bearing): LevelEntity => ({
  id: "box", kind: "box", shape: "rect",
  x: 100, y: 200, width: 160, height: 160, mouth, capacity: 2,
} as LevelEntity);

/**
 * The midpoint of the side a bearing names, on a given rect.
 *
 * This is what makes the tests below independent of the code under test. The
 * obvious check - rotate the bearing, rotate its unit vector, compare - is the
 * SAME derivation rotateWellPull already does, so it agrees with itself even
 * when both are wrong. Asking "is the named side still the same physical side
 * of the shape" only needs rotatePoint, which is the ground truth all the
 * map's geometry already moves by.
 */
function sideMidpoint(
  rect: { x: number; y: number; width: number; height: number }, b: Bearing,
): { x: number; y: number } {
  const { x, y, width: w, height: h } = rect;
  switch (b) {
    case "up":    return { x: x + w / 2, y };
    case "down":  return { x: x + w / 2, y: y + h };
    case "left":  return { x, y: y + h / 2 };
    case "right": return { x: x + w, y: y + h / 2 };
  }
}

describe("a launcher's open side turns with the board", () => {
  it("agrees with the rule one-way membranes already use", () => {
    for (const facing of BEARINGS) {
      for (const r of ROTATIONS) {
        const turned = rotateEntity(launcher(facing), r);
        expect(
          (turned as { facing: Bearing }).facing,
          `launcher facing ${facing} at turn ${r}`,
        ).toBe(rotateWellPull(facing, r));
      }
    }
  });

  it("still names the same physical side after the board turns", () => {
    // The muzzle is a hole in the shape. Wherever that hole ends up, `facing`
    // has to be the word for it.
    for (const facing of BEARINGS) {
      const before = launcher(facing) as unknown as Rect;
      for (const r of ROTATIONS) {
        const after = rotateEntity(launcher(facing), r) as unknown as Rect & { facing: Bearing };
        const wasAt = sideMidpoint(before, facing);
        const moved = rotatePoint(wasAt.x, wasAt.y, r);
        const nowAt = sideMidpoint(after, after.facing);
        expect(nowAt.x, `${facing} turn ${r}: x`).toBeCloseTo(moved.x, 6);
        expect(nowAt.y, `${facing} turn ${r}: y`).toBeCloseTo(moved.y, 6);
      }
    }
  });

  it("comes back to where it started after four quarter turns", () => {
    for (const facing of BEARINGS) {
      let e = launcher(facing);
      for (let i = 0; i < 4; i++) e = rotateEntity(e, 1);
      expect((e as { facing: Bearing }).facing).toBe(facing);
    }
  });
});

describe("a delivery box's membrane turns with the board", () => {
  it("still names the same physical side after the board turns", () => {
    // THE regression. Before this, `mouth` came back unchanged at every
    // rotation and three deals in four put the membrane on the wrong side.
    for (const mouth of BEARINGS) {
      const before = box(mouth) as unknown as Rect;
      for (const r of ROTATIONS) {
        const after = rotateEntity(box(mouth), r) as unknown as Rect & { mouth: Bearing };
        const wasAt = sideMidpoint(before, mouth);
        const moved = rotatePoint(wasAt.x, wasAt.y, r);
        const nowAt = sideMidpoint(after, after.mouth);
        expect(nowAt.x, `${mouth} turn ${r}: x`).toBeCloseTo(moved.x, 6);
        expect(nowAt.y, `${mouth} turn ${r}: y`).toBeCloseTo(moved.y, 6);
      }
    }
  });

  it("actually moves at all on a quarter turn", () => {
    // The blunt version of the same thing, kept because it is the assertion
    // that would have caught it in one line: a mouth that never changes is a
    // mouth that is not being rotated.
    const moved = BEARINGS.filter(
      m => (rotateEntity(box(m), 1) as { mouth: Bearing }).mouth !== m,
    );
    expect(moved).toHaveLength(4);
  });

  it("rotates a mouth and a facing identically", () => {
    // They are the same kind of field. If these two ever disagree, one of them
    // has been given its own derivation.
    for (const b of BEARINGS) {
      for (const r of ROTATIONS) {
        const m = (rotateEntity(box(b), r) as { mouth: Bearing }).mouth;
        const f = (rotateEntity(launcher(b), r) as { facing: Bearing }).facing;
        expect(m, `${b} at turn ${r}`).toBe(f);
      }
    }
  });
});
