/**
 * Field report, level 14: "if I try to make a horizontal fence about half way
 * down it fails on either an invisible wall or something else that I can't see.
 * the balls don't seem to hit it. keeps me from finishing the map off."
 *
 * wouldWallOrphanBall decides whether a proposed fence would strand a ball by
 * asking whether the ball can still SEE one of its region's sample points along
 * a straight segment. Visibility is not reachability. Put an obstacle between a
 * ball and every sample point - trivial on a map whose obstacles are random, and
 * likelier the more contorted the region gets - and the ball is declared
 * orphaned even though it can move freely.
 *
 * The failure is worse than a one-off rejection: the verdict does not depend on
 * where the fence is drawn, so once a ball sits in such a spot EVERY cut on the
 * board is refused, silently, until the ball happens to wander somewhere with a
 * clear sightline. There is no feedback and nothing the player can do.
 */
import { describe, it, expect } from "vitest";
import { wouldWallOrphanBall } from "@/lib/regionOwnership";
import type { Ball, Region } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";
import { createSpaceGrid, CellState, worldToGridIndex } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";

const ball = (x: number, y: number): Ball => ({
  id: "b1", position: { x, y }, velocity: { x: 1, y: 0 }, speed: 100,
  radius: 18, color: "#fff", regionId: "r1", state: "active",
} as unknown as Ball);

const seg = (id: string, x1: number, y1: number, x2: number, y2: number): Wall =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 6 }) as Wall;

/**
 * A ball at the left, its region's sample points at the right, and a solid
 * obstacle wall between them with generous room to travel around either end.
 * The ball can plainly reach the samples; it simply cannot see them.
 */
function blockedSightline() {
  const balls = [ball(100, 400)];
  const regions: Region[] = [
    { id: "r1", samplePoints: [{ x: 700, y: 380 }, { x: 700, y: 400 }, { x: 700, y: 420 }] } as unknown as Region,
  ];
  const walls = [seg("obstacle-mid-edge-0", 400, 200, 400, 600)];
  return { balls, regions, walls };
}

describe("orphan check: visibility is not reachability", () => {
  it("declares a ball orphaned by a fence drawn nowhere near it", () => {
    const { balls, regions, walls } = blockedSightline();
    // A fence in the far bottom-right corner, touching nothing relevant.
    const orphaned = wouldWallOrphanBall(
      { x: 820, y: 820 }, { x: 860, y: 820 }, balls, regions, walls,
    );
    expect(orphaned).toBe(false);
  });

  it("refuses every fence on the board, not just one", () => {
    const { balls, regions, walls } = blockedSightline();
    // Four unrelated fences in four corners: if the verdict ignores the proposed
    // wall entirely, the player is locked out of the map completely.
    const attempts: [number, number, number, number][] = [
      [820, 820, 860, 820],
      [60, 60, 100, 60],
      [820, 60, 860, 60],
      [60, 820, 100, 820],
    ];
    const refusals = attempts.filter(([x1, y1, x2, y2]) =>
      wouldWallOrphanBall({ x: x1, y: y1 }, { x: x2, y: y2 }, balls, regions, walls),
    );
    expect(refusals).toEqual([]);
  });

  // The guard must keep doing its actual job: a fence that really does cut the
  // ball off from its whole region still has to be refused.
  it("still refuses a fence that genuinely walls the ball off", () => {
    const balls = [ball(100, 400)];
    const regions: Region[] = [
      { id: "r1", samplePoints: [{ x: 700, y: 400 }] } as unknown as Region,
    ];
    const orphaned = wouldWallOrphanBall(
      { x: 300, y: 0 }, { x: 300, y: 900 }, balls, regions, [],
    );
    expect(orphaned).toBe(true);
  });
});

/**
 * With a space grid, the check asks whether the ball can WALK to a sample, not
 * whether it can see one. That is the question it always meant to ask: a ball in
 * an L-shaped region reaches the far arm perfectly well and has no line of sight
 * to any of it.
 */
describe("orphan check uses reachability when a grid is available", () => {
  /** An L: the corridor turns, so no sample in the far arm is ever visible. */
  const lShapedGrid = () => {
    const grid = createSpaceGrid(createRectPolygon(45, 45, 855, 855), [], 15);
    grid.cells.fill(CellState.REMOVED);
    const open = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y += 15) {
        for (let x = x0; x < x1; x += 15) {
          const i = worldToGridIndex(grid, x, y);
          if (i >= 0) grid.cells[i] = CellState.ACTIVE;
        }
      }
    };
    open(100, 100, 300, 200);  // horizontal arm
    open(200, 100, 300, 500);  // vertical arm turning down
    return grid;
  };

  it("does not strand a ball that can walk round the corner", () => {
    const grid = lShapedGrid();
    const balls = [ball(150, 150)];
    const regions: Region[] = [
      { id: "r1", samplePoints: [{ x: 250, y: 450 }] } as unknown as Region,
    ];
    // A blocking wall between the ball and the sample, so line of sight fails.
    const walls = [seg("obstacle-corner-edge-0", 180, 100, 180, 400)];
    expect(wouldWallOrphanBall({ x: 800, y: 800 }, { x: 840, y: 800 }, balls, regions, walls, grid)).toBe(false);
  });

  it("still refuses a fence that genuinely severs the corridor", () => {
    const grid = lShapedGrid();
    const balls = [ball(150, 150)];
    const regions: Region[] = [
      { id: "r1", samplePoints: [{ x: 250, y: 450 }] } as unknown as Region,
    ];
    // Cuts straight across the vertical arm, below the ball's reach.
    expect(wouldWallOrphanBall({ x: 190, y: 260 }, { x: 320, y: 260 }, balls, regions, [], grid)).toBe(true);
  });
});
