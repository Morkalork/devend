import { describe, it, expect } from "vitest";
import { computeBallTrajectory, trajectoryBallSnapshots } from "@/lib/gameUtils";
import type { Ball } from "@/types/game";
import { MoverState, buildMoverPolygon } from "@/lib/physics/moverState";
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

  // Minimal mover factory. Defaults to speed 0 (a parked mover) so position
  // tests stay time-independent; motion tests set speed/axis/direction.
  const mover = (partial: Partial<MoverState> & Pick<MoverState, "shape" | "homeX" | "homeY">): MoverState => {
    const m: MoverState = {
      id: "mover-1", axis: "horizontal", range: 80, speed: 0,
      offset: 0, direction: 1, polygon: { vertices: [] },
      ...partial,
    };
    m.polygon = buildMoverPolygon(m);
    return m;
  };

  it("bounces off a parked rect mover instead of passing through", () => {
    // Rect mover centred at (100,150), 40x20 → top face at y=140; centre stops at 130.
    const m = mover({ shape: "rect", homeX: 100, homeY: 150, width: 40, height: 20 });
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 1 }, boardEdges, 1, R, [], [m]);
    expect(path.length).toBe(2);
    expect(near(path[1].y, 130)).toBe(true);
    expect(near(path[1].x, 100)).toBe(true);
  });

  it("bounces off a circle mover's polygon (top of a radius-15 circle at y=150)", () => {
    const m = mover({ shape: "circle", homeX: 100, homeY: 150, radius: 15 });
    // Top of the 24-gon is at y=135; ball centre stops ~one radius above it.
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 1 }, boardEdges, 1, R, [], [m]);
    expect(path.length).toBe(2);
    expect(near(path[1].y, 125, 1)).toBe(true);
  });

  it("uses the mover's displaced position, not its home", () => {
    // Same rect mover slid 60 right along its track: the ball sails past it and
    // hits the bottom board edge instead.
    const m = mover({ shape: "rect", homeX: 100, homeY: 150, width: 40, height: 20, range: 120, offset: 60 });
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 1 }, boardEdges, 1, R, [], [m]);
    expect(path.length).toBe(2);
    expect(near(path[1].y, 190)).toBe(true);
  });

  // ── Time-aware mover prediction ─────────────────────────────────────────
  // Rect mover centred at (100,150), 40x20, oscillating vertically at 50 u/s.
  // Ball drops from (100,100) at 100 u/s; contact when the ball centre reaches
  // one radius above the top face: 100 + 100t = 130 + o(t).
  const vertMover = (direction: 1 | -1, range = 200) =>
    mover({ shape: "rect", homeX: 100, homeY: 150, width: 40, height: 20,
            axis: "vertical", speed: 50, direction, range });

  it("intercepts a RECEDING mover where it will be, not where it is", () => {
    // Mover fleeing downward: 100 + 100t = 130 + 50t → t = 0.6, contact y = 160
    // (a frozen-position prediction would say y = 130).
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 100 }, boardEdges, 1, R, [], [vertMover(1)]);
    expect(path.length).toBe(2);
    expect(near(path[1].y, 160)).toBe(true);
  });

  it("intercepts an APPROACHING mover earlier than its current position", () => {
    // Mover rising to meet the ball: 100 + 100t = 130 - 50t → t = 0.2, y = 120.
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 100 }, boardEdges, 1, R, [], [vertMover(-1)]);
    expect(path.length).toBe(2);
    expect(near(path[1].y, 120)).toBe(true);
  });

  it("tracks the mover through a track-end flip", () => {
    // Range 20 → the fleeing mover flips at t = 0.2 (offset +10) and comes back:
    // 100 + 100t = 140 - 50(t - 0.2) → t = 1/3, contact y ≈ 133.33.
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 100 }, boardEdges, 1, R, [], [vertMover(1, 20)]);
    expect(path.length).toBe(2);
    expect(near(path[1].y, 133.33, 1)).toBe(true);
  });

  it("lets the ball pass when a crossing mover clears the path in time", () => {
    // Mover sliding right at 200 u/s exits the ball's corridor before the ball
    // arrives, so the prediction reaches the bottom edge (frozen-position would
    // wrongly report a bounce at y = 130).
    const m = mover({ shape: "rect", homeX: 100, homeY: 150, width: 40, height: 20,
                      axis: "horizontal", speed: 200, direction: 1, range: 400 });
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 100 }, boardEdges, 1, R, [], [m]);
    expect(path.length).toBe(2);
    expect(near(path[1].y, 190)).toBe(true);
  });

  it("folds the Scope Creep time scale into the ball's speed", () => {
    // creepFactor 2 doubles the ball's effective speed:
    // 100 + 200t = 130 + 50t → t = 0.2, contact y = 140 (vs 160 unscaled).
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 100 }, boardEdges, 1, R, [], [vertMover(1)], 2);
    expect(path.length).toBe(2);
    expect(near(path[1].y, 140)).toBe(true);
  });

  // ── Ball-to-ball prediction (issue #47) ──────────────────────────────────
  // Other balls are static snapshots; outcome mirrors handleBallCollisions
  // with a stationary target: keep the tangent, shed the normal component.

  it("ends the preview at a head-on hit on another ball (dead stop)", () => {
    // Straight down onto a radius-10 ball at (100,150): centres touch at
    // distance 20, so the preview stops at y = 130 - no reflected leg, even
    // though more bounces and the board edges were available.
    const other = { position: { x: 100, y: 150 }, radius: 10 };
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 1 }, boardEdges, 3, R, [], [], 1, [other]);
    expect(path.length).toBe(2);
    expect(near(path[1].x, 100)).toBe(true);
    expect(near(path[1].y, 130)).toBe(true);
  });

  it("deflects along the tangent on a glancing ball hit and keeps going", () => {
    // Other ball offset half a contact-radius right of the path: contact at
    // (100, 150 - sqrt(300)) ≈ (100, 132.68), normal (-0.5, -0.866). The
    // tangential remainder (-0.866, +0.5) heads down-left and reaches the left
    // board edge (centre x = 10) at y ≈ 184.6.
    const other = { position: { x: 110, y: 150 }, radius: 10 };
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 1 }, boardEdges, 2, R, [], [], 1, [other]);
    expect(path.length).toBe(3);
    expect(near(path[1].x, 100)).toBe(true);
    expect(near(path[1].y, 132.68, 1)).toBe(true);
    expect(near(path[2].x, 10, 1)).toBe(true);
    expect(near(path[2].y, 184.6, 1)).toBe(true);
  });

  it("REFLECTS off a tap-frozen ball (infinite mass) like a wall", () => {
    const other = { position: { x: 100, y: 150 }, radius: 10, frozen: true };
    const path = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 1 }, boardEdges, 2, R, [], [], 1, [other]);
    expect(path.length).toBe(3);
    expect(near(path[1].y, 130)).toBe(true); // contact centre-to-centre
    expect(near(path[2].y, 10)).toBe(true);  // straight back up to the top edge
    expect(near(path[2].x, 100)).toBe(true);
  });

  it("prefers whichever obstacle comes first: wall before ball, ball before wall", () => {
    const other = { position: { x: 100, y: 150 }, radius: 10 };
    const fenceAbove = wall("wall-1", 60, 120, 140, 120, 6); // in front of the ball
    const blocked = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 1 }, [fenceAbove], 1, R, [], [], 1, [other]);
    expect(near(blocked[1].y, 107)).toBe(true); // fence first (120 - 10 - 3)
    const open = computeBallTrajectory({ x: 100, y: 100 }, { x: 0, y: 1 }, boardEdges, 1, R, [], [], 1, [other]);
    expect(near(open[1].y, 130)).toBe(true);    // ball first (before y=190 edge)
  });
});

