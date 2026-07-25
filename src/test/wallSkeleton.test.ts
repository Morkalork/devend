import { describe, it, expect, beforeEach } from "vitest";
import {
  buildWallSkeleton,
  circuitPalette,
  clearWallSkeletonCache,
  WALL_CORE_ALPHA,
} from "@/lib/rendering/wallSkeleton";

const THICK = 6; // world units (WALL_THICKNESS)

describe("buildWallSkeleton", () => {
  beforeEach(() => clearWallSkeletonCache());

  it("returns null for segments too short to carry a circuit", () => {
    // ~30px long at scale 3 → under MIN_SEGMENT_PX
    const geom = buildWallSkeleton(0, 0, 30, 0, 3, THICK, 0, 0, 10, 0);
    expect(geom).toBeNull();
  });

  it("builds a main trace plus nodes for a long segment", () => {
    const geom = buildWallSkeleton(0, 0, 600, 0, 3, THICK, 0, 0, 200, 0);
    expect(geom).not.toBeNull();
    expect(geom!.traces.length).toBeGreaterThanOrEqual(1);
    // Main trace is a polyline with at least a start and end point (>= 4 coords).
    expect(geom!.traces[0].length).toBeGreaterThanOrEqual(4);
    expect(geom!.nodes.length).toBeGreaterThan(0);
  });

  it("is deterministic: same inputs → identical geometry", () => {
    const a = buildWallSkeleton(10, 20, 610, 20, 3, THICK, 1, 2, 201, 2);
    clearWallSkeletonCache();
    const b = buildWallSkeleton(10, 20, 610, 20, 3, THICK, 1, 2, 201, 2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("keeps the whole circuit within the wall band (|lateral| < half thickness·scale)", () => {
    const scale = 3;
    const halfBandPx = (THICK / 2) * scale;
    // Horizontal wall along y=100: lateral offset is |y - 100|.
    const geom = buildWallSkeleton(0, 100, 900, 100, scale, THICK, 0, 0, 300, 0);
    expect(geom).not.toBeNull();
    for (const tr of geom!.traces) {
      for (let i = 1; i < tr.length; i += 2) {
        expect(Math.abs(tr[i] - 100)).toBeLessThanOrEqual(halfBandPx + 0.5);
      }
    }
    for (const nd of geom!.nodes) {
      expect(Math.abs(nd.y - 100)).toBeLessThanOrEqual(halfBandPx + 0.5);
    }
  });

  it("caches on repeated identical calls (same object reference)", () => {
    const a = buildWallSkeleton(5, 5, 605, 5, 3, THICK, 0, 0, 200, 0);
    const b = buildWallSkeleton(5, 5, 605, 5, 3, THICK, 0, 0, 200, 0);
    expect(a).toBe(b);
  });
});

describe("circuitPalette", () => {
  it("derives dim traces and a bright spark from the accent", () => {
    const p = circuitPalette("#33bbff");
    expect(p.trace).toMatch(/^#[0-9a-f]{6}$/);
    expect(p.spark).toMatch(/^#[0-9a-f]{6}$/);
    // Spark is pushed toward white; trace toward black.
    expect(p.spark.toLowerCase()).not.toBe(p.trace.toLowerCase());
    expect(p.traceAlpha).toBeGreaterThan(0);
    expect(p.sparkAlpha).toBeGreaterThan(0);
  });

  it("core alpha is translucent so the circuit shows through", () => {
    expect(WALL_CORE_ALPHA).toBeGreaterThan(0);
    expect(WALL_CORE_ALPHA).toBeLessThan(1);
  });
});
