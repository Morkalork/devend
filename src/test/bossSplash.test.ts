/**
 * Boss birth splash (#56): the stateless wet-burst helper both renderers draw
 * when a minion buds out of the boss.
 */
import { describe, it, expect } from "vitest";
import { bossSplashFrame, SPLASH_MS } from "@/lib/rendering/bossSplash";

const R = 30, DIR_X = 1, DIR_Y = 0, START = 1000, SCALE = 1, SEED = 1000;

describe("bossSplashFrame", () => {
  it("is inactive before the split and after the window closes", () => {
    expect(bossSplashFrame(R, DIR_X, DIR_Y, START, START - 1, SCALE, SEED).active).toBe(false);
    expect(bossSplashFrame(R, DIR_X, DIR_Y, START, START + SPLASH_MS + 1, SCALE, SEED).active).toBe(false);
  });

  it("sprays a burst of droplets during the window", () => {
    const f = bossSplashFrame(R, DIR_X, DIR_Y, START, START + SPLASH_MS * 0.2, SCALE, SEED);
    expect(f.active).toBe(true);
    expect(f.droplets.length).toBeGreaterThan(4);
    expect(f.droplets.every((d) => d.r > 0)).toBe(true);
  });

  it("is deterministic for the same seed and time", () => {
    const a = bossSplashFrame(R, DIR_X, DIR_Y, START, START + 100, SCALE, SEED);
    const b = bossSplashFrame(R, DIR_X, DIR_Y, START, START + 100, SCALE, SEED);
    expect(a.droplets.map((d) => [d.x, d.y, d.r])).toEqual(b.droplets.map((d) => [d.x, d.y, d.r]));
  });

  it("centres the rupture ring on the emergence point (the rim in the birth direction)", () => {
    const f = bossSplashFrame(R, DIR_X, DIR_Y, START, START + 50, SCALE, SEED);
    expect(f.ringX).toBeCloseTo(R, 6); // dir = +x, so the rim point is (R, 0)
    expect(f.ringY).toBeCloseTo(0, 6);
  });

  it("fades out toward the end of the window", () => {
    const early = bossSplashFrame(R, DIR_X, DIR_Y, START, START + SPLASH_MS * 0.15, SCALE, SEED);
    const late = bossSplashFrame(R, DIR_X, DIR_Y, START, START + SPLASH_MS * 0.9, SCALE, SEED);
    const maxA = (frame: typeof early) => Math.max(...frame.droplets.map((d) => d.alpha));
    expect(maxA(late)).toBeLessThan(maxA(early));
  });
});
