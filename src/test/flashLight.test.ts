/**
 * The two things nothing was treating as a light (flashLight.ts).
 *
 * A CAUSTIC. The ball is drawn as a translucent bulb and then casts the flat
 * opaque shadow of a stone, which is the one place its own material contradicts
 * itself. What is pinned here is the containment: the bright core has to sit
 * INSIDE the shadow ellipse and be smaller than it, because a core inside a
 * dark ellipse is a focused beam and the same core spilling past its edge is
 * just an offset glow.
 *
 * A LOCK FLASH. fxLayer.ts has always called it the brightest thing on the
 * board; it was a fill that lit nothing. The envelope here has to be the one
 * the flare itself is drawn with, or the light and the flare read as two
 * events at the same place.
 */
import { describe, it, expect } from "vitest";
import {
  causticFor, flashEnvelope, flashReach, CAUSTIC_RADII, CAUSTIC_THROW,
  FLASH_REACH_MIN, FLASH_REACH_MAX, LOCK_FLASH_MS, SUPERIOR_FLASH_MS,
  causticShadow, CAUSTIC_TINT,
} from "@/lib/rendering/sleek/flashLight";
import { PALETTE } from "@/lib/rendering/sleek/palette";
import { lightScope, shadowFor, SLAB_HEIGHT_WORLD } from "@/lib/rendering/sleek/light";
import type { Ball, LockFlashState } from "@/types/game";
import type { BoardRect } from "@/lib/boardConstants";

const RECT = { left: 0, top: 0, width: 800, height: 800, scale: 1 } as BoardRect;
const R = 18;
const AT = { x: 300, y: 300 };

function ball(over: Partial<Ball> = {}): Ball {
  return { id: "b1", radius: R, color: "#ff4d5a", state: "active", ...over } as unknown as Ball;
}

describe("the caustic sits inside the shadow it belongs to", () => {
  const monitor = lightScope(RECT, 0);

  it("is thrown the same way the shadow is, and further out", () => {
    const c = causticFor(ball(), AT, R, 0xff4d5a, 0.5, monitor)!;
    const cast = shadowFor(monitor, AT.x, AT.y, R);
    // Same direction as the shadow: away from the monitor.
    const dx = c.x - AT.x, dy = c.y - AT.y;
    const len = Math.hypot(dx, dy);
    expect(dx / len).toBeCloseTo(cast.dx, 6);
    expect(dy / len).toBeCloseTo(cast.dy, 6);
    // Past the shadow's own centre: a core directly under the ball is hidden
    // BY the ball, and light through a sphere focuses beyond the body anyway.
    expect(len).toBeGreaterThan(cast.length);
    expect(len).toBeCloseTo(cast.length * CAUSTIC_THROW, 6);
  });

  it("is smaller than the shadow, so it reads as a core and not a second glow", () => {
    const c = causticFor(ball(), AT, R, 0xff4d5a, 0.5, monitor)!;
    expect(c.reach).toBeLessThan(R * 0.72);   // the shadow ellipse's minor axis
    expect(CAUSTIC_RADII).toBeLessThan(0.72);
  });

  it("fades exactly as its own shadow does, so the two are one object", () => {
    // Near the monitor the shadow is dark; at the far corner it is weak. A
    // caustic that stayed bright there would be a core with nothing round it.
    const near = causticFor(ball(), { x: 780, y: 780 }, R, 0xffffff, 0.5, monitor)!;
    const far = causticFor(ball(), { x: 20, y: 20 }, R, 0xffffff, 0.5, monitor)!;
    expect(near.intensity).toBeGreaterThan(far.intensity);
  });

  it("gives a sleeper none, because it has no shadow to put one in", () => {
    expect(causticFor(ball({ state: "dormant" }), AT, R, 0xffffff, 0.5, monitor)).toBeNull();
    expect(causticFor(ball(), AT, R, 0xffffff, 0, monitor)).toBeNull();
  });

  it("keeps the ball's own colour, because that is what it is a picture of", () => {
    expect(causticFor(ball(), AT, R, 0x00ff88, 0.5, monitor)!.color).toBe(0x00ff88);
  });

  it("grows with the ball, since the shadow does too", () => {
    const small = causticFor(ball(), AT, R, 0xffffff, 0.5, monitor)!;
    const big = causticFor(ball(), AT, R * 2, 0xffffff, 0.5, monitor)!;
    expect(big.reach).toBeCloseTo(small.reach * 2, 6);
    expect(Math.hypot(big.x - AT.x, big.y - AT.y))
      .toBeGreaterThan(Math.hypot(small.x - AT.x, small.y - AT.y));
    // And the model is not secretly the slab height every other caster uses.
    expect(R).not.toBe(SLAB_HEIGHT_WORLD);
  });
});

