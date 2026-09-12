import { describe, it, expect } from "vitest";
import { CHEVRON_COUNT, getHeadingChevrons } from "@/lib/rendering/headingChevrons";

const C = { x: 100, y: 100 };
const R = 18;

describe("heading chevrons", () => {
  it("draws nothing for a ball with no heading", () => {
    expect(getHeadingChevrons(C, { x: 0, y: 0 }, R, 0)).toEqual([]);
    expect(getHeadingChevrons(C, { x: 0.2, y: -0.1 }, R, 0)).toEqual([]);
  });

  it("draws three chevrons for a moving ball", () => {
    expect(getHeadingChevrons(C, { x: 200, y: 0 }, R, 0)).toHaveLength(CHEVRON_COUNT);
  });

  it("trails BEHIND the ball, apexes pointing the way it is going", () => {
    // Travelling +x, so every vertex sits at x < centre.x and each apex leads
    // its own wings forward.
    const chevrons = getHeadingChevrons(C, { x: 200, y: 0 }, R, 0);
    for (const ch of chevrons) {
      expect(ch.apex.x).toBeLessThan(C.x);
      expect(ch.left.x).toBeLessThan(ch.apex.x);
      expect(ch.right.x).toBeLessThan(ch.apex.x);
      // Wings straddle the heading axis.
      expect(Math.sign(ch.left.y - C.y)).toBe(-Math.sign(ch.right.y - C.y));
    }
    // And they march away from the ball rather than piling up on it.
    const dist = chevrons.map((ch) => C.x - ch.apex.x);
    expect(dist[1]).toBeGreaterThan(dist[0]);
    expect(dist[2]).toBeGreaterThan(dist[1]);
  });

  it("clears the ball body, so the cue never sits under the sphere", () => {
    for (const ch of getHeadingChevrons(C, { x: 0, y: -140 }, R, 0)) {
      expect(Math.hypot(ch.apex.x - C.x, ch.apex.y - C.y)).toBeGreaterThan(R);
    }
  });

  it("follows the heading, not the axis", () => {
    // Reversing the velocity mirrors the whole cue: a cue that only knew the
    // axis would be identical, which is exactly the ambiguity this fixes.
    const forward = getHeadingChevrons(C, { x: 200, y: 0 }, R, 0);
    const back = getHeadingChevrons(C, { x: -200, y: 0 }, R, 0);
    expect(forward[0].apex.x).toBeLessThan(C.x);
    expect(back[0].apex.x).toBeGreaterThan(C.x);
  });

  it("pulses, and the pulse travels toward the ball", () => {
    // At any instant the chevrons are at different points of the cycle, and
    // over a cycle each one's alpha both rises and falls.
    const now = 0;
    const at = getHeadingChevrons(C, { x: 200, y: 0 }, R, now);
    expect(new Set(at.map((c) => c.alpha.toFixed(4))).size).toBe(CHEVRON_COUNT);

    const samples: number[][] = [];
    for (let t = 0; t < 900; t += 45) {
      samples.push(getHeadingChevrons(C, { x: 200, y: 0 }, R, t).map((c) => c.alpha));
    }
    for (let i = 0; i < CHEVRON_COUNT; i++) {
      const series = samples.map((s) => s[i]);
      expect(Math.max(...series)).toBeGreaterThan(Math.min(...series) + 0.2);
    }

    // The wave runs ball-ward: starting from the far chevron's peak, the middle
    // one peaks next and the near one last, all inside a single cycle. Measured
    // from that peak rather than from t=0, which would just be asking where in
    // the cycle the clock happened to start.
    let farPeak = 0;
    let farAlpha = -1;
    for (let t = 0; t < 900; t += 5) {
      const a = getHeadingChevrons(C, { x: 200, y: 0 }, R, t)[2].alpha;
      if (a > farAlpha) { farAlpha = a; farPeak = t; }
    }
    const peakOffset = (i: number) => {
      let best = 0;
      let bestAlpha = -1;
      for (let d = 0; d < 900; d += 5) {
        const a = getHeadingChevrons(C, { x: 200, y: 0 }, R, farPeak + d)[i].alpha;
        if (a > bestAlpha) { bestAlpha = a; best = d; }
      }
      return best;
    };
    expect(peakOffset(2)).toBe(0);
    expect(peakOffset(1)).toBeGreaterThan(0);
    expect(peakOffset(0)).toBeGreaterThan(peakOffset(1));
  });

  it("stays subtle: never opaque, never invisible", () => {
    for (let t = 0; t < 1800; t += 30) {
      for (const ch of getHeadingChevrons(C, { x: 120, y: 90 }, R, t)) {
        expect(ch.alpha).toBeGreaterThan(0);
        expect(ch.alpha).toBeLessThanOrEqual(0.7);
      }
    }
  });

  it("scales with the ball", () => {
    const small = getHeadingChevrons(C, { x: 200, y: 0 }, 10, 0);
    const big = getHeadingChevrons(C, { x: 200, y: 0 }, 30, 0);
    expect(C.x - big[0].apex.x).toBeGreaterThan(C.x - small[0].apex.x);
  });
});
