/**
 * The bulge is a sign that a ball hit here, not a way to reshape the map.
 *
 * Reported with a screenshot of level 17 where whole fences had been bent into
 * curves. The peak of a single impact was fine and had been tuned by eye at 12
 * world units; the problem was that impacts SUM and nothing bounded the sum.
 * Fourteen may be live at once, each lasting 520ms with a 40-unit spread, so a
 * fast ball rattling in a pocket laid down bump on overlapping bump and the
 * displacements added until a fence was a curve.
 *
 * Two independent guards, because either alone leaves a hole: repeat hits in
 * the same place are coalesced into one live impact, and whatever survives that
 * is clamped so the total give at any point can never exceed one impact's peak.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerWallImpact, updateWallImpacts, getEffectsAtPoint, clearWallImpacts,
  registerObstacleImpact, updateObstacleImpacts, obstacleBulgeAt, clearObstacleImpacts,
} from "@/lib/wallImpactEffects";

const A = { x: 100, y: 400 };
const B = { x: 700, y: 400 };
/** Just off the wall on the far side from the ball, where the bump is biggest. */
const HIT = { x: 400, y: 400 };
const BALL = { x: 400, y: 380 };

const give = (p = HIT) => {
  const e = getEffectsAtPoint(p, 1);
  return Math.hypot(e.dx, e.dy);
};

/**
 * A controlled clock. The bulge rides an envelope that is ZERO at the moment of
 * impact and peaks 85ms later, so a test that registers a hit and reads it back
 * immediately measures nothing at all - which is how the first version of this
 * managed to assert a 0.02-unit "bulge".
 */
let clock = 0;
const advanceToPeak = () => { clock += 85; };

beforeEach(() => {
  clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  clearWallImpacts();
  clearObstacleImpacts();
});
afterEach(() => vi.restoreAllMocks());

describe("one impact still reads as it did", () => {
  it("gives a visible bulge at the hit", () => {
    registerWallImpact(A, B, HIT, 1, BALL);
    advanceToPeak();
    updateWallImpacts();
    // Tuned by eye at 12 world units, roughly twice the wall thickness.
    expect(give()).toBeGreaterThan(4);
    expect(give()).toBeLessThanOrEqual(12.001);
  });

  it("falls off along the wall rather than moving all of it", () => {
    registerWallImpact(A, B, HIT, 1, BALL);
    advanceToPeak();
    updateWallImpacts();
    expect(give({ x: 400, y: 400 })).toBeGreaterThan(give({ x: 520, y: 400 }));
    expect(give({ x: 660, y: 400 })).toBeLessThan(1);
  });
});

