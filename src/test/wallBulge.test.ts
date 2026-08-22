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
import { WALL_THICKNESS } from "@/lib/wallGeometry";

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

/** balls.yml: a standard red ball. impactStrength is speed/400 in updateBall. */
const BASE_SPEED = 250;

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
  // A standard ball's base speed, i.e. the hit the player actually sees most.
  beforeEach(() => { hitFromAbove(BASE_SPEED / 400); advance(85); updateWallImpacts(); });

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

  /**
   * The size band, stated against the wall's own thickness because that is what
   * makes it visible or not. Reported as invisible on dev, and it was: strength
   * is speed/400 and a standard ball runs at 250, so a typical hit asked for
   * 6 x 0.625 = 3.8 units, about HALF the wall's 6-unit thickness and under two
   * screen pixels on a phone. Big enough to exist, too small to see.
   *
   * Both ends matter. Under about a thickness and it disappears again; past
   * three and the wall reads as rubber rather than as a solid taking a knock.
   */
  it("displaces a typical hit by more than the wall is thick", () => {
    const typical = Math.abs(getEffectsAtPoint(MID, 1).dy);
    expect(typical, "smaller than the wall itself is invisible in play")
      .toBeGreaterThan(WALL_THICKNESS * 0.9);
    expect(typical, "a wall this bendy stops reading as a wall")
      .toBeLessThan(WALL_THICKNESS * 2);
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
 * The outer wall, and why the effect looked like a fences-only feature.
 *
 * Board edges DO exist as walls and DID register impacts. They were drawn
 * inside a scope masked to the board polygon, so an edge wall was already half
 * clipped and its bulge - which pushes AWAY from the ball, i.e. outward - was
 * clipped away entirely. Every hit on the rim of the board was computed,
 * displaced, and then cropped out of existence.
 */
describe("the board's outer wall", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../lib/rendering/sleek/wallLayer.ts"), "utf8",
  );

  /**
   * There are TWO masks between a board-edge bulge and the screen, and dodging
   * one is not enough. Escaping the inner fenceMask still left the frame
   * clipped flat by boardScope's mask, which is the same board polygon applied
   * to every layer at once: reported as the effect happening "underneath the
   * wall", because the only part that survived was the sliver falling inside
   * the boundary.
   */
  it("is drawn outside the fence mask", () => {
    expect(SRC).toMatch(/readonly outer = new Container\(\)/);
    expect(SRC).toMatch(/this\.fenceScope\.mask = this\.fenceMask;/);
    expect(SRC).not.toMatch(/this\.outer\.mask/);
  });

  it("is hung outside the BOARD scope too, which is the mask that caught it", () => {
    const R = readFileSync(
      resolve(__dirname, "../lib/rendering/sleek/SleekRenderer.ts"), "utf8",
    );
    expect(R, "the frame must not live inside the masked board scope")
      .toMatch(/this\.root\.addChild\(this\.walls\.outer\)/);
    const scope = R.slice(R.indexOf("this.boardScope.addChild("), R.indexOf("this.root.addChild"));
    expect(scope, "walls.outer inside boardScope is the bug").not.toMatch(/walls\.outer/);
  });

  it("offsets each edge along its own normal, not radially from the centre", () => {
    // A radial push is a scale-out: on a rectangle it moves corners further
    // than edge midpoints, so the frame sits at a different distance from the
    // boundary depending where you look, and the corners open up.
    expect(SRC).toMatch(/nx \* mx \+ ny \* my < 0/);
  });

  it("stops the masked pass drawing board edges twice", () => {
    expect(SRC).toMatch(/if \(isEdge\) continue;/);
  });

  it("fits inside the board's margin instead of overhanging the page", () => {
    const m = SRC.match(/const OUTER_WALL_THICKNESS = (\d+)/);
    const thickness = Number(m![1]);
    // initGame insets the play area by ARENA_MARGIN of the board on each side;
    // the frame is drawn into that gap, so it has to be narrower than it.
    const margin = 900 * 0.05;
    expect(thickness).toBeLessThan(margin);
  });

  it("is heavier than a fence, so the frame reads as structure", () => {
    const m = SRC.match(/const OUTER_WALL_THICKNESS = (\d+)/);
    expect(m, "the outer wall needs its own thickness").toBeTruthy();
    expect(Number(m![1])).toBeGreaterThan(WALL_THICKNESS);
  });
});

/**
 * Obstacles take the same knock. `obstacleBulgeAt` was live and unread, exactly
 * like the wall bulge and the glow before it.
 */
describe("obstacles dent where they are struck", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../lib/rendering/sleek/entityLayer.ts"), "utf8",
  );

  it("reads the obstacle bulge", () => {
    expect(SRC).toMatch(/obstacleBulgeAt\(/);
    expect(SRC).toMatch(/anyObstacleImpactsActive\(/);
  });

  it("subdivides the outline, or a four-corner slab just moves", () => {
    // Pushing four corners around translates the shape; a dent needs points
    // between them for the falloff to land on.
    expect(SRC).toMatch(/DENT_STEP/);
  });

  it("displaces in world units, so a tilted board dents the right way", () => {
    expect(SRC).toMatch(/obstacleBulgeAt\(wx, wy, 1\)/);
  });

  it("keeps the snapped fast path when nothing has hit anything", () => {
    expect(SRC).toMatch(/if \(!anyObstacleImpactsActive\(\)\) \{[\s\S]{0,120}snapContour/);
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
