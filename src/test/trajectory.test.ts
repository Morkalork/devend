import { describe, it, expect } from "vitest";
import { computeBallTrajectory } from "@/lib/gameUtils";
import type { Wall } from "@/lib/wallGeometry";
import type { Vector2 } from "@/lib/polygon";

// Minimal Wall factory — the trajectory only reads id/start/end/thickness.
const wall = (id: string, x1: number, y1: number, x2: number, y2: number, thickness = 6): Wall =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness } as Wall);

// A 200x200 board as four board edges (prefix "board-" → radius-only capsule).
const boardEdges: Wall[] = [
  wall("board-edge-0", 0, 0, 200, 0),      // top    (y=0)
  wall("board-edge-1", 200, 0, 200, 200),  // right  (x=200)
  wall("board-edge-2", 200, 200, 0, 200),  // bottom (y=200)
  wall("board-edge-3", 0, 200, 0, 0),      // left   (x=0)
];

const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;
const R = 10;

describe("computeBallTrajectory", () => {
  it("stops the ball CENTRE one radius from the wall (not on the line)", () => {
    // Straight down onto the bottom edge (y=200): centre stops at y=190.
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 1 }, boardEdges, 1, R);
    expect(path.length).toBe(2);
    expect(near(path[1].x, 100)).toBe(true);
    expect(near(path[1].y, 190)).toBe(true);
  });

  it("offsets by radius/cos(angle), so a 45° approach lands the centre a full radius out", () => {
    // The old flat "minus radius" offset put the centre too close to the wall at
    // an angle; the capsule model keeps it exactly R away.
    const path = computeBallTrajectory({ x: 50, y: 50 }, { x: 1, y: 1 }, boardEdges, 1, R);
    // Down-right 45° hits the bottom edge; centre stops at y=190, x follows.
    expect(near(path[1].y, 190)).toBe(true);
    expect(near(path[1].x, 190)).toBe(true);
  });

  it("reflects angle-in = angle-out (bottom then top edge)", () => {
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 1 }, boardEdges, 2, R);
    expect(path.length).toBe(3);
    expect(near(path[1].y, 190)).toBe(true); // bounce off bottom (centre y=190)
    expect(near(path[2].y, 10)).toBe(true);  // reflects up to the top (centre y=10)
    expect(near(path[2].x, 100)).toBe(true);
  });

  it("bounces off a fence END-CAP even when moving parallel to the fence", () => {
    // A short horizontal fence; the ball skims parallel just above its left end.
    // The old infinite-line model saw the ray as parallel and predicted NO hit;
    // the capsule's rounded cap catches it.
    const fence = wall("wall-1", 100, 100, 140, 100, 6); // R = 10 + 3 = 13
    const path = computeBallTrajectory({ x: 0, y: 95 }, { x: 1, y: 0 }, [fence], 1, R);
    expect(path.length).toBe(2);
    // Clips the left end cap at (100,100): entry x = 100 - sqrt(13^2 - 5^2) = 88.
    expect(near(path[1].x, 88, 1)).toBe(true);
    expect(near(path[1].y, 95)).toBe(true);
  });

  it("returns just the start point when the ball isn't moving", () => {
    const path = computeBallTrajectory({ x: 50, y: 50 }, { x: 0, y: 0 }, boardEdges, 3, R);
    expect(path).toEqual<Vector2[]>([{ x: 50, y: 50 }]);
  });
});