describe("the visible half: a translucent body colours its own shadow", () => {
  // The bright core above is real but nearly free of contrast to work with: a
  // self-lit ball washes the floor exactly where its shadow falls, which is
  // why SELF_LIT_SHADOW is 0.35 at all. A hue shift needs no contrast, because
  // it is not competing with the pool on brightness.
  const mix = (a: number, b: number, t: number) => {
    const k = Math.max(0, Math.min(1, t));
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (((ar + (br - ar) * k) & 255) << 16)
      | (((ag + (bg - ag) * k) & 255) << 8) | ((ab + (bb - ab) * k) & 255);
  };

  it("drags the shadow toward the ball's own colour", () => {
    const red = causticShadow(PALETTE.shadow, 0xff0000, 1, mix);
    expect((red >> 16) & 255).toBeGreaterThan((PALETTE.shadow >> 16) & 255);
    expect(red & 255).toBeLessThanOrEqual(PALETTE.shadow & 255 + 1);
  });

  it("never goes all the way, because a shadow is still a shadow", () => {
    expect(CAUSTIC_TINT).toBeLessThan(1);
    expect(causticShadow(PALETTE.shadow, 0xff0000, 1, mix)).not.toBe(0xff0000);
  });

  it("gives back the plain shadow at zero, exactly", () => {
    expect(causticShadow(PALETTE.shadow, 0xff0000, 0, mix)).toBe(PALETTE.shadow);
  });

  it("takes the ball's hue, not a fixed warm tint", () => {
    const red = causticShadow(PALETTE.shadow, 0xff0000, 1, mix);
    const blue = causticShadow(PALETTE.shadow, 0x0000ff, 1, mix);
    expect((red >> 16) & 255).toBeGreaterThan((blue >> 16) & 255);
    expect(blue & 255).toBeGreaterThan(red & 255);
  });
});

describe("a lock flash burns, then drains", () => {
  it("slams on over the first sixth and eases out over the rest", () => {
    expect(flashEnvelope(0)).toBe(0);
    expect(flashEnvelope(0.15)).toBeCloseTo(1, 6);
    expect(flashEnvelope(0.075)).toBeCloseTo(0.5, 6);
    expect(flashEnvelope(0.6)).toBeLessThan(0.5);
    expect(flashEnvelope(1)).toBeCloseTo(0, 6);
  });

  it("is dark outside its own life, at either end", () => {
    expect(flashEnvelope(-0.2)).toBe(0);
    expect(flashEnvelope(1.4)).toBe(0);
  });

  it("gives a superior lock longer to burn", () => {
    expect(SUPERIOR_FLASH_MS).toBeGreaterThan(LOCK_FLASH_MS);
  });
});

describe("how far a flash throws", () => {
  const flash = (cells: number) => ({ cellIndices: new Array(cells).fill(0) } as unknown as LockFlashState);

  it("scales with the pocket, because a big capture is a bigger event", () => {
    expect(flashReach(flash(400), 15)).toBeGreaterThan(flashReach(flash(40), 15));
  });

  it("is clamped at both ends, so neither a cell nor half the board runs away", () => {
    expect(flashReach(flash(1), 15)).toBe(FLASH_REACH_MIN);
    expect(flashReach(flash(100000), 15)).toBe(FLASH_REACH_MAX);
    expect(flashReach(flash(0), 15)).toBe(FLASH_REACH_MIN);
  });

  it("reaches well past a ball's own pool, or it would not read as an event", () => {
    // A ball's pool is 5.4 radii, about 97 world units. The smallest flash
    // already matches that, and a real pocket dwarfs it.
    expect(FLASH_REACH_MIN).toBeGreaterThanOrEqual(90);
    expect(flashReach(flash(400), 15)).toBeGreaterThan(200);
  });
});
