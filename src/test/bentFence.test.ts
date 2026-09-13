/**
 * Bent fences end to end: what the engine does with a drawn path.
 *
 * bentCut.test covers the geometry in isolation. This one asks the questions
 * that geometry cannot answer on its own - does the loadout reach the board,
 * does a bent cut grow into real wall segments that follow the corner, and does
 * a drag that strays out of its region fall back to the straight cut instead of
 * drawing a fence somewhere it could never have been started.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  createBotGame, stepBot, plainModifiers, installClock, releaseClock,
} from "@/lib/bot/headlessGame";
import { LADDER } from "@/test/fixtures/maps";
import { setRunSeedText } from "@/lib/runRng";
import { bentDrawnPath, joinProjection, outgoingDirection, incomingDirection } from "@/lib/physics/bentCut";
import { castRayWithReflections } from "@/lib/wallGeometry";
import { pointToSegmentDistance } from "@/lib/polygon";
import { CellState } from "@/lib/spaceGrid";
import type { CanvasGameState } from "@/types/gameState";
import type { GrowingWall, Vector2 } from "@/types/game";

afterEach(() => releaseClock());

/**
 * A bare early map, settled enough that its grid and regions are real, with the
 * balls parked and frozen in one corner.
 *
 * Both halves matter and both were learned the hard way. The seed is pinned
 * because createBotGame deals from whatever seed the previous test left, so
 * without it the ball roster and start positions change with test ORDER. The
 * balls are then held still because a ball that touches a growing fence kills
 * it: this file is about the geometry of a bent cut, and a run where a ball
 * happened to wander into the corner reported "the fence produced no walls",
 * intermittently and only in a full-suite run.
 */
function board(bends: number) {
  releaseClock();
  setRunSeedText("bent-fence");
  installClock();
  const level = LADDER.find((l) => l.level === 1)!;
  const ctx = createBotGame(level, 1, plainModifiers({ bentFenceBends: bends }));
  for (let i = 0; i < 30; i++) stepBot(ctx);
  const game = ctx.game as unknown as CanvasGameState;
  for (const ball of game.balls) {
    ball.position = { x: 90, y: 810 };
    ball.velocity = { x: 0, y: 0 };
    ball.speed = 0;
    ball.frozenUntil = performance.now() + 60_000;
  }
  return ctx;
}

/** Pretend the player dragged along these points, in this region. */
function drag(game: CanvasGameState, points: Vector2[]): void {
  const region = game.regions[0];
  game.swipeStart = { ...points[0] };
  game.swipeRegionId = region.id;
  game.swipePath = points.map((p) => ({ ...p }));
  game.currentSwipePos = { ...points[points.length - 1] };
}

/** Samples along a straight run, the way a steady finger arrives. */
function stroke(from: Vector2, to: Vector2, n = 24): Vector2[] {
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / n,
    y: from.y + ((to.y - from.y) * i) / n,
  }));
}

const ELBOW = [...stroke({ x: 300, y: 300 }, { x: 560, y: 300 }), ...stroke({ x: 560, y: 300 }, { x: 560, y: 560 })];

describe("the loadout reaches the board", () => {
  it("createInitialGameData carries the bend budget, so the harness cuts as the browser does", () => {
    expect((board(2).game as unknown as CanvasGameState).bentFenceBends).toBe(2);
    expect((board(0).game as unknown as CanvasGameState).bentFenceBends).toBe(0);
  });

  it("is off by default", () => {
    expect(plainModifiers().bentFenceBends).toBe(0);
  });
});

describe("bentDrawnPath on a real board", () => {
  it("finds the drawn corner when the loadout is on", () => {
    const game = board(2).game as unknown as CanvasGameState;
    drag(game, ELBOW);
    const path = bentDrawnPath(game);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(3);
    expect(path![1].x).toBeCloseTo(560, 0);
    expect(path![1].y).toBeCloseTo(300, 0);
  });

  it("returns null without the loadout, so the swipe cuts straight as always", () => {
    const game = board(0).game as unknown as CanvasGameState;
    drag(game, ELBOW);
    expect(bentDrawnPath(game)).toBeNull();
  });

  it("refuses a path that leaves the region it started in", () => {
    const game = board(2).game as unknown as CanvasGameState;
    drag(game, ELBOW);
    // Same drag, but claiming it started somewhere else: every drawn point is
    // now in the wrong region, which is what a drag across a boundary looks
    // like from here.
    game.swipeRegionId = "not-a-region";
    expect(bentDrawnPath(game)).toBeNull();
  });

  it("refuses a path drawn over captured ground", () => {
    const game = board(2).game as unknown as CanvasGameState;
    drag(game, ELBOW);
    expect(bentDrawnPath(game)).not.toBeNull();
    // Kill the grid under the corner: a fence cannot be drawn through space
    // that is no longer in play.
    const grid = game.spaceGrid;
    grid.cells.fill(CellState.REMOVED);
    expect(bentDrawnPath(game)).toBeNull();
  });
});

