/**
 * A fence in a mover's path drags it, and says so where they meet.
 *
 * Movers used to ignore fences outright: a patrol slid through a finished fence
 * as if it were not there. Testers read that as the fence being decorative, and
 * it made the one interesting thing about a mover - that it patrols a line you
 * have to cut across - cost nothing to cut across.
 *
 * The two failure modes worth guarding are opposite, and both look fine in
 * motion: a drag that never bites (the fence is still decorative) and one that
 * bites all the way to zero (the mover can be parked forever with enough cuts,
 * and stops being a hazard). Hence a floor, and a test for each end.
 *
 * The third is quieter than either: counting the board edge or an obstacle's
 * boundary as a fence. Every mover on the board would then be permanently
 * dragged, by nothing the player did, and nobody would know why the map felt
 * sluggish.
 */
import { describe, it, expect } from "vitest";
import { moverFenceDrag } from "@/lib/physics/moverFriction";
import { buildMoverPolygon, type MoverState } from "@/lib/physics/moverState";
import type { Wall } from "@/lib/wallGeometry";

const PER_FENCE = 0.45;
const FLOOR = 0.3;

const mover = (over: Partial<MoverState> = {}): MoverState => {
  const m: MoverState = {
    id: "m1", shape: "circle", homeX: 100, homeY: 100, radius: 20,
    axis: "horizontal", range: 200, speed: 60, offset: 0, direction: 1,
    polygon: { vertices: [] },
    ...over,
  } as MoverState;
  m.polygon = buildMoverPolygon(m);
  return m;
};

const fence = (over: Partial<Wall> = {}): Wall => ({
  id: "wall-1", start: { x: 0, y: 0 }, end: { x: 0, y: 200 }, thickness: 6,
  ...over,
} as Wall);

describe("a fence slows a mover down", () => {
  it("leaves a mover alone when nothing is in its path", () => {
    const drag = moverFenceDrag(mover(), [fence({ start: { x: 500, y: 0 }, end: { x: 500, y: 200 } })],
      PER_FENCE, FLOOR);
    expect(drag.factor).toBe(1);
    expect(drag.contacts).toEqual([]);
  });

  it("drags it while its body overlaps one", () => {
    // Fence straight down x=100, mover centred there: overlapping.
    const drag = moverFenceDrag(mover(), [fence({ start: { x: 100, y: 0 }, end: { x: 100, y: 200 } })],
      PER_FENCE, FLOOR);
    expect(drag.factor).toBeCloseTo(1 - PER_FENCE, 6);
    expect(drag.contacts).toHaveLength(1);
  });

  it("stacks, because shouldering through three is harder than one", () => {
    const walls = [90, 100, 110].map((x, i) =>
      fence({ id: `wall-${i}`, start: { x, y: 0 }, end: { x, y: 200 } }));
    const drag = moverFenceDrag(mover(), walls, 0.2, FLOOR);
    expect(drag.factor).toBeCloseTo(1 - 0.6, 6);
    expect(drag.contacts).toHaveLength(3);
  });

  it("never drags below the floor, however many fences pile on", () => {
    // Ten fences at 0.45 each would be -3.5x speed without the clamp.
    const walls = Array.from({ length: 10 }, (_, i) =>
      fence({ id: `wall-${i}`, start: { x: 96 + i, y: 0 }, end: { x: 96 + i, y: 200 } }));
    const drag = moverFenceDrag(mover(), walls, PER_FENCE, FLOOR);
    expect(drag.factor).toBe(FLOOR);
    expect(drag.factor, "a mover that can be stopped dead is not a hazard").toBeGreaterThan(0);
  });

  it("counts the fence's thickness, not just its centre line", () => {
    // Centre line 24 away from a radius-20 mover: only touching once the
    // fence's own half-thickness (3) is added.
    const near = fence({ start: { x: 122, y: 0 }, end: { x: 122, y: 200 } });
    expect(moverFenceDrag(mover(), [near], PER_FENCE, FLOOR).factor).toBeLessThan(1);
    const clear = fence({ start: { x: 124, y: 0 }, end: { x: 124, y: 200 } });
    expect(moverFenceDrag(mover(), [clear], PER_FENCE, FLOOR).factor).toBe(1);
  });
});

describe("only the player's own fences count", () => {
  it("ignores the board edge", () => {
    const edge = fence({ id: "board-left", isBoardEdge: true, start: { x: 100, y: 0 }, end: { x: 100, y: 200 } });
    expect(moverFenceDrag(mover(), [edge], PER_FENCE, FLOOR).factor).toBe(1);
  });

  it("ignores an obstacle's boundary", () => {
    // A mover parked beside a pillar would otherwise grind against it all map.
    const wall = fence({ id: "obstacle-3", start: { x: 100, y: 0 }, end: { x: 100, y: 200 } });
    expect(moverFenceDrag(mover(), [wall], PER_FENCE, FLOOR).factor).toBe(1);
  });
});

describe("rect movers, which have no radius to measure with", () => {
  const slab = () => mover({ shape: "rect", width: 80, height: 20, radius: undefined });

  it("drags when the slab's edge crosses the fence", () => {
    const drag = moverFenceDrag(slab(), [fence({ start: { x: 100, y: 0 }, end: { x: 100, y: 200 } })],
      PER_FENCE, FLOOR);
    expect(drag.factor).toBeCloseTo(1 - PER_FENCE, 6);
    expect(drag.contacts).toHaveLength(1);
  });

  it("stays free when the fence misses it", () => {
    const drag = moverFenceDrag(slab(), [fence({ start: { x: 400, y: 0 }, end: { x: 400, y: 200 } })],
      PER_FENCE, FLOOR);
    expect(drag.factor).toBe(1);
  });
});

describe("what the sparks are told", () => {
  it("puts the contact on the fence, not at the mover's centre", () => {
    // The grind is where the two meet; drawing it at the mover's middle would
    // put sparks inside the machine.
    const wall = fence({ start: { x: 110, y: 0 }, end: { x: 110, y: 200 } });
    const [contact] = moverFenceDrag(mover(), [wall], PER_FENCE, FLOOR).contacts;
    expect(contact.x).toBeCloseTo(110, 6);
    expect(contact.y).toBeCloseTo(100, 6);
  });

  it("scales intensity with the drag actually being felt", () => {
    const one = moverFenceDrag(mover(), [fence({ start: { x: 100, y: 0 }, end: { x: 100, y: 200 } })],
      PER_FENCE, FLOOR);
    const many = moverFenceDrag(
      mover(),
      [96, 100, 104].map((x, i) => fence({ id: `w${i}`, start: { x, y: 0 }, end: { x, y: 200 } })),
      PER_FENCE, FLOOR,
    );
    expect(many.contacts[0].intensity).toBeGreaterThan(one.contacts[0].intensity);
    // ...and never past full, so a mover pinned at the floor stops escalating.
    expect(many.contacts[0].intensity).toBeLessThanOrEqual(1);
  });
});

describe("the drag can be turned off from config", () => {
  it("is inert at a floor of 1", () => {
    const drag = moverFenceDrag(mover(), [fence({ start: { x: 100, y: 0 }, end: { x: 100, y: 200 } })],
      PER_FENCE, 1);
    expect(drag.factor).toBe(1);
  });
});
