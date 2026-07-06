import { describe, it, expect } from "vitest";
import { flameTonguesForCount } from "@/lib/rendering/renderFrame";

/**
 * Flame LOD: tongue count (each tongue is a blit) must degrade monotonically as
 * more balls burn, stay within the full-detail bound at low counts, and never
 * drop to zero (a ball should always visibly burn).
 */
describe("flameTonguesForCount", () => {
  it("uses full detail for a light board", () => {
    expect(flameTonguesForCount(1)).toBe(12);
    expect(flameTonguesForCount(8)).toBe(12);
  });

  it("degrades as the board fills", () => {
    expect(flameTonguesForCount(14)).toBe(9);
    expect(flameTonguesForCount(20)).toBe(6);
    expect(flameTonguesForCount(30)).toBe(4);
    expect(flameTonguesForCount(50)).toBe(3);
  });

  it("is monotonically non-increasing and always keeps at least one tongue", () => {
    let prev = Infinity;
    for (let n = 0; n <= 200; n++) {
      const t = flameTonguesForCount(n);
      expect(t).toBeLessThanOrEqual(prev);
      expect(t).toBeGreaterThanOrEqual(1);
      prev = t;
    }
  });

  it("keeps total flame blits bounded across realistic ball counts", () => {
    // tongues * balls stays within a sane per-frame budget up to a crowded board.
    // (Past ~50 the 3-tongue floor means it grows slowly but linearly.)
    for (const n of [8, 14, 20, 30, 50]) {
      expect(flameTonguesForCount(n) * n).toBeLessThanOrEqual(150);
    }
  });
});
