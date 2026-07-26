import { describe, it, expect } from "vitest";
import { bonusLockMultiplierAt } from "@/lib/lockZones";
import { rotateLockZone } from "@/lib/mapRotation";
import type { LockZone } from "@/types/level";

const zone = (x: number, y: number, w: number, h: number, m: number): LockZone => ({
  x, y, width: w, height: h, multiplier: m,
});

describe("bonusLockMultiplierAt", () => {
  it("returns 1 with no zones", () => {
    expect(bonusLockMultiplierAt(100, 100, [])).toBe(1);
  });

  it("returns the multiplier inside a zone, 1 outside", () => {
    const zones = [zone(100, 100, 200, 200, 3)];
    expect(bonusLockMultiplierAt(150, 150, zones)).toBe(3);
    expect(bonusLockMultiplierAt(50, 50, zones)).toBe(1);   // left/above
    expect(bonusLockMultiplierAt(350, 150, zones)).toBe(1); // right of it
  });

  it("takes the largest multiplier among overlapping zones (no stacking)", () => {
    const zones = [zone(0, 0, 300, 300, 2), zone(100, 100, 300, 300, 4)];
    expect(bonusLockMultiplierAt(150, 150, zones)).toBe(4); // inside both -> max
    expect(bonusLockMultiplierAt(50, 50, zones)).toBe(2);   // only the first
  });

  it("counts the boundary as inside", () => {
    const zones = [zone(100, 100, 100, 100, 2)];
    expect(bonusLockMultiplierAt(100, 100, zones)).toBe(2); // top-left corner
    expect(bonusLockMultiplierAt(200, 200, zones)).toBe(2); // bottom-right corner
  });
});

describe("rotateLockZone", () => {
  it("is a no-op at rotation 0", () => {
    const z = zone(100, 0, 200, 40, 2);
    expect(rotateLockZone(z, 0)).toBe(z);
  });

  it("rotates the rect and preserves the multiplier", () => {
    const z = zone(100, 0, 200, 40, 3);
    const r = rotateLockZone(z, 1); // 90 left: width/height swap
    expect(r.multiplier).toBe(3);
    expect(r.width).toBeCloseTo(40);
    expect(r.height).toBeCloseTo(200);
  });
});
