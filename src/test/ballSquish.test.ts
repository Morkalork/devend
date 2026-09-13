/**
 * Squash & stretch on contact (issue #44).
 *
 * The SHAPE is a droplet and lives in splatShape.ts, which has its own tests.
 * What is checked here is the part ballEffects owns: that a hit records the
 * right axis and depth, that the deformation is a motion rather than a value,
 * and that it comes back to round.
 *
 * These used to assert an ELLIPSE with area preservation, because that is what
 * the squash was: one scale along the impact normal, another across, applied
 * about the ball's centre. It was replaced because an ellipse squeezes
 * symmetrically - the far side of the ball flattens exactly as much as the side
 * against the wall - and no depth setting makes that read as a soft material.
 * `scaleAlong` and `scalePerp` survive as MEASUREMENTS of the droplet (its
 * height and width, as fractions of the round diameter) rather than as its
 * definition.
 */
import { describe, it, expect } from "vitest";
import {
  createBallEffectState,
  triggerWallHit,
  triggerBallHit,
  updateBallEffects,
  getSquishEffect,
} from "@/lib/ballEffects";
import { splatOutline } from "@/lib/rendering/splatShape";

const T0 = 1000;
/** Play the envelope forward to `ms` after the impact, a frame at a time. */
function at(st: ReturnType<typeof createBallEffectState>, ms: number) {
  for (let t = 0; t <= ms; t += 1000 / 60) updateBallEffects(st, 1 / 60, T0 + t);
  return getSquishEffect(st);
}

describe("ball squash & stretch (issue #44)", () => {
  it("a fresh ball is round (no squish)", () => {
    const s = getSquishEffect(createBallEffectState());
    expect(s.active).toBe(false);
    expect(s.scaleAlong).toBe(1);
    expect(s.scalePerp).toBe(1);
  });

  it("is still round on the frame it lands, then deforms", () => {
    // The contact face forms over the first few frames. A ball that is already
    // deformed at the instant of impact has not been seen to squash - that is
    // the whole complaint the droplet exists to answer.
    const st = createBallEffectState();
    triggerWallHit(st, T0, 0, -300, 300);
    expect(getSquishEffect(st).active).toBe(false);
    expect(at(st, 60).active).toBe(true);
  });

  it("flattens along the travel axis and spreads across it", () => {
    const st = createBallEffectState();
    triggerWallHit(st, T0, 0, -300, 300); // moving straight up at full speed
    const s = at(st, 80);
    expect(s.scaleAlong).toBeLessThan(1);   // shorter along the normal
    expect(s.scalePerp).toBeGreaterThan(1); // wider across it
    expect(s.nx).toBeCloseTo(0, 6);
    expect(s.ny).toBeCloseTo(-1, 6);        // unit normal = travel direction
  });

  it("keeps the far side rounder than the contact face", () => {
    // The property that makes it a splat rather than a squeeze, and the one an
    // ellipse cannot have: at the wall the silhouette is wider than the ball,
    // and it narrows toward the crown.
    const st = createBallEffectState();
    triggerWallHit(st, T0, 0, -300, 300);
    at(st, 80);
    const { splat } = getSquishEffect(st);
    // Measured directly off the outline: widest point sits below the middle.
    const R = 20;
    const pts = splatOutline(splat, R);
    let widestY = 0, widest = 0;
    let minY = 0;
    for (const p of pts) {
      if (Math.abs(p.x) > widest) { widest = Math.abs(p.x); widestY = p.y; }
      if (p.y < minY) minY = p.y;
    }
    // y is INTO the wall, so "below the middle" is a widest point closer to 0
    // than the halfway mark between the crown (minY) and the wall (0).
    expect(widestY).toBeGreaterThan(minY / 2);
  });

  it("faster impacts squish more than slow ones", () => {
    const slow = createBallEffectState();
    const fast = createBallEffectState();
    triggerWallHit(slow, T0, 100, 0, 100);
    triggerWallHit(fast, T0, 400, 0, 400);
    expect(at(fast, 80).scaleAlong).toBeLessThan(at(slow, 80).scaleAlong);
  });

  it("a near-resting contact leaves the ball round", () => {
    const st = createBallEffectState();
    triggerWallHit(st, T0, 0, 1, 1); // essentially stopped
    expect(at(st, 80).active).toBe(false);
  });

  it("comes back to round when the bounce is over", () => {
    const st = createBallEffectState();
    triggerWallHit(st, T0, 300, 0, 300);
    expect(at(st, 80).active).toBe(true);
    expect(at(st, 800).active).toBe(false);
  });

  it("ball-to-ball hits also squish", () => {
    const st = createBallEffectState();
    triggerBallHit(st, T0, 1, 0, 250);
    expect(at(st, 80).active).toBe(true);
  });

  it("a per-ball scale shrinks the deformation (big boss balls)", () => {
    const st = createBallEffectState();
    triggerWallHit(st, T0, 300, 0, 300);
    at(st, 80);
    const full = getSquishEffect(st, 1);
    const half = getSquishEffect(st, 0.5);
    expect(1 - half.scaleAlong).toBeLessThan(1 - full.scaleAlong);
    expect(half.scalePerp).toBeLessThan(full.scalePerp);
    expect(half.scalePerp).toBeGreaterThan(1);
  });
});
