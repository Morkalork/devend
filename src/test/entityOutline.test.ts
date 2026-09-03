/**
 * What shape an entity actually is, once its bend and turn are applied.
 *
 * Authored numbers stop describing an object the moment it is deformed, and
 * this has been got wrong three times in three places, the same way each time:
 * the launcher's runway read `facing` and missed that a canted barrel fires
 * somewhere else; the editor's bumper rings were drawn on the authored centre
 * and sat off any bowed obstacle; and a map guard compared authored rectangles
 * to decide whether one solid was buried in another.
 *
 * That last one is the case pinned below. Level 6 has a wall bowed at 0.428 and
 * a barrel turned -120 degrees. As RECTANGLES they overlap by 25x50 units; as
 * SHAPES they do not touch, which is plainly visible in the editor. The guard
 * failed a layout that was fine - the worse direction for a guard to fail in,
 * because it teaches the author to stop believing it.
 */
import { describe, it, expect } from "vitest";
import { entityOutline, entityOutlineBounds, authoredPoints } from "@/lib/entityOutline";

const rect = (over: Record<string, unknown> = {}) =>
  ({ shape: "rect", x: 100, y: 100, width: 200, height: 50, ...over });

describe("an undeformed entity", () => {
  it("measures exactly as it is authored", () => {
    // The guarantee that keeps every plain map measuring as it always did.
    expect(entityOutlineBounds(rect())).toEqual({ x0: 100, y0: 100, x1: 300, y1: 150 });
  });

  it("returns the authored corners untouched, not a resampled copy", () => {
    // Cheap, and it means an unbent map cannot drift by a rounding error.
    expect(entityOutline(rect())).toEqual(authoredPoints(rect()));
  });

  it("measures a circle by its radius", () => {
    const b = entityOutlineBounds({ shape: "circle", cx: 200, cy: 200, radius: 40 })!;
    expect(b.x0).toBeCloseTo(160, 6);
    expect(b.x1).toBeCloseTo(240, 6);
    expect(b.y0).toBeCloseTo(160, 6);
    expect(b.y1).toBeCloseTo(240, 6);
  });

  it("measures a polygon by its points", () => {
    expect(entityOutlineBounds({ shape: "polygon", points: [[0, 0], [50, 10], [20, 80]] }))
      .toEqual({ x0: 0, y0: 0, x1: 50, y1: 80 });
  });

  it("says nothing rather than guessing when there is no geometry", () => {
    // A malformed entity must not measure as a zero-size box at the origin,
    // which would read as a solid sitting in the top-left corner of every map.
    expect(entityOutlineBounds({ shape: "rect" })).toBeNull();
    expect(entityOutlineBounds({})).toBeNull();
  });
});

describe("a deformed entity", () => {
  it("moves when it is turned", () => {
    // A long rect turned 90 degrees is a tall one. Reading the authored numbers
    // gets both the width and the height wrong.
    const flat = entityOutlineBounds(rect())!;
    const turned = entityOutlineBounds(rect({ angle: 90 }))!;
    expect(turned.x1 - turned.x0).toBeCloseTo(flat.y1 - flat.y0, 4);
    expect(turned.y1 - turned.y0).toBeCloseTo(flat.x1 - flat.x0, 4);
  });

  it("bulges when it is bent", () => {
    const straight = entityOutlineBounds(rect())!;
    const bowed = entityOutlineBounds(rect({ bend: 0.5 }))!;
    expect(bowed.y1 - bowed.y0).toBeGreaterThan(straight.y1 - straight.y0);
  });

  it("keeps a turned shape centred where it was", () => {
    // A turn is about the object's own middle. If it drifted, every guard using
    // this would report clashes with whatever the object slid into.
    const flat = entityOutlineBounds(rect())!;
    const turned = entityOutlineBounds(rect({ angle: 37 }))!;
    expect((turned.x0 + turned.x1) / 2).toBeCloseTo((flat.x0 + flat.x1) / 2, 4);
    expect((turned.y0 + turned.y1) / 2).toBeCloseTo((flat.y0 + flat.y1) / 2, 4);
  });
});

describe("the level-6 layout that was wrongly flagged", () => {
  const wall = { shape: "rect", x: 450, y: 175, width: 75, height: 525, bend: 0.428 };
  const barrel = { shape: "rect", x: 500, y: 650, width: 240, height: 110, angle: -120 };

  const overlap = (a: { x0: number; y0: number; x1: number; y1: number },
                   b: { x0: number; y0: number; x1: number; y1: number }) => ({
    x: Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0),
    y: Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0),
  });

  it("overlaps as authored rectangles", () => {
    // The reading that produced the false failure, kept so the fix cannot be
    // mistaken for the numbers having changed.
    const asAuthored = (e: typeof wall | typeof barrel) =>
      ({ x0: e.x, y0: e.y, x1: e.x + e.width, y1: e.y + e.height });
    const o = overlap(asAuthored(wall), asAuthored(barrel));
    expect(o.x).toBeGreaterThan(8);
    expect(o.y).toBeGreaterThan(8);
  });

  it("does not overlap once the bend and the turn are applied", () => {
    // The guard treats an interpenetration of more than 8 units on BOTH axes as
    // a burial. The real shapes clear that on x by a wide margin.
    const o = overlap(entityOutlineBounds(wall)!, entityOutlineBounds(barrel)!);
    expect(o.x, "the deformed shapes still read as buried").toBeLessThan(8);
  });
});
