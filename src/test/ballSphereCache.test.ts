/**
 * Regression: the sphere-shading cache is keyed partly by a per-ball id hash.
 * Balls with unique ids spawn over a session (rainbow spitter, boss minions),
 * so that hash MUST fold into a bounded set of buckets, or the cache grows
 * forever and crashes the tab after ~10 minutes. This guards the fold.
 */
import { describe, it, expect } from "vitest";
import { sphereHashBucket, HASH_BUCKETS } from "@/lib/ballSphereCache";

describe("sphereHashBucket (ball sphere cache leak guard)", () => {
  it("folds any hash (incl. negative) into [0, HASH_BUCKETS)", () => {
    const seen = new Set<number>();
    for (let h = -5000; h <= 5000; h++) {
      const b = sphereHashBucket(h);
      expect(Number.isInteger(b)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(HASH_BUCKETS);
      seen.add(b);
    }
    // 10001 distinct input hashes collapse to at most HASH_BUCKETS variants,
    // so the cache can never grow with the number of spawned ball ids.
    expect(seen.size).toBeLessThanOrEqual(HASH_BUCKETS);
  });

  it("is stable (same hash -> same bucket)", () => {
    expect(sphereHashBucket(12345)).toBe(sphereHashBucket(12345));
  });
});
