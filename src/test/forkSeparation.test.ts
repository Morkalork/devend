import { describe, it, expect } from "vitest";
import { claimPickupsInPocket } from "@/lib/pickups";
import { worldToGridIndex } from "@/lib/spaceGrid";
import { createSpaceGrid } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import type { CanvasGameState } from "@/types/gameState";

/**
 * A Fork clone is an exact copy of its parent - same type, colour and radius.
 * It used to be placed 2 world units away, when a ball radius is ~18, so the
 * two were coincident for the first frames and the split read as the ball
 * duplicating itself rather than splitting. It must be born a clear gap away.
 */
/** Seal a fork token into a pocket, exactly as drawing a fence does. */
function claimForkAt(g: CanvasGameState, x: number, y: number): void {
  const grid = g.spaceGrid!;
  g.pickups = [{
    id: "t1", effect: "fork", value: 0,
    position: { x, y }, spawnedAtSeconds: 0, expiresAtSeconds: 999,
  }] as never;
  claimPickupsInPocket(g, new Set([worldToGridIndex(grid, x, y)]));
}

function gameWithBall(radius = 18): CanvasGameState {
  const ball = {
    id: "blue-1", typeId: "blue", state: "active", speed: 220, baseSpeed: 220,
    radius, position: { x: 450, y: 450 }, velocity: { x: 220, y: 0 },
    regionId: "r1", effects: {},
  };
  return {
    spaceGrid: createSpaceGrid(createRectPolygon(0, 0, 900, 900), [], 15),
    balls: [ball],
    activePlaySeconds: 0,
    pickupsClaimedLog: [],
    pickupFeedback: [],
  } as unknown as CanvasGameState;
}

describe("fork clone separation", () => {
  it("spawns the clone a clear gap from its parent, not on top of it", () => {
    const g = gameWithBall();
    claimForkAt(g, 450, 450);

    expect(g.balls.length).toBe(2);
    const [src, clone] = g.balls;
    const dist = Math.hypot(clone.position.x - src.position.x, clone.position.y - src.position.y);
    // Anything under a radius still overlaps and reads as one ball.
    expect(dist).toBeGreaterThan(src.radius);
  });

  it("sends the clone away along its own heading", () => {
    const g = gameWithBall();
    claimForkAt(g, 450, 450);
    const [src, clone] = g.balls;

    const offX = clone.position.x - src.position.x;
    const offY = clone.position.y - src.position.y;
    const offLen = Math.hypot(offX, offY) || 1;
    const velLen = Math.hypot(clone.velocity.x, clone.velocity.y) || 1;
    // Offset direction and departure velocity must agree, so it moves away from
    // the parent rather than back through it.
    const dot = (offX / offLen) * (clone.velocity.x / velLen)
      + (offY / offLen) * (clone.velocity.y / velLen);
    expect(dot).toBeCloseTo(1, 5);
  });
});
