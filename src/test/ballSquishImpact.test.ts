import { describe, it, expect } from "vitest";
import { bounceImpact, createBallEffectState, triggerWallHit, getSquishEffect } from "@/lib/ballEffects";

/**
 * The squash must reflect the ANGLE and SPEED of the impact.
 *
 * The wall path used to pass the post-bounce velocity as the compression axis
 * and the ball's TOTAL speed as the magnitude. That is only correct head-on: on
 * a glancing hit the post-bounce velocity is mostly tangential, so the ball
 * squashed nearly parallel to the surface it had just hit, and at full strength
 * because its total speed was still high.
 */
describe("bounceImpact", () => {
  it("returns the surface normal, not the post-bounce direction", () => {
    // Head-on into a vertical wall: travelling +x, leaving -x.
    const [nx, ny] = bounceImpact({ x: 100, y: 0 }, { x: -100, y: 0 });
    expect(Math.abs(nx)).toBeCloseTo(1);
    expect(ny).toBeCloseTo(0);
  });

  it("gives a glancing hit the surface normal, NOT its travel direction", () => {
    // Skimming a horizontal floor: x is untouched, only y reverses. The travel
    // direction is almost entirely +x, but the compression axis must be y.
    const [nx, ny] = bounceImpact({ x: 300, y: 12 }, { x: 300, y: -12 });
    expect(nx).toBeCloseTo(0);
    expect(Math.abs(ny)).toBeCloseTo(1);
  });

  it("scales magnitude by the NORMAL component, so a graze barely squashes", () => {
    const headOn = bounceImpact({ x: 240, y: 0 }, { x: -240, y: 0 })[2];
    const graze = bounceImpact({ x: 300, y: 12 }, { x: 300, y: -12 })[2];
    expect(headOn).toBeCloseTo(240);
    expect(graze).toBeCloseTo(12);
    // The grazing ball is the FASTER one, yet must deform far less.
    expect(graze).toBeLessThan(headOn / 10);
  });

  it("is inert for a non-collision (no velocity change)", () => {
    expect(bounceImpact({ x: 100, y: 50 }, { x: 100, y: 50 })).toEqual([0, 0, 0]);
  });
});

describe("squash driven by bounceImpact", () => {
  it("compresses along the wall normal and leaves a graze nearly round", () => {
    const now = 1000;

    const square = createBallEffectState();
    triggerWallHit(square, now, ...bounceImpact({ x: 240, y: 0 }, { x: -240, y: 0 }));
    const hard = getSquishEffect(square);

    const skim = createBallEffectState();
    triggerWallHit(skim, now, ...bounceImpact({ x: 300, y: 12 }, { x: 300, y: -12 }));
    const soft = getSquishEffect(skim);

    // Both deform along their own normal...
    expect(Math.abs(hard.nx)).toBeCloseTo(1);
    expect(Math.abs(soft.ny)).toBeCloseTo(1);
    // ...but the graze is far closer to round than the square hit.
    expect(1 - soft.scaleAlong).toBeLessThan(1 - hard.scaleAlong);
  });
});
