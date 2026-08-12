/**
 * Sharing the trajectory collision set across a frame.
 *
 * The path preview is drawn per tracked ball, and the surface set used to be
 * rebuilt inside every one of those calls. A fully upgraded SCRUM Master tracks
 * EVERY active ball four bounces deep, so on a busy board that meant rebuilding
 * an array of every fence, board edge and obstacle edge once per ball, sixty
 * times a second - identical work, identical result, thrown away each time.
 *
 * Two things have to hold for sharing to be safe. The set must not depend on
 * which ball is being predicted (it used to bake the ball's radius in), and
 * passing it must produce exactly the path that building it inline would.
 */
import { describe, it, expect } from "vitest";
import { buildTrajectorySegments, computeBallTrajectory } from "@/lib/gameUtils";
import type { Wall } from "@/lib/wallGeometry";
import type { Polygon } from "@/lib/polygon";

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, thickness = 6): Wall =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness }) as Wall;

const boardEdges = (w: number, h: number): Wall[] => [
  wall("board-top", 0, 0, w, 0, 0),
  wall("board-right", w, 0, w, h, 0),
  wall("board-bottom", w, h, 0, h, 0),
  wall("board-left", 0, h, 0, 0, 0),
];

const square: Polygon = {
  vertices: [{ x: 300, y: 300 }, { x: 360, y: 300 }, { x: 360, y: 360 }, { x: 300, y: 360 }],
} as Polygon;

describe("the built set is ball-independent", () => {
  /**
   * The property that makes sharing possible. `pad` is the SURFACE's own
   * half-thickness; the ball's radius is added at test time. Baking the radius in
   * (as the old inline build did) would make every ball need its own set.
   */
  it("does not depend on any ball's radius", () => {
    const segs = buildTrajectorySegments(boardEdges(800, 800), [square]);
    expect(segs.every(s => Number.isFinite(s.pad))).toBe(true);
    // A board edge collides at exactly the ball radius, so it contributes no pad.
    expect(segs.find(s => s.id === "board-top")!.pad).toBe(0);
  });

  it("gives a fence half its thickness, matching collideBallWithWall", () => {
    const segs = buildTrajectorySegments([wall("fence-1", 0, 100, 800, 100, 10)], []);
    expect(segs[0].pad).toBe(5);
  });

  it("expands obstacle polygons into one segment per edge", () => {
    const segs = buildTrajectorySegments([], [square]);
    expect(segs).toHaveLength(4);
    expect(segs.every(s => s.pad === 0)).toBe(true);
  });

  // Obstacle bodies are handled through their polygons; including the boundary
  // walls too would double up every obstacle surface.
  it("skips obstacle-boundary walls", () => {
    const segs = buildTrajectorySegments([wall("obstacle-3-edge-0", 0, 0, 50, 0)], []);
    expect(segs).toHaveLength(0);
  });
});

describe("passing the set changes nothing about the path", () => {
  const walls = boardEdges(800, 800);
  const R = 18;

  const both = (pos: { x: number; y: number }, vel: { x: number; y: number }, bounces: number) => {
    const inline = computeBallTrajectory(pos, vel, walls, bounces, R, [square]);
    const shared = computeBallTrajectory(
      pos, vel, walls, bounces, R, [square], [], 1, [],
      buildTrajectorySegments(walls, [square]),
    );
    return { inline, shared };
  };

  it("matches for a straight shot into a wall", () => {
    const { inline, shared } = both({ x: 100, y: 100 }, { x: 0, y: 1 }, 1);
    expect(shared).toEqual(inline);
    expect(shared.length).toBeGreaterThan(1); // it actually hit something
  });

  it("matches across several bounces", () => {
    const { inline, shared } = both({ x: 120, y: 130 }, { x: 1, y: 1.3 }, 4);
    expect(shared).toEqual(inline);
  });

  it("matches when the path meets an obstacle", () => {
    const { inline, shared } = both({ x: 330, y: 100 }, { x: 0, y: 1 }, 3);
    expect(shared).toEqual(inline);
  });

  // Different-sized balls sharing ONE set is the whole point; if the radius were
  // still baked in, the smaller ball would bounce off the larger one's capsules.
  it("keeps each ball's own radius when the set is shared", () => {
    const segs = buildTrajectorySegments(walls, [square]);
    // Well clear of the obstacle (x 300-360) for BOTH radii - at x=400 the larger
    // ball grazes its right edge and stops there instead of at the board.
    const shot = { x: 600, y: 100 };
    const down = { x: 0, y: 1 };

    const small = computeBallTrajectory(shot, down, walls, 1, 5, [square], [], 1, [], segs);
    const large = computeBallTrajectory(shot, down, walls, 1, 40, [square], [], 1, [], segs);

    // Both stop at the board's bottom edge, the larger one a radius earlier.
    expect(large[1].y).toBeLessThan(small[1].y);
    expect(small[1].y - large[1].y).toBeCloseTo(35, 5);
  });
});
