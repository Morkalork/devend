/**
 * Ball region reassignment (regionOwnership.ts): the grid fast-path added for
 * post-cut performance must be a DROP-IN for the sample scan. A wrong region
 * assignment means a ball escaping or getting stuck, so this proves the O(1)
 * grid lookup yields the exact same region ids as the O(regions x samples x
 * walls) scan, across many positions.
 */
import { describe, it, expect } from "vitest";
import {
  reassignBallsToRegions,
  validateAllBallOwnership,
  paintCellRegionIds,
} from "@/lib/regionOwnership";
import { createSpaceGrid } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import type { Region, Ball, Vector2 } from "@/types/game";

// A 300x300 board on a 15-unit grid (20x20 cells); cell centres at 7.5 + 15*n.
const BOARD = createRectPolygon(0, 0, 300, 300);

/** Sample points on the cell lattice for every cell whose centre satisfies `pick`. */
function samplesWhere(pick: (x: number, y: number) => boolean): Vector2[] {
  const pts: Vector2[] = [];
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 20; col++) {
      const x = 7.5 + 15 * col, y = 7.5 + 15 * row;
      if (pick(x, y)) pts.push({ x, y });
    }
  }
  return pts;
}

/** Left/right split at x=150, no wall between (so the sample scan is unambiguous). */
function makeRegions(): Region[] {
  return [
    { id: "left", polygon: createRectPolygon(0, 0, 150, 300), samplePoints: samplesWhere(x => x < 150) },
    { id: "right", polygon: createRectPolygon(150, 0, 300, 300), samplePoints: samplesWhere(x => x >= 150) },
  ];
}

function ballAt(id: string, x: number, y: number): Ball {
  return { id, position: { x, y }, regionId: "unassigned", state: "active" } as unknown as Ball;
}

describe("reassignBallsToRegions grid fast-path is a drop-in for the sample scan", () => {
  it("assigns the same region ids with and without the grid, across many positions", () => {
    const regions = makeRegions();
    const grid = createSpaceGrid(BOARD, [], 15);
    paintCellRegionIds(grid, regions);

    // A spread of positions across both halves (kept off the x=150 seam).
    const positions: Vector2[] = [];
    for (const x of [30, 75, 120, 180, 225, 270]) {
      for (const y of [30, 90, 150, 210, 270]) positions.push({ x, y });
    }

    for (const p of positions) {
      const withScan = ballAt("s", p.x, p.y);
      const withGrid = ballAt("g", p.x, p.y);
      reassignBallsToRegions([withScan], regions, [], null); // sample scan (old path)
      reassignBallsToRegions([withGrid], regions, [], grid); // O(1) grid path
      expect(withGrid.regionId, `pos ${p.x},${p.y}`).toBe(withScan.regionId);
      // ...and it's the geometrically correct half.
      expect(withGrid.regionId).toBe(p.x < 150 ? "left" : "right");
    }
  });

  it("validateAllBallOwnership keeps a correctly-assigned ball valid via the grid", () => {
    const regions = makeRegions();
    const grid = createSpaceGrid(BOARD, [], 15);
    paintCellRegionIds(grid, regions);

    const ball = ballAt("b", 75, 150);
    reassignBallsToRegions([ball], regions, [], grid);
    expect(ball.regionId).toBe("left");

    const { allValid } = validateAllBallOwnership([ball], regions, [], grid);
    expect(allValid).toBe(true);
    expect(ball.regionId).toBe("left"); // unchanged
  });

  it("falls back to the scan when no grid is provided (unchanged behaviour)", () => {
    const regions = makeRegions();
    const ball = ballAt("b", 225, 150);
    reassignBallsToRegions([ball], regions, []); // no grid arg at all
    expect(ball.regionId).toBe("right");
  });
});
