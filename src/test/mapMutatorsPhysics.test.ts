/**
 * #54 end-to-end: the Conveyor mutator actually drifts a ball through the REAL
 * updateBall physics. Ball velocity is purely vertical; the horizontal drift
 * must move it sideways by driftX*dt*steps, and with no mutator it must not.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({ playWallHitSound: () => {} }));
vi.mock("@/lib/gameHaptics", () => ({ vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {} }));

import { updateBall } from "@/lib/physics/updateBall";
import { createRectPolygon } from "@/lib/polygon";
import { createBallEffectState } from "@/lib/ballEffects";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";
import type { ActiveMapMutator } from "@/types/mapMutator";

const BOARD = createRectPolygon(0, 0, 600, 400);
const R = 12;

function makeBall(): Ball {
  return {
    id: "b", position: { x: 300, y: 200 }, velocity: { x: 0, y: 100 }, radius: R,
    speed: 100, baseSpeed: 100, topSpeed: 100, color: "#fff", regionId: "r",
    rotation: 0, flashIntensity: 0, effects: createBallEffectState(), state: "active",
    wonSpinSpeed: 0, wonTime: 0, assimScale: 1, assimColorFade: 0, typeId: "red",
    ability: "none", lockMultiplier: 1, spawnTime: 0, minimumSpeed: 80,
  } as unknown as Ball;
}

function runXDrift(mutator: ActiveMapMutator | null, steps: number): number {
  const ball = makeBall();
  const game = {
    boardPolygon: BOARD, obstaclePolygons: [], walls: [], movers: [], regions: [],
    creepFactor: 1, balls: [ball], mapMutator: mutator,
  } as unknown as CanvasGameState;
  const startX = ball.position.x;
  for (let i = 0; i < steps; i++) updateBall(ball, PHYSICS_STEP, game);
  return ball.position.x - startX;
}

describe("Conveyor mutator drifts the ball (#54)", () => {
  const conveyor: ActiveMapMutator = {
    id: "conveyor", name: "Conveyor", description: "d", behavior: "conveyor",
    params: { speed: 55 }, driftX: 55, driftY: 0,
  };

  it("moves the ball sideways by driftX*dt*steps", () => {
    const steps = 30;
    const dx = runXDrift(conveyor, steps);
    // Ball velocity has no x component, so all sideways motion is the current.
    expect(dx).toBeCloseTo(55 * PHYSICS_STEP * steps, 2);
  });

  it("does not drift without the mutator", () => {
    expect(Math.abs(runXDrift(null, 30))).toBeLessThan(0.001);
  });
});
