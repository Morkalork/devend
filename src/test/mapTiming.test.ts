/**
 * Map time limit (mapTiming.ts): the hard per-map deadline and the tutorial-band
 * exemption that also disables Ship Early.
 */
import { describe, it, expect } from "vitest";
import {
  getMapTimeLimit,
  isTimingExempt,
  DEFAULT_MAP_TIME_LIMIT,
  TIME_LIMIT_EXEMPT_MAX_LEVEL,
} from "@/lib/mapTiming";

describe("map time limit", () => {
  it("exempts the tutorial band (levels 1..3)", () => {
    for (let n = 1; n <= TIME_LIMIT_EXEMPT_MAX_LEVEL; n++) {
      expect(isTimingExempt(n)).toBe(true);
      expect(getMapTimeLimit({}, n)).toBeNull();
    }
    expect(isTimingExempt(TIME_LIMIT_EXEMPT_MAX_LEVEL + 1)).toBe(false);
  });

  it("defaults to 60s just past the tutorial band, then ramps down 10s per 10 maps", () => {
    expect(getMapTimeLimit({}, 4)).toBe(DEFAULT_MAP_TIME_LIMIT); // 60
    expect(getMapTimeLimit({}, 10)).toBe(60); // still first 10 maps
    expect(getMapTimeLimit({}, 11)).toBe(50); // after 10 maps
    expect(getMapTimeLimit({}, 21)).toBe(40);
    expect(getMapTimeLimit({}, 31)).toBe(30);
    expect(getMapTimeLimit({}, 41)).toBe(30); // floored at MIN_MAP_TIME_LIMIT
    expect(DEFAULT_MAP_TIME_LIMIT).toBe(60);
  });

  it("honours a per-map override, in the tutorial band too", () => {
    expect(getMapTimeLimit({ timeLimit: 90 }, 12)).toBe(90);
    // A generous ascension map, say.
    expect(getMapTimeLimit({ timeLimit: 120 }, 31)).toBe(120);
    // An authored clock is the map's own design: the brick ladder's second map
    // is thirty seconds on purpose. The band only spares a map the DEFAULT clock.
    expect(getMapTimeLimit({ timeLimit: 30 }, 2)).toBe(30);
    expect(getMapTimeLimit({}, 2)).toBeNull();
  });

  it("falls back to the default for a garbage override", () => {
    expect(getMapTimeLimit({ timeLimit: 0 }, 5)).toBe(DEFAULT_MAP_TIME_LIMIT);
    expect(getMapTimeLimit({ timeLimit: -30 }, 5)).toBe(DEFAULT_MAP_TIME_LIMIT);
    expect(getMapTimeLimit({ timeLimit: NaN }, 5)).toBe(DEFAULT_MAP_TIME_LIMIT);
  });
});
