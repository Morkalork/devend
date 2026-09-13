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

  it("a wall hit squishes along the travel axis, spreading as it flattens", () => {
    const st = createBallEffectState();
    triggerWallHit(st, 1000, 0, -300, 300); // moving straight up at full speed
    const s = getSquishEffect(st);
    expect(s.active).toBe(true);
    expect(s.scaleAlong).toBeLessThan(1); // compressed along the normal
    expect(s.scalePerp).toBeGreaterThan(1); // stretched perpendicular
    // These two tests asked for STRICT area preservation (product exactly 1),
    // which is right for a disc and wrong for the ball: a soft body pressed
    // against a wall also bulges toward the viewer, and that third dimension is
    // invisible here, so a strict inverse spends all of it sideways. The bulge
    // is now damped (see BULGE_EXPONENT), which is imperceptible on a bounce
    // like this one and the whole difference between a tomato and a water
    // balloon at Bug Squash depth. So: spreads, but by less than it flattens.
    expect(s.scaleAlong * s.scalePerp).toBeLessThan(1);
    expect(s.scaleAlong * s.scalePerp).toBeGreaterThan(0.9);
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
    updateBallEffects(st, 0.016, 1000 + 800); // well past squishDuration (500ms)
    expect(getSquishEffect(st).active).toBe(false);
  });

  it("ball-to-ball hits also squish", () => {
    const st = createBallEffectState();
    triggerBallHit(st, 1000, 1, 0, 250);
    expect(getSquishEffect(st).active).toBe(true);
  });

  it("a per-ball scale halves the deformation (big boss balls)", () => {
    const st = createBallEffectState();
    triggerWallHit(st, 1000, 300, 0, 300); // full-speed hit
    const full = getSquishEffect(st, 1);
    const half = getSquishEffect(st, 0.5);
    const fullCompress = 1 - full.scaleAlong; // squishMaxCompress at full strength
    const halfCompress = 1 - half.scaleAlong;
    expect(halfCompress).toBeCloseTo(fullCompress / 2, 6);
    // Still spreading as it flattens, and still damped (see the note above).
    expect(half.scaleAlong * half.scalePerp).toBeLessThan(1);
    expect(half.scaleAlong * half.scalePerp).toBeGreaterThan(0.95);
  });
});
