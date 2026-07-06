import { describe, it, expect } from "vitest";
import { handleBallCollisions } from "@/lib/physics/handleBallCollisions";
import { Ball } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";

/**
 * Guards the scalar in-place rewrite of handleBallCollisions (perf: no per-pair
 * vec2 allocations). These assert the physics contract, not the implementation,
 * so they'd catch a sign/aliasing regression in either the old or new form.
 */

function makeBall(over: Partial<Ball>): Ball {
  return {
    id: "b",
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: 10,
    regionId: "r1",
    state: "active",
    rotation: 0,
    // Only fields handleBallCollisions touches; the rest are irrelevant here.
    effects: { ballHitIntensity: 0, ballHitTime: 0 },
    ...over,
  } as unknown as Ball;
}

function makeGame(balls: Ball[]): CanvasGameState {
  return { balls, frozenBallId: undefined } as unknown as CanvasGameState;
}

describe("handleBallCollisions", () => {
  it("swaps normal velocity for an equal-mass head-on hit and separates the pair", () => {
    const a = makeBall({ id: "a", position: { x: 0, y: 0 }, velocity: { x: 10, y: 0 } });
    const b = makeBall({ id: "b", position: { x: 15, y: 0 }, velocity: { x: -10, y: 0 } });
    handleBallCollisions(makeGame([a, b]));

    // Equal-mass elastic exchange along the normal: the x-velocities swap.
    expect(a.velocity.x).toBeCloseTo(-10, 6);
    expect(b.velocity.x).toBeCloseTo(10, 6);
    // Overlap of 5 (minDist 20 - dist 15) split evenly → pushed to exactly touching.
    expect(a.position.x).toBeCloseTo(-2.5, 6);
    expect(b.position.x).toBeCloseTo(17.5, 6);
    expect(Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y)).toBeCloseTo(20, 6);
  });

  it("does nothing when overlapping balls are already separating", () => {
    const a = makeBall({ id: "a", position: { x: 0, y: 0 }, velocity: { x: -10, y: 0 } });
    const b = makeBall({ id: "b", position: { x: 15, y: 0 }, velocity: { x: 10, y: 0 } });
    handleBallCollisions(makeGame([a, b]));

    expect(a.velocity.x).toBe(-10);
    expect(b.velocity.x).toBe(10);
    expect(a.position.x).toBe(0);
    expect(b.position.x).toBe(15);
  });

  it("ignores pairs in different regions", () => {
    const a = makeBall({ id: "a", regionId: "r1", position: { x: 0, y: 0 }, velocity: { x: 10, y: 0 } });
    const b = makeBall({ id: "b", regionId: "r2", position: { x: 15, y: 0 }, velocity: { x: -10, y: 0 } });
    handleBallCollisions(makeGame([a, b]));

    expect(a.velocity.x).toBe(10);
    expect(b.velocity.x).toBe(-10);
  });

  it("bounces a moving ball off a frozen one while the frozen ball stays put", () => {
    const frozen = makeBall({ id: "f", position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, frozenUntil: performance.now() + 10_000 });
    const mover = makeBall({ id: "m", position: { x: 15, y: 0 }, velocity: { x: -10, y: 0 } });
    handleBallCollisions(makeGame([frozen, mover]));

    // Mover reflects; frozen ball is unmoved (infinite mass).
    expect(mover.velocity.x).toBeCloseTo(10, 6);
    expect(mover.position.x).toBeCloseTo(20, 6);
    expect(frozen.position.x).toBe(0);
    expect(frozen.velocity.x).toBe(0);
  });
});
