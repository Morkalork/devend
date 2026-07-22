/**
 * Breakable force model (issue #38): a hit's damage scales with the ball's mass
 * (density × radius²) and its normal impact speed, replacing the old flat
 * 1-hit-per-touch rule. These lock the calibration so tuning stays honest.
 */
import { describe, it, expect } from "vitest";
import { ballMass, ballImpactDamage } from "@/lib/physics/destructibles";
import { BASE_BALL_RADIUS } from "@/lib/gameConstants";
import { Ball } from "@/types/game";

/** Minimal ball for the damage helpers (they read only typeId + radius). */
function ball(typeId: string, radius = BASE_BALL_RADIUS): Ball {
  return { typeId, radius } as Ball;
}

describe("ball mass", () => {
  it("is 1 for a standard base-radius ball and scales with density × radius²", () => {
    expect(ballMass(ball("red"))).toBeCloseTo(1, 5);         // density 1, base radius
    expect(ballMass(ball("black"))).toBeCloseTo(2.6, 5);     // heavy wrecking ball
    expect(ballMass(ball("yellow"))).toBeCloseTo(0.6, 5);    // light
    // Doubling the radius quadruples the mass (area).
    expect(ballMass(ball("red", BASE_BALL_RADIUS * 2))).toBeCloseTo(4, 5);
  });
});

describe("impact damage", () => {
  it("a standard ball head-on at its base speed does ~1.0 (about a third of a 3-budget)", () => {
    expect(ballImpactDamage(ball("red"), 250)).toBeCloseTo(1, 2);
  });

  it("faster hits do more damage than slow ones", () => {
    expect(ballImpactDamage(ball("red"), 350)).toBeGreaterThan(ballImpactDamage(ball("red"), 200));
  });

  it("heavier balls do more damage than light ones at the same speed", () => {
    expect(ballImpactDamage(ball("black"), 200)).toBeGreaterThan(ballImpactDamage(ball("yellow"), 200));
  });

  it("clamps: a crawling graze still chips, a rocket can't one-shot everything", () => {
    expect(ballImpactDamage(ball("red"), 5)).toBeCloseTo(0.15, 5);   // MIN_CHIP floor
    expect(ballImpactDamage(ball("black"), 900)).toBeCloseTo(2.0, 5); // MAX_HIT cap
  });

  it("three high-speed hits break more than three low-speed hits (the whole point)", () => {
    const fast = 3 * ballImpactDamage(ball("red"), 380);
    const slow = 3 * ballImpactDamage(ball("red"), 170);
    expect(fast).toBeGreaterThan(slow);
    // Fast trio clears a 3-integrity object; slow trio does not.
    expect(fast).toBeGreaterThanOrEqual(3);
    expect(slow).toBeLessThan(3);
  });
});
