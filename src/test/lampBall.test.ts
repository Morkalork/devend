/**
 * The Lamp: one ball at a time lights the board, and sealing it pays extra.
 *
 * Three things here are the kind that look fine on screen and are wrong:
 *
 *   THE PICK      must be biased toward the ball that is hardest to seal, or
 *                 the bonus is a lottery that pays for luck as often as play.
 *   THE HOLD      must not re-pick while the current lamp is still in play. A
 *                 lamp that re-evaluated as regions changed would flicker
 *                 between balls and could not be planned around.
 *   THE HANDOVER  must dim while it travels. Every shadow on the board swings
 *                 during those 750ms, and at full brightness that is the
 *                 "nauseating" failure rather than a handover.
 *
 * The payout side is pinned in lampPayout.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  pickLamp, advanceLamp, eligibleForLamp, handoverProgress, lampLevel, lampTravel,
  lampSample, LAMP_HANDOVER_MS, LAMP_DIP,
} from "@/lib/lampBall";
import type { Ball } from "@/types/game";
import type { GridRegion } from "@/lib/spaceGrid";

function ball(id: string, over: Partial<Ball> = {}): Ball {
  return {
    id,
    position: { x: 100, y: 100 },
    velocity: { x: 1, y: 0 },
    radius: 18,
    color: "#ff5b5b",
    state: "active",
    regionId: "r1",
    ...over,
  } as unknown as Ball;
}
const region = (id: string, cellCount: number): GridRegion =>
  ({ id, cellCount, cellIndices: [], centroid: { x: 0, y: 0 } });

describe("choosing the lamp", () => {
  it("gives it to the ball with the most space left around it", () => {
    // THE bias. Uniformly at random, the lamp lands on the ball you were
    // sealing anyway about as often as on one worth chasing, and the bonus
    // pays for luck. The ball in the biggest region is the one furthest from
    // being locked, so the bonus is always a stretch and never free.
    const balls = [ball("a", { regionId: "small" }), ball("b", { regionId: "big" })];
    const regions = [region("small", 40), region("big", 900)];
    expect(pickLamp(balls, regions)).toBe("b");
  });

  it("never gives it to a dormant ball", () => {
    // A sleeper is dark by design: no light, no shadow. And the circuit maps
    // open with every ball dormant, so a lamp that could land on one would
    // leave those maps unlit at exactly their opening.
    const balls = [ball("sleeper", { state: "dormant", regionId: "big" }),
                   ball("awake", { regionId: "small" })];
    const regions = [region("big", 900), region("small", 10)];
    expect(pickLamp(balls, regions)).toBe("awake");
  });

  it("never gives it to a locked ball", () => {
    const balls = [ball("won", { state: "won", regionId: "big" }), ball("live", { regionId: "small" })];
    expect(pickLamp(balls, [region("big", 900), region("small", 10)])).toBe("live");
  });

  it("returns nothing when no ball can hold it", () => {
    // Supported, not an error: the renderer falls back to the monitor.
    expect(pickLamp([ball("s", { state: "dormant" })], [region("r1", 100)])).toBeNull();
    expect(pickLamp([], [])).toBeNull();
  });

  it("breaks ties the same way every time", () => {
    // Seeded runs deal the same board to everyone, so the lamp has to be
    // deterministic too. A Math.random tie-break would silently break that.
    const balls = [ball("b"), ball("a"), ball("c")];
    const regions = [region("r1", 100)];
    const first = pickLamp(balls, regions);
    expect(pickLamp([...balls].reverse(), regions)).toBe(first);
  });
});

describe("holding the lamp", () => {
  const regions = [region("small", 40), region("big", 900)];

  it("does not re-pick while the current lamp is still in play", () => {
    // THE stability rule. Regions shrink constantly as you cut, so a lamp that
    // re-ran its choice each frame would hop between balls mid-map and the
    // bonus could never be aimed for.
    const balls = [ball("a", { regionId: "small" }), ball("b", { regionId: "big" })];
    let lamp = advanceLamp(undefined, balls, regions, 0);
    expect(lamp.ballId).toBe("b");

    // "a" is now in the far bigger region, but "b" still holds the light.
    const shifted = [ball("a", { regionId: "big" }), ball("b", { regionId: "small" })];
    lamp = advanceLamp(lamp, shifted, regions, 5000);
    expect(lamp.ballId, "the lamp hopped while its ball was still in play").toBe("b");
  });

  it("hands over when its ball is locked", () => {
    const balls = [ball("a", { regionId: "small" }), ball("b", { regionId: "big" })];
    let lamp = advanceLamp(undefined, balls, regions, 0);
    expect(lamp.ballId).toBe("b");

    const afterLock = [ball("a", { regionId: "small" }), ball("b", { state: "won", regionId: "big" })];
    lamp = advanceLamp(lamp, afterLock, regions, 1000);
    expect(lamp.ballId).toBe("a");
    // It must remember where it came FROM, or the light blinks out here
    // instead of being carried.
    expect(lamp.fromBallId).toBe("b");
    expect(lamp.switchedAt).toBe(1000);
  });

  it("goes dark rather than clinging to a locked ball", () => {
    const balls = [ball("only", { regionId: "big" })];
    let lamp = advanceLamp(undefined, balls, regions, 0);
    expect(lamp.ballId).toBe("only");
    lamp = advanceLamp(lamp, [ball("only", { state: "won", regionId: "big" })], regions, 100);
    expect(lamp.ballId).toBeNull();
  });

  it("retires a finished handover so it cannot pin a stale ball", () => {
    // `fromBallId` is looked up in the ball list every frame during a handover.
    // Left set forever it would keep resolving a locked ball's position, and
    // the light would stay anchored to something that is no longer playing.
    const balls = [ball("a", { regionId: "small" }), ball("b", { regionId: "big" })];
    let lamp = advanceLamp(undefined, balls, regions, 0);
    const afterLock = [ball("a", { regionId: "small" }), ball("b", { state: "won" })];
    lamp = advanceLamp(lamp, afterLock, regions, 1000);
    expect(lamp.fromBallId).toBe("b");

    lamp = advanceLamp(lamp, afterLock, regions, 1000 + LAMP_HANDOVER_MS + 1);
    expect(lamp.fromBallId, "the handover never ended").toBeNull();
    expect(lamp.ballId).toBe("a");
  });

  it("counts a ball with no region as having no space", () => {
    const balls = [ball("a", { regionId: undefined }), ball("b", { regionId: "small" })];
    expect(pickLamp(balls, regions)).toBe("b");
  });

  it("only calls a ball in play eligible", () => {
    expect(eligibleForLamp(ball("x"))).toBe(true);
    expect(eligibleForLamp(ball("x", { state: "dormant" }))).toBe(false);
    expect(eligibleForLamp(ball("x", { state: "won" }))).toBe(false);
  });
});

describe("the handover", () => {
  const state = { ballId: "b", fromBallId: "a", switchedAt: 1000 };

  it("runs from 0 to 1 over the handover window, then stops", () => {
    expect(handoverProgress(state, 1000)).toBe(0);
    expect(handoverProgress(state, 1000 + LAMP_HANDOVER_MS / 2)).toBeCloseTo(0.5, 5);
    expect(handoverProgress(state, 1000 + LAMP_HANDOVER_MS)).toBe(1);
    expect(handoverProgress(state, 99999)).toBe(1);
  });

  it("reads as settled when there is nothing to hand over from", () => {
    expect(handoverProgress({ ballId: "b", fromBallId: null, switchedAt: 0 }, 0)).toBe(1);
    expect(handoverProgress(undefined, 0)).toBe(1);
  });

  it("dims to its lowest exactly when the light is moving fastest", () => {
    // THE delicate part, and the two curves have to agree. The light travels on
    // a smootherstep, which is fastest at the midpoint; the brightness dips on
    // a half-sine, which is lowest at the midpoint. Pull them apart and the
    // board is brightest while every shadow in the scene swings, which is the
    // version that makes people ill.
    const mid = 0.5;
    expect(lampLevel(mid)).toBeCloseTo(LAMP_DIP, 5);

    // The travel really is fastest there.
    const speedAt = (t: number) => lampTravel(t + 0.01) - lampTravel(t - 0.01);
    expect(speedAt(mid)).toBeGreaterThan(speedAt(0.15));
    expect(speedAt(mid)).toBeGreaterThan(speedAt(0.85));
  });

  it("starts and ends at full brightness, so the dip is the only change", () => {
    expect(lampLevel(0)).toBeCloseTo(1, 5);
    expect(lampLevel(1)).toBeCloseTo(1, 5);
  });

  it("never goes fully dark", () => {
    // The board went out entirely at zero, which reads as a bug, on a game that
    // has already been reported as too dark three times.
    for (let t = 0; t <= 1.0001; t += 0.02) {
      expect(lampLevel(t), `dark at t=${t.toFixed(2)}`).toBeGreaterThan(0.3);
    }
  });

  it("moves the light all the way and no further", () => {
    expect(lampTravel(0)).toBeCloseTo(0, 6);
    expect(lampTravel(1)).toBeCloseTo(1, 6);
    // Monotonic, or the light backtracks mid-handover.
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = lampTravel(t);
      expect(v, `backtracked at t=${t.toFixed(2)}`).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("has barely moved at the ends, so it leaves and lands gently", () => {
    // Smootherstep, not linear. A linear travel starts at full speed, which
    // makes the light jerk away from the ball you just sealed.
    expect(lampTravel(0.1)).toBeLessThan(0.02);
    expect(lampTravel(0.9)).toBeGreaterThan(0.98);
  });
});

describe("sampling the light mid-handover", () => {
  const A = { x: 0, y: 0 };
  const B = { x: 100, y: 200 };

  it("sits on the old ball at the start and the new one at the end", () => {
    const start = lampSample(A, B, 0);
    expect(start.x).toBeCloseTo(A.x, 5);
    expect(start.y).toBeCloseTo(A.y, 5);
    const end = lampSample(A, B, 1);
    expect(end.x).toBeCloseTo(B.x, 5);
    expect(end.y).toBeCloseTo(B.y, 5);
  });

  it("is dimmest exactly where it has travelled halfway", () => {
    // The pairing IS the feature. The renderer used to sample these two by
    // hand, and sampling the position with anything other than lampTravel puts
    // the fastest travel somewhere other than the dimmest moment, which is the
    // shadow-sweep this was built to avoid.
    const mid = lampSample(A, B, 0.5);
    expect(mid.level).toBeCloseTo(LAMP_DIP, 5);
    expect(mid.x).toBeCloseTo((A.x + B.x) / 2, 5);
    expect(mid.y).toBeCloseTo((A.y + B.y) / 2, 5);
    expect(mid.level).toBeLessThan(lampSample(A, B, 0).level);
    expect(mid.level).toBeLessThan(lampSample(A, B, 1).level);
  });

  it("stays on the line between the two balls the whole way", () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const p = lampSample(A, B, t);
      expect(p.y).toBeCloseTo(p.x * 2, 5); // B is exactly (100, 200)
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(B.x + 1e-9);
    }
  });

  it("crosses the colour over with the travel, not on its own clock", () => {
    // Blending faster than the light moves paints the new ball's hue onto the
    // old ball's shadows; slower leaves the new ball lit in the old colour.
    for (const t of [0.2, 0.5, 0.8]) {
      expect(lampSample(A, B, t).blend).toBeCloseTo(lampTravel(t), 10);
    }
  });

  it("holds still when there is no handover", () => {
    const p = lampSample(B, B, 0.5);
    expect(p.x).toBe(B.x);
    expect(p.y).toBe(B.y);
  });
});