describe("trajectoryBallSnapshots", () => {
  const mkBall = (over: Partial<Ball>): Ball =>
    ({ id: "b", state: "active", regionId: "r1", position: { x: 1, y: 2 }, radius: 10, ...over }) as Ball;

  it("mirrors handleBallCollisions' pairing rules exactly", () => {
    const me = mkBall({ id: "me" });
    const peers = [
      me,                                                       // self: excluded
      mkBall({ id: "same-region" }),                            // included
      mkBall({ id: "other-region", regionId: "r2" }),           // excluded (regions never collide)
      mkBall({ id: "trophy", state: "won" }),                   // excluded (stationary trophy)
      mkBall({ id: "auto-frozen" }),                            // excluded (collisions skipped)
      mkBall({ id: "tap-frozen", frozenUntil: performance.now() + 5000 }), // included, frozen
    ];
    const snaps = trajectoryBallSnapshots(peers, me, "auto-frozen");
    expect(snaps).toHaveLength(2);
    expect(snaps[0].frozen).toBe(false);
    expect(snaps[1].frozen).toBe(true);
  });

  it("prefers the interpolated render position (where the ball is drawn)", () => {
    const me = mkBall({ id: "me" });
    const other = mkBall({ id: "o", position: { x: 5, y: 5 }, renderPosition: { x: 7, y: 8 } });
    expect(trajectoryBallSnapshots([me, other], me, null)[0].position).toEqual({ x: 7, y: 8 });
  });
});
