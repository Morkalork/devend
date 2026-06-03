/**
 * Phase 0 gate criterion #1 (headless): the capture pipeline that the Phaser
 * build reuses verbatim produces a correct, deterministic area %.
 *
 * This is engine-agnostic — it does not touch Phaser/Matter. It proves that
 * cut geometry + spaceGrid flood-fill + ball-less-region removal yield the
 * same authoritative area model the React build relies on. The Matter-driven
 * runtime criteria (tunneling, in-region-only collisions) are confirmed in a
 * browser via `?phaser=1` (see SpikeScene).
 */
import { describe, it, expect } from "vitest";
import { createInitialGameData } from "@/lib/initGame";
import { computeGameModifiers } from "@/hooks/useActiveModifiers";
import { LevelConfig } from "@/types/level";
import {
  rasterizeCutToGrid,
  findGridRegions,
  removeRegion,
  getRemainingPercent,
  worldToGridIndex,
} from "@/lib/spaceGrid";
import { castRayWithReflections } from "@/lib/wallGeometry";

const level: LevelConfig = {
  id: "spike-test",
  level: 1,
  sizeThreshold: 50,
  expectedCuts: 4,
  points: 100,
  variety: 0,
  randomShapes: 0,
  // Two balls deterministically placed on opposite sides of a centre cut.
  balls: [
    { id: "left", initialSpeed: 50, topSpeed: 80, color: "ff4444", startX: 250, startY: 450 },
    { id: "right", initialSpeed: 50, topSpeed: 80, color: "44ff44", startX: 650, startY: 450 },
  ],
};

function build() {
  const modifiers = computeGameModifiers([], new Map());
  return createInitialGameData(level, 1, modifiers);
}

describe("Phase 0 spike: reused cut/capture pipeline", () => {
  it("starts with a single full region at 100%", () => {
    const data = build();
    expect(data.spaceGrid.initialActiveCount).toBeGreaterThan(0);
    expect(getRemainingPercent(data.spaceGrid)).toBeCloseTo(100, 5);
    expect(findGridRegions(data.spaceGrid).length).toBe(1);
  });

  it("a centre vertical cut splits the board into two regions", () => {
    const data = build();
    const origin = { x: 450, y: 450 };
    const down = castRayWithReflections(origin, { x: 0, y: 1 }, data.walls)!;
    const up = castRayWithReflections(origin, { x: 0, y: -1 }, data.walls)!;
    const start = up.waypoints[up.waypoints.length - 1];
    const end = down.waypoints[down.waypoints.length - 1];

    rasterizeCutToGrid(data.spaceGrid, start, end, 6);
    const regions = findGridRegions(data.spaceGrid);
    expect(regions.length).toBe(2);
  });

  it("removing the ball-less region drops remaining area to ~half", () => {
    const data = build();
    const start = { x: 450, y: 45 };
    const end = { x: 450, y: 855 };
    rasterizeCutToGrid(data.spaceGrid, start, end, 6);

    const regions = findGridRegions(data.spaceGrid);
    // Keep only the region containing the "right" ball; remove the other.
    const rightBall = data.balls.find((b) => b.id === "right")!;
    const rightIdx = worldToGridIndex(data.spaceGrid, rightBall.position.x, rightBall.position.y);

    let removed = 0;
    for (const r of regions) {
      if (!r.cellIndices.includes(rightIdx)) {
        removeRegion(data.spaceGrid, r);
        removed++;
      }
    }
    expect(removed).toBe(1);

    const pct = getRemainingPercent(data.spaceGrid);
    // Centre cut -> roughly half the board remains (allow rasterization slop).
    expect(pct).toBeGreaterThan(40);
    expect(pct).toBeLessThan(60);
  });

  it("is deterministic across runs (same cut -> same area)", () => {
    const run = () => {
      const data = build();
      rasterizeCutToGrid(data.spaceGrid, { x: 450, y: 45 }, { x: 450, y: 855 }, 6);
      return getRemainingPercent(data.spaceGrid);
    };
    expect(run()).toBeCloseTo(run(), 5);
  });
});
