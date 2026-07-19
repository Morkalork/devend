/**
 * #51 regression: the Scrum Master trajectory PREVIEW must match the REAL ball
 * physics when bouncing off a curved obstacle. Previously they diverged 15-29°
 * on angled hits because resolveBallPolygonCollisionOutward reflected the ball
 * off every 64-gon edge within ballRadius (several at once near a vertex),
 * over-rotating the real bounce while the preview modelled one ideal reflection.
 *
 * This drives the ACTUAL updateBall physics forward until the ball bounces off
 * a circle obstacle, and asserts the previewed post-bounce direction agrees.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({ playWallHitSound: () => {} }));
vi.mock("@/lib/gameHaptics", () => ({ vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {} }));

import { computeBallTrajectory } from "@/lib/gameUtils";
import { updateBall } from "@/lib/physics/updateBall";
import { createRectPolygon } from "@/lib/polygon";
import { createBallEffectState } from "@/lib/ballEffects";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball, Vector2 } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";

function circlePoly(cx: number, cy: number, r: number, n = 64) {
  const vertices: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    vertices.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return { vertices };
}
function boardWalls(x0: number, y0: number, x1: number, y1: number): Wall[] {
  const c: [Vector2, Vector2][] = [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }],
  ];
  return c.map((s, i) => ({ id: `board-${i}`, start: s[0], end: s[1], thickness: 0 } as unknown as Wall));
}
function angleDeg(v: Vector2) { return Math.atan2(v.y, v.x) * 180 / Math.PI; }
function angleErr(a: number, b: number) { let e = Math.abs(a - b); return e > 180 ? 360 - e : e; }

const BOARD = createRectPolygon(0, 0, 600, 400);
const OBSTACLE = circlePoly(300, 200, 55);
const R = 18;

function realPostBounceDir(vel: Vector2): Vector2 | null {
  const start: Vector2 = { x: 120, y: 200 };
  const ball = {
    id: "b", position: { ...start }, velocity: { ...vel }, radius: R,
    speed: Math.hypot(vel.x, vel.y), baseSpeed: Math.hypot(vel.x, vel.y), topSpeed: 400,
    color: "#fff", regionId: "r", rotation: 0, flashIntensity: 0, effects: createBallEffectState(),
    state: "active", wonSpinSpeed: 0, wonTime: 0, assimScale: 1, assimColorFade: 0,
    typeId: "red", ability: "none", lockMultiplier: 1, spawnTime: 0, minimumSpeed: 80,
  } as unknown as Ball;
  const game = {
    boardPolygon: BOARD, obstaclePolygons: [OBSTACLE], walls: [], movers: [],
    regions: [], creepFactor: 1, balls: [ball],
  } as unknown as CanvasGameState;
  for (let i = 0; i < 3000; i++) {
    const bx = ball.velocity.x, by = ball.velocity.y;
    const distToCircle = Math.hypot(ball.position.x - 300, ball.position.y - 200) - 55;
    updateBall(ball, PHYSICS_STEP, game);
    if ((ball.velocity.x !== bx || ball.velocity.y !== by) && distToCircle < R + 3) {
      return { ...ball.velocity };
    }
  }
  return null;
}

describe("trajectory preview matches the real physics off a curved obstacle (#51)", () => {
  // Moderate approach angles that hit the circle cleanly; the previous code
  // diverged 15-29° here.
  for (const vy of [0, 30, 60, 90]) {
    it(`agrees within a few degrees for approach vy=${vy}`, () => {
      const vel = { x: 300, y: vy };
      const real = realPostBounceDir(vel);
      expect(real, "physics should bounce off the obstacle").not.toBeNull();

      const path = computeBallTrajectory({ x: 120, y: 200 }, vel, boardWalls(0, 0, 600, 400), 2, R, [OBSTACLE], []);
      expect(path.length).toBeGreaterThanOrEqual(3);
      // The preview's first bounce must be the obstacle (centre one R+radius out).
      expect(Math.abs(Math.hypot(path[1].x - 300, path[1].y - 200) - (55 + R))).toBeLessThan(3);

      const previewDir = { x: path[2].x - path[1].x, y: path[2].y - path[1].y };
      expect(angleErr(angleDeg(real!), angleDeg(previewDir))).toBeLessThan(4);
    });
  }
});
