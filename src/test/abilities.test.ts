/**
 * Chest-earned abilities (#38): the simple, pure ability effects. Freeze All and
 * the timed Slow All (creepFactor fold). Clear All Fences has its own suite.
 */
import { describe, it, expect } from "vitest";
import {
  freezeAllBalls,
  applySlowAll,
  abilitySpeedFactor,
  FREEZE_ALL_MS,
  SLOW_ALL_FACTOR,
  SLOW_ALL_SECONDS,
  ABILITY_IDS,
} from "@/lib/abilities";
import { CanvasGameState } from "@/types/gameState";
import { Ball } from "@/types/game";

function ball(id: string, state: "active" | "won" = "active"): Ball {
  return { id, state, velocity: { x: 100, y: 0 }, speed: 100, minimumSpeed: 50 } as Ball;
}

describe("freezeAllBalls", () => {
  it("freezes every active ball for the fixed duration and skips won balls", () => {
    const balls = [ball("a"), ball("b"), ball("c", "won")];
    const game = { balls } as unknown as CanvasGameState;
    freezeAllBalls(game, 1000);
    expect(balls[0].frozenUntil).toBe(1000 + FREEZE_ALL_MS);
    expect(balls[1].frozenUntil).toBe(1000 + FREEZE_ALL_MS);
    expect(balls[2].frozenUntil).toBeUndefined(); // won ball untouched
  });
});

describe("slow all", () => {
  it("applies a timed global slow that expires by the active-play clock", () => {
    const game = { activePlaySeconds: 10 } as unknown as CanvasGameState;
    applySlowAll(game);
    expect(game.abilitySlowUntil).toBe(10 + SLOW_ALL_SECONDS);
    expect(game.abilitySlowMult).toBe(SLOW_ALL_FACTOR);
    // Inside the window -> the slow factor; after it -> 1 (self-reverting).
    game.activePlaySeconds = 12;
    expect(abilitySpeedFactor(game)).toBe(SLOW_ALL_FACTOR);
    game.activePlaySeconds = 10 + SLOW_ALL_SECONDS + 0.01;
    expect(abilitySpeedFactor(game)).toBe(1);
  });

  it("returns a factor of 1 when no slow is active", () => {
    const game = { activePlaySeconds: 5 } as unknown as CanvasGameState;
    expect(abilitySpeedFactor(game)).toBe(1);
  });

  it("the slow factor is a genuine slow (< 1)", () => {
    expect(SLOW_ALL_FACTOR).toBeGreaterThan(0);
    expect(SLOW_ALL_FACTOR).toBeLessThan(1);
  });
});

describe("ability roster", () => {
  it("is exactly the three chest-earned abilities", () => {
    expect(ABILITY_IDS).toEqual(["freezeAll", "slowAll", "clearFences"]);
  });
});
