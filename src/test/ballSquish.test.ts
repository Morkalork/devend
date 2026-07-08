import { describe, it, expect } from "vitest";
import {
  createBallEffectState,
  triggerWallHit,
  triggerBallHit,
  updateBallEffects,
  getSquishEffect,
} from "@/lib/ballEffects";

describe("ball squash & stretch (issue #44)", () => {
  it("a fresh ball is round (no squish)", () => {
    const s = getSquishEffect(createBallEffectState());
    expect(s.active).toBe(false);
    expect(s.scaleAlong).toBe(1);
    expect(s.scalePerp).toBe(1);
  });

  it("a wall hit squishes along the travel axis, area-preserving", () => {
    const st = createBallEffectState();
    triggerWallHit(st, 1000, 0, -300, 300); // moving straight up at full speed
    const s = getSquishEffect(st);
    expect(s.active).toBe(true);
    expect(s.scaleAlong).toBeLessThan(1); // compressed along the normal
    expect(s.scalePerp).toBeGreaterThan(1); // stretched perpendicular
    expect(s.scaleAlong * s.scalePerp).toBeCloseTo(1, 6); // area preserved
    expect(s.nx).toBeCloseTo(0, 6);
    expect(s.ny).toBeCloseTo(-1, 6); // unit normal = travel direction
  });

  it("faster impacts squish more than slow ones", () => {
    const slow = createBallEffectState();
    const fast = createBallEffectState();
    triggerWallHit(slow, 1000, 100, 0, 100);
    triggerWallHit(fast, 1000, 400, 0, 400);
    expect(getSquishEffect(fast).scaleAlong).toBeLessThan(getSquishEffect(slow).scaleAlong);
  });

  it("a near-resting contact leaves the ball round", () => {
    const st = createBallEffectState();
    triggerWallHit(st, 1000, 0, 1, 1); // essentially stopped
    expect(getSquishEffect(st).active).toBe(false);
  });

  it("springs back to round after the squish duration", () => {
    const st = createBallEffectState();
    triggerWallHit(st, 1000, 300, 0, 300);
    expect(getSquishEffect(st).active).toBe(true);
    updateBallEffects(st, 0.016, 1000 + 500); // well past squishDuration (220ms)
    expect(getSquishEffect(st).active).toBe(false);
  });

  it("ball-to-ball hits also squish", () => {
    const st = createBallEffectState();
    triggerBallHit(st, 1000, 1, 0, 250);
    expect(getSquishEffect(st).active).toBe(true);
  });
});
