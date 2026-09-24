/**
 * The ring: a fence that closes around a ball where it stands, and locks it.
 *
 * What Auto Merge does to one ball and Big Bang Release does to every free ball.
 * It is the only thing in the game that creates a pocket without the player
 * drawing one, which makes the shape of this file mostly about what it REFUSES
 * to do.
 *
 * ── Why it is real walls and not a special case ─────────────────────────────
 *
 * A ring could have been "set ball.state = won and pay a lock", and that would
 * have been a second locking mechanism: a second set of rules for lock value,
 * for lock quality, for the band a fence type imposes, for the boss's hit
 * points, for what a lock does to the win spec. Every one of those already has
 * an answer in checkBallWonState, and a shortcut here would be a place where
 * those answers were wrong.
 *
 * So a ring is what it looks like: a closed polygon of ordinary player-fence
 * segments, rasterized into the space grid like any cut. The ball is then
 * alone in a tiny region, and the existing lock pass locks it, prices it,
 * grades it and tells the win spec about it, knowing nothing about bugs.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It does not spend a fence from the budget and it does not count toward par.
 * A player who squashes Auto Merge did not draw that fence, and charging them par
 * for it would make a power-up a punishment on any map where par is tight.
 *
 * It does not kill. A cut that a ball is sitting on costs a life
 * (ballStruckFence), which is right for a fence the player chose to draw
 * through a ball and monstrous for one a bug closed for them: the ring is
 * REFUSED instead when it cannot be placed cleanly, and the splat says so.
 *
 * ── The pocket is bad on purpose ────────────────────────────────────────────
 *
 * A ring is drawn at a little over two ball radii, which is a large, round,
 * open pocket - the worst-paying shape the lock grader recognises. Auto Merge is a
 * free lock at a poor price, which is what keeps it from being the only bug
 * anyone wants.
 */
import type { CanvasGameState } from "@/types/gameState";
import type { Ball, Region, Vector2 } from "@/types/game";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { GameCallbacks } from "./gameCallbacks";
import type { WinSpec } from "@/types/winSpec";
import { Wall } from "@/lib/wallGeometry";
import { generateRegionId, generateWallId } from "@/lib/gameUtils";
import {
  captureUnreachableCells,
  findGridRegions,
  buildGridRegionMap,
  findGridRegionForBall,
  getRegionCellPositions,
  isPositionActive,
  rasterizeCutToGrid,
} from "@/lib/spaceGrid";
import { buildPolygonFromSamples } from "@/lib/regionSplit";
import { paintCellRegionIds, reassignBallsToRegions } from "@/lib/regionOwnership";
import { pointToSegmentDistance } from "@/lib/polygon";
import { checkAndUpdateBallWonStates } from "./checkBallWonState";
import { STANDARD_FENCE_ID } from "@/lib/fences";
import { simNow } from "@/lib/simClock";

/**
 * Segments in a ring.
 *
 * Enough that it rasterizes into a closed band with no diagonal leak at this
 * cell size, and few enough that twelve rings from one Big Bang Release do not
 * put a thousand walls into the collision index. 20 was measured: at 16 a ball
 * resting against the inside of the ring could slip a corner.
 */
const RING_SEGMENTS = 20;

/** Ring fences are drawn at the standard thickness, because they ARE fences. */
const RING_THICKNESS = 6;

/**
 * Extra clearance, in world units, between the ring and anything it must not
 * touch. A ring laid flush against a wall or another ball is a ring that
 * rasterizes into a pocket with a hole in it, or one that traps a bystander.
 */
const RING_CLEARANCE = 10;

/** The ring's vertices, in order, closing back on the first. */
export function ringPoints(centre: Vector2, radius: number): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    points.push({ x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius });
  }
  points.push({ ...points[0] });
  return points;
}

/**
 * Can a ring of this radius be closed around this ball?
 *
 * Every refusal here is a case where drawing it anyway would do something the
 * player would read as a bug in the game rather than a bug on the board:
 *
 *   OFF THE BOARD      part of the ring in captured or out-of-bounds space
 *                      leaves an open arc, so the "pocket" is not sealed and
 *                      the ball wanders out of a fence that visibly closed.
 *   THROUGH A WALL     a ring crossing an existing wall or obstacle edge is
 *                      two half-pockets, and which one the ball ends up in
 *                      depends on a pixel.
 *   ONTO ANOTHER BALL  the bystander is either killed by a fence it did not
 *                      touch, or sealed into a pocket it did not earn.
 */
export function ringFits(game: CanvasGameState, ball: Ball, radius: number): boolean {
  const grid = game.spaceGrid;
  if (!grid) return false;
  const points = ringPoints(ball.position, radius);

  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    if (!isPositionActive(grid, p)) return false;
    // A midpoint too: at this radius a chord can bulge across a cell that the
    // two vertices either side of it both clear.
    const mid = { x: (p.x + points[i + 1].x) / 2, y: (p.y + points[i + 1].y) / 2 };
    if (!isPositionActive(grid, mid)) return false;

    for (const w of game.walls) {
      if (pointToSegmentDistance(p, w.start, w.end) < RING_CLEARANCE) return false;
      if (pointToSegmentDistance(mid, w.start, w.end) < RING_CLEARANCE) return false;
    }
  }

  for (const other of game.balls) {
    if (other.id === ball.id) continue;
    if (other.state === "won") continue;
    const d = Math.hypot(other.position.x - ball.position.x, other.position.y - ball.position.y);
    // Inside the ring is as bad as on it: two balls in one bug's pocket is a
    // lock the player did not make, priced as if they had.
    if (d < radius + other.radius + RING_CLEARANCE) return false;
  }
  return true;
}

