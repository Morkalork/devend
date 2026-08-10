/**
 * The fallback path of spawnClearOfParent.
 *
 * The eight-heading search is the easy case. What players hit is the case where
 * it FAILS: a beat firing inside a cramped pocket, where the requested gap does
 * not fit in live space. That path used to return a flat 2 world units from the
 * parent - a tenth of a radius - so the newcomer was born inside the ball it came
 * from and read as that ball duplicating. Reported from map 2, whose beat asks
 * for a 3-radius gap that is also 3 radii clear of the other ball, inside a
 * corridor between two dividers.
 */
import { describe, it, expect } from "vitest";
import { spawnClearOfParent } from "@/lib/physics/spawnPlacement";
import { createSpaceGrid, CellState } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";

const RADIUS = 18;

const ball = (id: string, x: number, y: number): Ball => ({
  id, typeId: "red", state: "active", speed: 200, baseSpeed: 200,
  radius: RADIUS, position: { x, y }, velocity: { x: 200, y: 0 },
  regionId: "r1", effects: {},
} as unknown as Ball);

/** `live` decides which cells stay playable; everything else is captured. */
function gameWith(balls: Ball[], live: (x: number, y: number) => boolean): CanvasGameState {
  const grid = createSpaceGrid(createRectPolygon(45, 45, 855, 855), [], 15);
  for (let i = 0; i < grid.cells.length; i++) {
    const col = i % grid.width, row = (i / grid.width) | 0;
    const x = grid.originX + col * grid.cellSize + grid.cellSize / 2;
    const y = grid.originY + row * grid.cellSize + grid.cellSize / 2;
    grid.cells[i] = live(x, y) ? CellState.ACTIVE : CellState.REMOVED;
  }
  return { spaceGrid: grid, balls } as unknown as CanvasGameState;
}

const dist = (p: { x: number; y: number }, b: Ball) =>
  Math.hypot(p.x - b.position.x, p.y - b.position.y);

describe("spawn placement never births a ball inside its anchor", () => {
  it("keeps a visible gap even when no heading satisfies the request", () => {
    // A pocket far too tight for the requested 3-radius gap in ANY direction.
    const anchor = ball("red-1", 450, 450);
    const game = gameWith([anchor], (x, y) => Math.hypot(x - 450, y - 450) < 20);

    const p = spawnClearOfParent(game, anchor, { gapRadii: 3, clearOfOtherBalls: true });
    // 1.25 radii is the floor at which the two stop reading as one ball. The old
    // fallback returned 2 world units here: 0.11 radii.
    // Epsilon: the point comes back through cos/sin, so the boundary is inexact.
    expect(dist(p, anchor)).toBeGreaterThan(RADIUS * 1.25 - 1e-6);
  });

  it("gives up elbow room from other balls before giving up separation", () => {
    // A corridor: only a thin horizontal band is live, and a second ball sits
    // close enough that the 3-radii clearance can never be met.
    const anchor = ball("red-1", 450, 450);
    const other = ball("red-2", 500, 450);
    const game = gameWith([anchor, other], (_x, y) => Math.abs(y - 450) < 16);

    const p = spawnClearOfParent(game, anchor, { gapRadii: 3, clearOfOtherBalls: true });
    // Epsilon: the point comes back through cos/sin, so the boundary is inexact.
    expect(dist(p, anchor)).toBeGreaterThan(RADIUS * 1.25 - 1e-6);
  });

  it("still prefers the full requested gap when there is room for it", () => {
    const anchor = ball("red-1", 450, 450);
    const game = gameWith([anchor], () => true);

    const p = spawnClearOfParent(game, anchor, { gapRadii: 3, clearOfOtherBalls: true });
    expect(dist(p, anchor)).toBeCloseTo(RADIUS * 3, 5);
  });

  it("holds the floor with no grid at all", () => {
    const anchor = ball("red-1", 450, 450);
    const game = { balls: [anchor] } as unknown as CanvasGameState;

    const p = spawnClearOfParent(game, anchor, { gapRadii: 3 });
    // Epsilon: the point comes back through cos/sin, so the boundary is inexact.
    expect(dist(p, anchor)).toBeGreaterThan(RADIUS * 1.25 - 1e-6);
  });
});