describe("a flurry of hits is still one impact", () => {
  /** The screenshot: a ball bouncing in a corner, hitting the same fence
   *  several times inside one impact's 520ms life. */
  it("does not stack give when the same spot is hit repeatedly", () => {
    registerWallImpact(A, B, HIT, 1, BALL);
    advanceToPeak();
    updateWallImpacts();
    const single = give();

    for (let i = 0; i < 8; i++) {
      registerWallImpact(A, B, { x: 400 + i, y: 400 }, 1, BALL);
      advanceToPeak();
    updateWallImpacts();
    }
    expect(give(), `eight hits gave ${give()} against one hit's ${single}`)
      .toBeLessThanOrEqual(single + 0.001);
  });

  /**
   * What coalescing protects that the clamp cannot: the buffer holds 14 impacts
   * and pushes the OLDEST out. Without coalescing, a ball rattling on one fence
   * spends the whole buffer on itself in a fraction of a second and every other
   * wall on the board silently stops reacting to being hit.
   */
  it("does not evict other walls' impacts while one is being rattled", () => {
    const FAR_A = { x: 100, y: 700 }, FAR_B = { x: 700, y: 700 };
    const FAR_HIT = { x: 400, y: 700 };
    registerWallImpact(FAR_A, FAR_B, FAR_HIT, 1, { x: 400, y: 680 });

    // A ball bouncing on the other fence, far more times than the buffer holds.
    for (let i = 0; i < 30; i++) {
      registerWallImpact(A, B, { x: 400 + (i % 3), y: 400 }, 1, BALL);
    }
    advanceToPeak();
    updateWallImpacts();
    expect(give(FAR_HIT), "the far wall lost its bulge to the rattling one")
      .toBeGreaterThan(4);
  });

  it("keeps a harder second strike reading as the harder one", () => {
    registerWallImpact(A, B, HIT, 0.4, BALL);
    advanceToPeak();
    updateWallImpacts();
    const soft = give();
    registerWallImpact(A, B, HIT, 1, BALL);
    advanceToPeak();
    updateWallImpacts();
    expect(give()).toBeGreaterThan(soft);
  });

  /**
   * The hard ceiling, driven past the coalescer: hits spread along the wall are
   * separate impacts by design, and their Gaussians still overlap in the middle.
   * Without the clamp that overlap is what bent the fence.
   */
  it("clamps the total however many separate impacts overlap", () => {
    for (let x = 300; x <= 500; x += 25) {
      registerWallImpact(A, B, { x, y: 400 }, 1, BALL);
    }
    advanceToPeak();
    updateWallImpacts();
    for (let x = 300; x <= 500; x += 10) {
      expect(give({ x, y: 400 }), `at x=${x}`).toBeLessThanOrEqual(12.001);
    }
  });

  it("never lets the clamp flip the direction it pushes", () => {
    for (let x = 350; x <= 450; x += 25) {
      registerWallImpact(A, B, { x, y: 400 }, 1, BALL);
    }
    advanceToPeak();
    updateWallImpacts();
    // The ball is above the wall, so every displacement must push downward.
    const e = getEffectsAtPoint(HIT, 1);
    expect(e.dy).toBeGreaterThan(0);
  });

  it("still scales with the board", () => {
    registerWallImpact(A, B, HIT, 1, BALL);
    advanceToPeak();
    updateWallImpacts();
    const full = getEffectsAtPoint(HIT, 1);
    const half = getEffectsAtPoint(HIT, 0.5);
    expect(Math.hypot(half.dx, half.dy)).toBeCloseTo(Math.hypot(full.dx, full.dy) / 2, 5);
  });
});

describe("obstacles get the same ceiling", () => {
  const at = (x: number, y: number) => {
    const d = obstacleBulgeAt(x, y, 1);
    return Math.hypot(d.dx, d.dy);
  };

  it("bulges once when struck", () => {
    registerObstacleImpact({ x: 400, y: 400 }, 0, -1, 1);
    advanceToPeak();
    updateObstacleImpacts();
    expect(at(400, 400)).toBeGreaterThan(4);
  });

  it("does not stack a ball pressing the same edge", () => {
    registerObstacleImpact({ x: 400, y: 400 }, 0, -1, 1);
    advanceToPeak();
    updateObstacleImpacts();
    const single = at(400, 400);
    for (let i = 0; i < 8; i++) {
      registerObstacleImpact({ x: 400 + i, y: 400 }, 0, -1, 1);
      advanceToPeak();
    updateObstacleImpacts();
    }
    expect(at(400, 400)).toBeLessThanOrEqual(single + 0.001);
  });

  it("does not evict other obstacles while one is being pressed", () => {
    registerObstacleImpact({ x: 400, y: 700 }, 0, -1, 1);
    for (let i = 0; i < 30; i++) {
      registerObstacleImpact({ x: 400 + (i % 3), y: 400 }, 0, -1, 1);
    }
    advanceToPeak();
    updateObstacleImpacts();
    expect(at(400, 700), "the other obstacle lost its dome").toBeGreaterThan(4);
  });

  it("clamps overlapping domes spread along an edge", () => {
    for (let x = 340; x <= 460; x += 20) {
      registerObstacleImpact({ x, y: 400 }, 0, -1, 1);
    }
    advanceToPeak();
    updateObstacleImpacts();
    for (let x = 340; x <= 460; x += 10) {
      expect(at(x, 400), `at x=${x}`).toBeLessThanOrEqual(12.001);
    }
  });
});
