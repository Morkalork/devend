/**
 * The light saying what the ball is about to do (ballTell.ts).
 *
 * The flicker is a hashed function of the clock: the prettiest thing on the
 * board, and it means nothing. This is the same channel carrying something the
 * eye can learn - which costs exactly what the meaningless version cost.
 *
 * Every one of these is a pure function of state that already existed. Nothing
 * here needed a new field, a tick, or anything to clean up, and that is worth
 * keeping true: a tell that has to be reset is a tell that will be wrong.
 */
import { describe, it, expect } from "vitest";
import {
  warmup, tell, collapse, WARMUP_MS, WARMUP_EMBER, WARMUP_HUE_LEAD,
  TELL_DEPTH, COLLAPSE_TO,
} from "@/lib/rendering/ballTell";
import { ballLight, REACH_RADII } from "@/lib/rendering/sleek/ballLight";
import type { Ball } from "@/types/game";

const R = 18;
const AT = { x: 100, y: 100 };

function ball(over: Partial<Ball> = {}): Ball {
  return { id: "b1", radius: R, color: "#ff4d5a", state: "active", ...over } as unknown as Ball;
}

/** A compass with a 6-second interval whose next turn is at t = 6. */
function compass(nextTurnAt: number): Ball {
  return ball({ ability: "turnTimer", nextTurnAt, turnIntervalSeconds: 6 });
}

describe("waking: a filament, not a switch", () => {
  it("comes up from nothing to full over the warm-up", () => {
    expect(warmup(1000, 1000).gain).toBeCloseTo(0, 6);
    expect(warmup(1000 + WARMUP_MS, 1000).gain).toBe(1);
    expect(warmup(1000 + WARMUP_MS * 2, 1000).gain).toBe(1);
  });

  it("lights late rather than ramping evenly, the way a cold filament does", () => {
    // Halfway through the warm-up a linear ramp would be at 0.5. Being under
    // it early is what makes this read as switching on rather than as a dimmer
    // being turned up.
    expect(warmup(1000 + WARMUP_MS * 0.25, 1000).gain).toBeLessThan(0.25);
    expect(warmup(1000 + WARMUP_MS * 0.5, 1000).gain).toBeCloseTo(0.5, 2);
  });

  it("reaches its colour BEFORE it reaches full brightness", () => {
    // The other way round gives a ball at full output in the wrong hue, which
    // reads as a bug rather than as a warm-up.
    const at = warmup(1000 + WARMUP_MS * 0.6, 1000);
    expect(at.hue).toBeGreaterThan(at.gain);
    expect(WARMUP_HUE_LEAD).toBeGreaterThan(1);
    expect(warmup(1000 + WARMUP_MS / WARMUP_HUE_LEAD, 1000).hue).toBeCloseTo(1, 6);
  });

  it("starts on an ember, so the hue is WRONG and then corrects", () => {
    // Dimming alone reads as a ball far away or half occluded. A hue that
    // travels is what reads as coming up to temperature.
    expect((WARMUP_EMBER >> 16) & 255).toBeGreaterThan(WARMUP_EMBER & 255);
    expect(warmup(1000, 1000).hue).toBeCloseTo(0, 6);
  });

  it("is full for a ball with no spawn time, and for a clock that ran backwards", () => {
    expect(warmup(1000, undefined)).toEqual({ gain: 1, hue: 1 });
    expect(warmup(500, 1000)).toEqual({ gain: 1, hue: 1 });
  });
});

describe("the countdown: a compass announces its turn", () => {
  it("says nothing at all for a ball with no timer", () => {
    expect(tell(ball(), 0)).toBe(1);
    expect(tell(ball({ ability: "attract" }), 0)).toBe(1);
    // Nor for a compass whose timer has not been armed yet.
    expect(tell(ball({ ability: "turnTimer" }), 0)).toBe(1);
  });

  it("swings harder as the turn approaches", () => {
    // Sampled across a whole beat at each stage, because the instantaneous
    // value depends where in the beat you land; what grows is the SWING.
    const swing = (progress: number) => {
      let lo = 1, hi = 0;
      for (let k = 0; k < 60; k++) {
        // Nudge the phase by moving the clock a fraction of the interval.
        const at = 6 * progress + (k / 60) * (6 / 4);
        const v = tell(compass(6), Math.min(6, at));
        lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
      return hi - lo;
    };
    expect(swing(0.8)).toBeGreaterThan(swing(0.2));
  });

  it("never puts the light out, only leans on it", () => {
    for (let k = 0; k <= 100; k++) {
      const v = tell(compass(6), (k / 100) * 6);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
      expect(v).toBeGreaterThanOrEqual(1 - TELL_DEPTH - 1e-9);
    }
  });

  it("is quiet at the very start of a countdown, when there is nothing to say", () => {
    expect(tell(compass(6), 0)).toBeCloseTo(1, 6);
  });
});

describe("dying: the pool goes into the pocket with the ball", () => {
  it("pulls the reach in as the ball drains", () => {
    expect(collapse(0)).toBe(1);
    expect(collapse(1)).toBeCloseTo(COLLAPSE_TO, 6);
    expect(collapse(0.5)).toBeGreaterThan(COLLAPSE_TO);
    expect(collapse(0.5)).toBeLessThan(1);
  });

  it("never reaches zero, because a pool that reaches nothing is a hole", () => {
    expect(COLLAPSE_TO).toBeGreaterThan(0);
    expect(collapse(9)).toBeCloseTo(COLLAPSE_TO, 6);
  });

  it("shows up on the light itself, not just in the helper", () => {
    const fresh = ballLight(ball({ state: "won", assimColorFade: 0 }), AT, R, 0xffffff)!;
    const gone = ballLight(ball({ state: "won", assimColorFade: 1 }), AT, R, 0xffffff)!;
    expect(fresh.reach).toBeCloseTo(R * REACH_RADII, 6);
    expect(gone.reach).toBeLessThan(fresh.reach * 0.25);
    // A ball still in play is untouched by any of it.
    expect(ballLight(ball(), AT, R, 0xffffff)!.reach).toBeCloseTo(R * REACH_RADII, 6);
  });
});
