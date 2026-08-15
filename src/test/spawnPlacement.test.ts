/**
 * Where a spawned ball is put — the "the ball split / duplicated" bug.
 *
 * Reported three times across three spawners (Fork clone, rainbow spit, map
 * beat add) and fixed twice without being fixed, because every version of the
 * arithmetic was off by a factor of two.
 *
 * The distances in spawnPlacement.ts are CENTRE TO CENTRE, but the comments
 * reasoned in them as though they described the air between the two surfaces
 * ("below ~1 the two still visually merge"). Two same-size balls TOUCH at 2
 * radii. The gap was set to 1.25, so for radius-18 balls the pair was born 22.5
 * units apart when 36 is merely touching: an overlap of 13.5 units, drawn as a
 * single blob that then separates. Which is what a ball splitting looks like.
 *
 * So the assertion that matters is not "is there some gap" but "do the two
 * circles intersect", and it has to be made on a CRAMPED board. The previous
 * regression test ran on an empty 900x900 grid, where the first and widest
 * placement always succeeds and the degraded path it was guarding never
 * executes.
 */
import { describe, it, expect } from "vitest";
import { spawnClearOfParent, spawnInOpenSpace } from "@/lib/physics/spawnPlacement";
import { createSpaceGrid, CellState } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";

const RADIUS = 18;
/** Centre distance at which two same-size balls are exactly touching. */
const TOUCHING = RADIUS * 2;

const ball = (x: number, y: number, id = "blue-1"): Ball => ({
  id, typeId: "blue", state: "active", speed: 200, baseSpeed: 200,
  radius: RADIUS, position: { x, y }, velocity: { x: 100, y: 0 }, regionId: "r1",
} as unknown as Ball);

const openGrid = () => createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], 15);

/**
 * A board captured down to one pocket of `radius` world units around (450,450).
 * This is the state a late beat or a Fork claim actually fires into, and the
 * only state in which the degraded placement passes run at all.
 */
function pocketGrid(radius: number) {
  const grid = openGrid();
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const x = grid.originX + (col + 0.5) * grid.cellSize;
      const y = grid.originY + (row + 0.5) * grid.cellSize;
      if (Math.hypot(x - 450, y - 450) > radius) {
        grid.cells[row * grid.width + col] = CellState.REMOVED;
      }
    }
  }
  return grid;
}

const gameWith = (grid: unknown, balls: Ball[]): CanvasGameState =>
  ({ spaceGrid: grid, balls } as unknown as CanvasGameState);

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("a spawned ball never overlaps the one it came from", () => {
  it("on an open board, where it can have all the room it wants", () => {
    const parent = ball(450, 450);
    const spot = spawnClearOfParent(gameWith(openGrid(), [parent]), parent);
    expect(distance(spot, parent.position)).toBeGreaterThan(TOUCHING);
  });

  /**
   * THE regression. Every pocket size here forces a different degraded pass;
   * the tightest ones are where the old floor of 1.25 radii (22.5 units) was
   * returned, overlapping by more than a third of a ball.
   */
  it("in a pocket too tight for the gap it wanted", () => {
    for (const pocket of [60, 45, 38, 30, 28, 24]) {
      const parent = ball(450, 450);
      const game = gameWith(pocketGrid(pocket), [parent]);
      for (let attempt = 0; attempt < 20; attempt++) {
        const spot = spawnClearOfParent(game, parent, { gapRadii: 3, clearOfOtherBalls: true });
        expect(distance(spot, parent.position)).toBeGreaterThanOrEqual(TOUCHING);
      }
    }
  });

  it("with no grid at all, where every heading test is skipped", () => {
    const parent = ball(450, 450);
    const spot = spawnClearOfParent(gameWith(null, [parent]), parent);
    expect(distance(spot, parent.position)).toBeGreaterThanOrEqual(TOUCHING);
  });

  it("keeps its distance from a second ball too, when asked", () => {
    const parent = ball(450, 450);
    const other = ball(470, 450, "blue-2");
    const game = gameWith(openGrid(), [parent, other]);
    const spot = spawnClearOfParent(game, parent, { gapRadii: 3, clearOfOtherBalls: true });
    expect(distance(spot, other.position)).toBeGreaterThan(TOUCHING);
  });
});

/**
 * A map beat's ball ARRIVES; it does not come out of anything. Sitting it
 * beside an existing ball reads as that ball dividing however wide the gap,
 * because the newcomer is the same size and its type is drawn at random from
 * what the level can spawn — on level 2 that is red or blue, so half the time
 * it matches. Only not being there fixes the reading.
 */
describe("an arriving ball is placed away from every ball in play", () => {
  it("lands well clear of the anchor, not a gap away from it", () => {
    const anchor = ball(450, 450);
    const game = gameWith(openGrid(), [anchor]);
    for (let attempt = 0; attempt < 25; attempt++) {
      const spot = spawnInOpenSpace(game, RADIUS, anchor);
      // The tightest clearance the open-space search will accept.
      expect(distance(spot, anchor.position)).toBeGreaterThanOrEqual(RADIUS * 3.5);
    }
  });

  it("stays clear of every other ball, not just the anchor", () => {
    const anchor = ball(450, 450);
    const others = [ball(200, 200, "b2"), ball(700, 300, "b3"), ball(300, 700, "b4")];
    const game = gameWith(openGrid(), [anchor, ...others]);
    for (let attempt = 0; attempt < 25; attempt++) {
      const spot = spawnInOpenSpace(game, RADIUS, anchor);
      for (const other of [anchor, ...others]) {
        expect(distance(spot, other.position)).toBeGreaterThanOrEqual(RADIUS * 3.5);
      }
    }
  });

  it("lands somewhere the whole ball fits, not half inside a fence", () => {
    const anchor = ball(450, 450);
    const grid = pocketGrid(200);
    const game = gameWith(grid, [anchor]);
    for (let attempt = 0; attempt < 25; attempt++) {
      const spot = spawnInOpenSpace(game, RADIUS, anchor);
      // Every point on the ball's rim must be live space.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = spot.x + Math.cos(a) * RADIUS;
        const y = spot.y + Math.sin(a) * RADIUS;
        const col = Math.floor((x - grid.originX) / grid.cellSize);
        const row = Math.floor((y - grid.originY) / grid.cellSize);
        expect(grid.cells[row * grid.width + col]).not.toBe(CellState.REMOVED);
      }
    }
  });

  /** A nearly-captured board has nowhere open left; it must still not overlap. */
  it("falls back to a non-overlapping spot when the board has no room", () => {
    const anchor = ball(450, 450);
    const game = gameWith(pocketGrid(26), [anchor]);
    const spot = spawnInOpenSpace(game, RADIUS, anchor);
    expect(distance(spot, anchor.position)).toBeGreaterThanOrEqual(TOUCHING);
  });

  it("does not fall over when there is no grid", () => {
    const anchor = ball(450, 450);
    const spot = spawnInOpenSpace(gameWith(null, [anchor]), RADIUS, anchor);
    expect(distance(spot, anchor.position)).toBeGreaterThanOrEqual(TOUCHING);
  });
});
