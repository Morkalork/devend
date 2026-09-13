/**
 * Capturing what a stuck ball is stuck to (splatScene.ts).
 *
 * The liquid splat is only as good as the scene it is handed, and the scene
 * is built once, in physics, from geometry the renderer never sees. So the
 * transform into contact space, the choice of what counts as a solid, and the
 * surface walk that gives the film its reach are each pinned here.
 */
import { describe, it, expect } from "vitest";
import {
  captureSplatScene, surfaceSamples, insideSolid, SCENE_REACH_RADII,
} from "@/lib/splatScene";

const R = 18;
const UP = { x: 0, y: -1 };
const wall = (x1: number, y1: number, x2: number, y2: number, id = "fence", extra: object = {}) =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 6, ...extra });
const board = { vertices: [{ x: 45, y: 45 }, { x: 855, y: 45 }, { x: 855, y: 855 }, { x: 45, y: 855 }] };

describe("captureSplatScene: contact space", () => {
  it("puts the wall the ball rests on at y >= 0, along x", () => {
    // Ball on top of a horizontal fence at y = 500, resting 2 units off its face.
    const scene = captureSplatScene(
      { walls: [wall(100, 500, 800, 500)], obstaclePolygons: [], boardPolygon: board },
      { x: 450, y: 495 }, UP, R,
    );
    expect(scene.solids).toHaveLength(1);
    const ys = scene.solids[0].map(p => p.y);
    expect(Math.min(...ys)).toBeCloseTo(2, 6);
    expect(Math.max(...ys)).toBeCloseTo(8, 6);
    const xs = scene.solids[0].map(p => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-350, 6);
    expect(Math.max(...xs)).toBeCloseTo(350, 6);
  });

  it("rotates with the impact normal, so a wall on the ball's right is still 'below' it", () => {
    // Vertical fence at x = 600; ball to its left, normal pointing -x.
    const scene = captureSplatScene(
      { walls: [wall(600, 100, 600, 800)], obstaclePolygons: [], boardPolygon: board },
      { x: 595, y: 400 }, { x: -1, y: 0 }, R,
    );
    const ys = scene.solids[0].map(p => p.y);
    expect(Math.min(...ys)).toBeCloseTo(2, 6);
    expect(Math.max(...ys)).toBeCloseTo(8, 6);
  });

  it("drops walls and obstacles out of reach", () => {
    const far = R * SCENE_REACH_RADII + 20;
    const scene = captureSplatScene(
      {
        walls: [wall(100, 500, 800, 500), wall(100, 500 + far, 800, 500 + far, "far")],
        obstaclePolygons: [{ vertices: [{ x: 700, y: 100 }, { x: 750, y: 100 }, { x: 750, y: 150 }] }],
        boardPolygon: board,
      },
      { x: 450, y: 495 }, UP, R,
    );
    expect(scene.solids).toHaveLength(1);
  });

  it("skips a portal's rim: balls pass through it, so the liquid cannot cling to it", () => {
    const portal = { vertices: [{ x: 440, y: 500 }, { x: 460, y: 500 }, { x: 460, y: 520 }, { x: 440, y: 520 }] };
    const scene = captureSplatScene(
      {
        walls: [wall(440, 500, 460, 500, "obstacle-p-edge-0", { portal: {} })],
        obstaclePolygons: [portal],
        boardPolygon: board,
        portals: new Set([portal]),
      },
      { x: 450, y: 495 }, UP, R,
    );
    expect(scene.solids).toHaveLength(0);
  });

  it("adds the outside of the board when the contact is near an edge", () => {
    const scene = captureSplatScene(
      { walls: [], obstaclePolygons: [], boardPolygon: board },
      { x: 450, y: 855 }, UP, R,
    );
    // One slab: the bottom. Its face is at the contact line.
    expect(scene.solids).toHaveLength(1);
    expect(Math.min(...scene.solids[0].map(p => p.y))).toBeCloseTo(0, 6);
    // Mid-board, nothing.
    const mid = captureSplatScene(
      { walls: [], obstaclePolygons: [], boardPolygon: board },
      { x: 450, y: 450 }, UP, R,
    );
    expect(mid.solids).toHaveLength(0);
  });

  it("pushes a solid the contact is buried in back to the contact point", () => {
    // A board edge wall is centred on the board's edge, so its inner half
    // overlaps a ball parked on the board polygon. The scene must put its
    // face AT the contact, not three units into the ball.
    const scene = captureSplatScene(
      { walls: [wall(45, 855, 855, 855, "board-edge-2")], obstaclePolygons: [], boardPolygon: board },
      { x: 450, y: 855 }, UP, R,
    );
    for (const solid of scene.solids) {
      expect(insideSolid(0, -0.01, solid)).toBe(false);
      expect(Math.min(...solid.map(p => p.y))).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});

describe("surfaceSamples: the film's map of the surfaces", () => {
  it("measures distance ALONG the surface, so the far side of a fence end is further than it looks", () => {
    const scene = captureSplatScene(
      { walls: [wall(100, 500, 458, 500)], obstaclePolygons: [], boardPolygon: board },
      { x: 450, y: 495 }, UP, R,
    );
    // A sample on the underside, just past the end: straight-line distance
    // from the contact is about 10, surface distance is round the end face.
    const under = scene.samples.filter(q => q.y > 7.5 && q.x > 3 && q.x < 7.5);
    expect(under.length).toBeGreaterThan(0);
    for (const q of under) {
      const straight = Math.hypot(q.x, q.y);
      expect(q.s).toBeGreaterThan(straight + 1.5);
    }
  });

  it("gives every sample an outward normal", () => {
    const scene = captureSplatScene(
      { walls: [wall(100, 500, 458, 500)], obstaclePolygons: [], boardPolygon: board },
      { x: 450, y: 495 }, UP, R,
    );
    for (const q of scene.samples) {
      expect(Math.hypot(q.nx, q.ny)).toBeCloseTo(1, 6);
      // Stepping outward leaves every solid.
      for (const solid of scene.solids) {
        expect(insideSolid(q.x + q.nx * 0.5, q.y + q.ny * 0.5, solid)).toBe(false);
      }
    }
    // The top face's normal points at the ball.
    const top = scene.samples.filter(q => Math.abs(q.y - 2) < 1e-6 && q.x < 0);
    expect(top.length).toBeGreaterThan(0);
    for (const q of top) expect(q.ny).toBeCloseTo(-1, 6);
  });

  it("does not offer the strip under a fence's foot as surface", () => {
    // Fence standing on the floor: the floor under its foot, and the foot
    // itself, are covered. Without this the film ran under the fence and out
    // the other side.
    const floor = [{ x: -100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: -100, y: 20 }];
    const fence = [{ x: 20, y: -60 }, { x: 26, y: -60 }, { x: 26, y: 0 }, { x: 20, y: 0 }];
    const samples = surfaceSamples([floor, fence], R);
    expect(samples.some(q => Math.abs(q.y) < 1e-6 && q.x > 20.5 && q.x < 25.5)).toBe(false);
    // And the far face is not reachable from the contact (over the top is out of reach).
    expect(samples.some(q => Math.abs(q.x - 26) < 1e-6 && q.y < -1)).toBe(false);
  });

  it("offers each shared face once", () => {
    // Board edge wall on the board's outside: both have a face on y = 0.
    const scene = captureSplatScene(
      { walls: [wall(45, 855, 855, 855, "board-edge-2")], obstaclePolygons: [], boardPolygon: board },
      { x: 450, y: 855 }, UP, R,
    );
    const onFace = scene.samples.filter(q => Math.abs(q.y) < 1e-6);
    const spacing = R / 12;
    for (let i = 0; i < onFace.length; i++) {
      for (let j = i + 1; j < onFace.length; j++) {
        expect(Math.abs(onFace[i].x - onFace[j].x)).toBeGreaterThan(spacing * 0.4);
      }
    }
  });
});
