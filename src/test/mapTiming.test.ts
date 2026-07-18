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

  it("defaults to 60s once past the tutorial band", () => {
    expect(getMapTimeLimit({}, 4)).toBe(DEFAULT_MAP_TIME_LIMIT);
    expect(getMapTimeLimit({}, 40)).toBe(DEFAULT_MAP_TIME_LIMIT);
    expect(DEFAULT_MAP_TIME_LIMIT).toBe(60);
  });

  it("honours a per-map override, but never on an exempt level", () => {
    expect(getMapTimeLimit({ timeLimit: 90 }, 12)).toBe(90);
    // A generous ascension map, say.
    expect(getMapTimeLimit({ timeLimit: 120 }, 31)).toBe(120);
    // Override is ignored while the level is still in the tutorial band.
    expect(getMapTimeLimit({ timeLimit: 90 }, 2)).toBeNull();
  });

  it("falls back to the default for a garbage override", () => {
    expect(getMapTimeLimit({ timeLimit: 0 }, 5)).toBe(DEFAULT_MAP_TIME_LIMIT);
    expect(getMapTimeLimit({ timeLimit: -30 }, 5)).toBe(DEFAULT_MAP_TIME_LIMIT);
    expect(getMapTimeLimit({ timeLimit: NaN }, 5)).toBe(DEFAULT_MAP_TIME_LIMIT);
  });
});