describe("a bent cut becomes a bent fence", () => {
  it("grows into segments that follow the drawn corner and anchor on the walls", () => {
    const ctx = board(2);
    const game = ctx.game as unknown as CanvasGameState;
    drag(game, ELBOW);
    const bent = bentDrawnPath(game)!;

    const fwd = castRayWithReflections(bent[bent.length - 1], outgoingDirection(bent), game.walls)!;
    const bwd = castRayWithReflections(bent[0], incomingDirection(bent), game.walls)!;
    const endWaypoints = joinProjection(bent, fwd.waypoints);
    const startWaypoints = bwd.waypoints;

    const before = game.walls.length;
    game.wallCount = (game.wallCount ?? 0) + 1;
    game.activeWalls.push({
      origin: { ...bent[0] },
      direction: outgoingDirection(bent),
      startWaypoints,
      endWaypoints,
      startSegmentIndex: 0,
      endSegmentIndex: 0,
      startPoint: { ...bent[0] },
      endPoint: { ...bent[0] },
      targetStart: startWaypoints[startWaypoints.length - 1],
      targetEnd: endWaypoints[endWaypoints.length - 1],
      thickness: 4,
      isComplete: false,
      activeRegionId: game.regions[0].id,
      startTime: performance.now(),
    } as unknown as GrowingWall);

    for (let i = 0; i < 900 && game.activeWalls.length > 0; i++) stepBot(ctx);
    expect(game.activeWalls).toHaveLength(0);

    const added = game.walls.slice(before);
    expect(added.length).toBeGreaterThan(0);

    // Every drawn leg is covered by fence, and the corner itself is a real
    // corner: there is wall on both sides of it, at right angles.
    const covered = (p: Vector2) =>
      added.some((w) => pointToSegmentDistance(p, w.start, w.end) < 12);
    expect(covered({ x: 430, y: 300 })).toBe(true);   // mid first leg
    expect(covered({ x: 560, y: 430 })).toBe(true);   // mid second leg
    expect(covered({ x: 560, y: 300 })).toBe(true);   // the corner

    // The whole thing reaches the frame at both ends, or it would not divide
    // anything: the projections are what anchor it.
    expect(covered({ x: 560, y: 700 })).toBe(true);   // projected past the corner
    expect(covered({ x: 150, y: 300 })).toBe(true);   // projected back off the near end
  });

  it("captures space, which is the whole point of a cut", () => {
    const ctx = board(2);
    const game = ctx.game as unknown as CanvasGameState;
    const activeBefore = game.spaceGrid.activeCount;
    drag(game, ELBOW);
    const bent = bentDrawnPath(game)!;
    const fwd = castRayWithReflections(bent[bent.length - 1], outgoingDirection(bent), game.walls)!;
    const bwd = castRayWithReflections(bent[0], incomingDirection(bent), game.walls)!;

    game.wallCount = (game.wallCount ?? 0) + 1;
    game.activeWalls.push({
      origin: { ...bent[0] },
      direction: outgoingDirection(bent),
      startWaypoints: bwd.waypoints,
      endWaypoints: joinProjection(bent, fwd.waypoints),
      startSegmentIndex: 0,
      endSegmentIndex: 0,
      startPoint: { ...bent[0] },
      endPoint: { ...bent[0] },
      targetStart: bwd.waypoints[bwd.waypoints.length - 1],
      targetEnd: joinProjection(bent, fwd.waypoints).slice(-1)[0],
      thickness: 4,
      isComplete: false,
      activeRegionId: game.regions[0].id,
      startTime: performance.now(),
    } as unknown as GrowingWall);

    for (let i = 0; i < 900 && game.activeWalls.length > 0; i++) stepBot(ctx);
    for (let i = 0; i < 120; i++) stepBot(ctx);
    // Read the grid rather than the HUD percentage: the grid is what a cut
    // actually changes, and it changes the moment the fence resolves.
    expect(game.spaceGrid.activeCount).toBeLessThan(activeBefore);
  });
});
