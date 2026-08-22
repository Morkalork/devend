/**
 * The bulge a wall takes when a ball strikes it.
 *
 * The effect was fully implemented and completely DEAD. Impacts were registered
 * on every bounce and ticked on every frame, and nothing on screen ever read
 * them: `getEffectsAtPoint`, `hasNearbyImpacts` and `obstacleBulgeAt` had zero
 * callers. The Canvas2D renderer that used to consume them was replaced by the
 * Pixi one and the bulge was never ported across, which costs nothing at
 * runtime and produces no error, so there was nothing to notice except its
 * absence.
 *
 * That is the failure this file exists for. The physics half is easy to test
 * and was never broken; what needs pinning is that something still CONSUMES it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  registerWallImpact, updateWallImpacts, getEffectsAtPoint, hasNearbyImpacts,
  clearWallImpacts, getActiveImpactCount, N_NODES,
} from "@/lib/wallImpactEffects";

/**
 * The envelope is wall-clock driven (performance.now), and it peaks 85ms after
 * the hit. Two probes registered microseconds apart therefore sit at
 * essentially zero amplitude, where timing jitter is larger than the thing
 * being measured: the first version of the strength test compared 0.0043
 * against 0.0011 and called the louder hit weaker. Driving the clock makes both
 * probes read the same point on the curve.
 */
let clock = 0;
const advance = (ms: number) => { clock += ms; };

beforeEach(() => {
  clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

const START = { x: 100, y: 400 };
const END = { x: 700, y: 400 };
const MID = { x: 400, y: 400 };

/** A ball striking the middle of the wall from above. */
const hitFromAbove = (strength = 1) =>
  registerWallImpact(START, END, MID, strength, { x: 400, y: 380 });

beforeEach(() => clearWallImpacts());

describe("registering a hit", () => {
  it("records an impact", () => {
    expect(getActiveImpactCount()).toBe(0);
    hitFromAbove();
    expect(getActiveImpactCount()).toBe(1);
  });

  it("reports the wall as having something near it", () => {
    expect(hasNearbyImpacts(START, END)).toBe(false);
    hitFromAbove();
    expect(hasNearbyImpacts(START, END)).toBe(true);
  });

  it("leaves a wall on the other side of the board alone", () => {
    hitFromAbove();
    expect(hasNearbyImpacts({ x: 100, y: 80 }, { x: 700, y: 80 })).toBe(false);
  });
});

describe("the shape of the bulge", () => {
  beforeEach(() => { hitFromAbove(); advance(85); updateWallImpacts(); });

  it("pushes the wall AWAY from the ball, not toward it", () => {
    // The ball came from above (y 380 < 400), so the wall must dimple downward.
    const at = getEffectsAtPoint(MID, 1);
    expect(Math.abs(at.dy)).toBeGreaterThan(0);
    expect(at.dy, "a wall bulging toward the ball reads as the ball sinking in")
      .toBeGreaterThan(0);
  });

  it("is strongest at the hit and fades along the wall", () => {
    const here = Math.abs(getEffectsAtPoint(MID, 1).dy);
    const near = Math.abs(getEffectsAtPoint({ x: 440, y: 400 }, 1).dy);
    const far = Math.abs(getEffectsAtPoint({ x: 600, y: 400 }, 1).dy);
    expect(here).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
  });

  /** Subtle was the requirement: a wall that visibly bends is a rubber band. */
  it("stays small enough to read as a give, not a wobble", () => {
    expect(Math.abs(getEffectsAtPoint(MID, 1).dy)).toBeLessThan(8);
  });

  it("tapers to nothing at the ends, so it never detaches from a junction", () => {
    for (const p of [START, END]) {
      expect(Math.abs(getEffectsAtPoint(p, 1).dy)).toBeLessThan(0.5);
    }
  });

  it("scales with the strength of the hit", () => {
    const at = (strength: number) => {
      clearWallImpacts();
      registerWallImpact(START, END, MID, strength, { x: 400, y: 380 });
      advance(85);                       // both probes read the envelope's peak
      updateWallImpacts();
      return Math.abs(getEffectsAtPoint(MID, 1).dy);
    };
    expect(at(1)).toBeGreaterThan(at(0.2));
  });

  it("relaxes back to flat", () => {
    advance(2000);
    updateWallImpacts();
    expect(getActiveImpactCount()).toBe(0);
    expect(Math.abs(getEffectsAtPoint(MID, 1).dy)).toBe(0);
  });

  it("costs nothing when nothing has been hit", () => {
    clearWallImpacts();
    const at = getEffectsAtPoint(MID, 1);
    expect(at.dx).toBe(0);
    expect(at.dy).toBe(0);
    expect(at.glow).toBe(0);
  });
});

/**
 * The half that was actually broken. A bulge nothing samples is invisible, and
 * invisible is exactly what it was for as long as it took to replace a renderer.
 */
describe("the renderer actually samples it", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../lib/rendering/sleek/wallLayer.ts"), "utf8",
  );

  it("reads the bulge at all", () => {
    expect(SRC, "the wall layer must consume wallImpactEffects")
      .toMatch(/from "@\/lib\/wallImpactEffects"/);
    expect(SRC).toMatch(/getEffectsAtPoint\(/);
  });

  it("culls with hasNearbyImpacts, so an untouched wall stays cheap", () => {
    // Every wall is redrawn every frame; sampling N_NODES points on all of them
    // unconditionally would pay for the effect on maps that never show it.
    expect(SRC).toMatch(/hasNearbyImpacts\(/);
  });

  it("samples in WORLD units, so a tilted board displaces the right way", () => {
    // getEffectsAtPoint multiplies by the scale it is given. Passing the screen
    // scale and adding the result to screen coordinates would apply a world
    // normal to a rotated frame and push the bulge sideways once the board turns.
    expect(SRC).toMatch(/getEffectsAtPoint\(\{ x: wx, y: wy \}, 1\)/);
  });

  it("still snaps a straight wall to the pixel grid", () => {
    // The bulge must not cost crispness at rest, which is almost always.
    expect(SRC).toMatch(/snapSegment\(/);
  });

  it("samples more than the two endpoints when it does bulge", () => {
    expect(SRC).toMatch(/N_NODES/);
    expect(N_NODES).toBeGreaterThan(2);
  });
});