/**
 * The largest ring that fits around this ball, or null when none does.
 *
 * Tries the asked-for radius first and then steps in, because a ball in a
 * corridor can often take a tighter ring than the one the catalogue names and
 * refusing it outright would make Auto Merge useless on exactly the maps where
 * space is the thing being fought over. The floor is a ring the ball cannot
 * simply be resting on top of.
 */
export function fittingRingRadius(
  game: CanvasGameState,
  ball: Ball,
  wanted: number,
): number | null {
  const floor = ball.radius + RING_THICKNESS + 4;
  for (let r = wanted; r >= floor; r -= 4) {
    if (ringFits(game, ball, r)) return r;
  }
  return null;
}

/**
 * Lay the ring's walls down and rasterize them. Does NOT rebuild regions or
 * lock anything: Big Bang Release closes every ring before a single lock pass
 * runs, so that a board sealed all at once is evaluated all at once rather
 * than once per ball with eleven stale region rebuilds in between.
 */
function layRing(game: CanvasGameState, centre: Vector2, radius: number): void {
  const points = ringPoints(centre, radius);
  const cutId = generateWallId();
  const now = simNow();
  for (let i = 0; i < points.length - 1; i++) {
    const segment: Wall = {
      id: generateWallId(),
      start: { ...points[i] },
      end: { ...points[i + 1] },
      thickness: RING_THICKNESS,
      createdAt: now,
      fenceTypeId: STANDARD_FENCE_ID,
      player: 0,
      cutId,
    };
    if (game.spaceGrid) {
      segment.rasterCells = rasterizeCutToGrid(game.spaceGrid, points[i], points[i + 1], RING_THICKNESS);
    }
    // No durability budget. An Ascension fence that can be broken is a fence
    // the player drew and can choose to defend; a ring nobody drew, breaking
    // open and releasing a ball that was already scored, would be an event
    // with no author and no cue.
    game.walls.push(segment);
  }
}

/**
 * Rebuild the board's regions from the grid after one or more rings landed.
 *
 * The same shape as breakFenceWall's rebuild rather than applyCut's: there is
 * no GrowingWall here, no sample-based region to subdivide, and no cut to
 * retire - the grid is the truth and the regions are derived from it.
 */
function rebuildAfterRings(game: CanvasGameState): void {
  const grid = game.spaceGrid;
  if (!grid) return;
  const gridRegions = findGridRegions(grid);
  const regions: Region[] = [];
  for (const gridRegion of gridRegions) {
    const samples = getRegionCellPositions(grid, gridRegion);
    const built = buildPolygonFromSamples(samples, samples.length);
    if (built) {
      regions.push({
        id: generateRegionId(),
        polygon: built.polygon,
        estimatedArea: built.estimatedArea,
        samplePoints: built.samplePoints,
      });
    }
  }
  game.regions = regions;
  reassignBallsToRegions(game.balls, game.regions, game.walls, grid);
  paintCellRegionIds(grid, game.regions);
}

export interface RingCallbacks {
  callbacks: Pick<GameCallbacks, "setLockedBallsCount" | "onBallTypeLocked" | "onBallCountChanged" | "onBossState">;
  modifiers: GameModifiers;
  cumulativeLockedBalls: number;
  spec: WinSpec;
}

/**
 * Close a ring around each of `targets` and run ONE lock pass over the result.
 *
 * Returns the balls that actually got a ring, which is not always all of them:
 * a ball with no room keeps playing and the caller reports that. Callers that
 * pass several targets get all-or-each behaviour, never all-or-nothing - Big
 * Bang Release sealing nine of eleven balls is the mechanic working, and
 * refusing the whole thing because one ball sat in a corridor would make the
 * rarest bug in the pool the least predictable thing in the game.
 */
export function sealRings(
  game: CanvasGameState,
  targets: Ball[],
  radiusFor: (ball: Ball) => number,
  rc: RingCallbacks,
): Ball[] {
  if (!game.spaceGrid) return [];

  const sealed: Ball[] = [];
  for (const ball of targets) {
    if (ball.state !== "active") continue;
    const radius = fittingRingRadius(game, ball, radiusFor(ball));
    if (radius === null) continue;
    layRing(game, ball.position, radius);
    sealed.push(ball);
  }
  if (sealed.length === 0) return [];

  // The same snapshot applyCut takes, and for the same reason: the lock check
  // must be able to tell a pocket closed by real barriers from one the
  // reachability capture "closed" across a gap the ball cannot fit through.
  // A ring IS a real barrier, so this is the honest version of that test and
  // not a formality - it is what proves the ring sealed.
  const preCaptureCells = Uint8Array.from(game.spaceGrid.cells);
  captureUnreachableCells(game.spaceGrid, game.balls, game.walls);

  const gridRegions = findGridRegions(game.spaceGrid);
  const gridRegionMap = buildGridRegionMap(gridRegions);
  const withBalls = new Set<(typeof gridRegions)[number]>();
  for (const ball of game.balls) {
    if (ball.state === "won") continue;
    const region = findGridRegionForBall(game.spaceGrid, gridRegionMap, ball.position.x, ball.position.y);
    if (region) withBalls.add(region);
  }
  game.gridRegions = [...withBalls];

  rebuildAfterRings(game);

  checkAndUpdateBallWonStates(
    game,
    rc.modifiers,
    rc.cumulativeLockedBalls,
    rc.callbacks,
    preCaptureCells,
    { gridRegions, gridRegionMap },
    rc.spec,
    // Priced as a standard fence. The player's selected fence type is not
    // consulted on purpose: they did not choose to draw this, so a Semaphore's
    // lock band or a Tripwire's qualified table has no business deciding what a
    // bug paid them.
    STANDARD_FENCE_ID,
  );
  return sealed;
}
