import { GrowingWall, Ball, Region, Vector2 } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { LevelConfig } from "@/types/level";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GameCallbacks } from "./gameCallbacks";
import { checkAndUpdateBallWonStates, applyMicroManagerSpeedCap } from "./checkBallWonState";
import { handleGameOverFn } from "./handleGameOver";
import {
  pointToSegmentDistance,
  lineSegmentIntersection,
  vec2Length,
} from "@/lib/polygon";
import { Wall } from "@/lib/wallGeometry";
import {
  rasterizeCutToGrid,
  findGridRegions,
  getRemainingPercent,
  removeRegion,
  buildGridRegionMap,
  findGridRegionForBall,
} from "@/lib/spaceGrid";
import {
  reassignBallsToRegions,
  validateAllBallOwnership,
  wouldWallOrphanBall,
  paintCellRegionIds,
} from "@/lib/regionOwnership";
import { generateRegionId, generateWallId } from "@/lib/gameUtils";
import { findSubRegionsGrid, buildPolygonFromSamples } from "@/lib/regionSplit";
import { calculateScore } from "@/lib/scoring";
import { LOCK_TOTAL_DURATION, LEVEL_CLEAR_SHIMMER_MS } from "@/lib/gameConstants";

function isBallOnCutLine(ball: Ball, wall: GrowingWall): boolean {
  const checkWaypoints = (waypoints: Vector2[]): boolean => {
    for (let i = 0; i < waypoints.length - 1; i++) {
      if (pointToSegmentDistance(ball.position, waypoints[i], waypoints[i + 1]) < 0.5) return true;
    }
    return false;
  };
  return checkWaypoints(wall.startWaypoints) || checkWaypoints(wall.endWaypoints);
}

function areAllBallsWon(game: CanvasGameState): boolean {
  const activeBalls = game.balls.filter(b => b.speed > 0 || b.state === 'won');
  if (activeBalls.length === 0) return false;
  return activeBalls.every(b => b.state === 'won');
}

function getGridRemainingPercent(game: CanvasGameState): number {
  if (game.spaceGrid) return getRemainingPercent(game.spaceGrid);
  const combined = game.regions.reduce((s, r) => s + (r.estimatedArea ?? 0), 0);
  return (combined / game.originalArea) * 100;
}

function wouldWallTrapBallCheck(start: Vector2, end: Vector2, game: CanvasGameState): boolean {
  return wouldWallOrphanBall(start, end, game.balls, game.regions, game.walls);
}

export function applyCutFn(
  wall: GrowingWall,
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
  tutorialMode: boolean,
  tutorialCutMade: boolean,
  cumulativeLockedBalls: number,
  callbacks: GameCallbacks,
): void {
  const { balls } = game;

  for (const ball of balls) {
    if (ball.state === 'won') continue;
    if (isBallOnCutLine(ball, wall)) {
      handleGameOverFn(game, level, levelNumber, activeModifiers, callbacks);
      return;
    }
  }

  // Reject walls that would orphan a ball
  {
    const allSegs: { start: Vector2; end: Vector2 }[] = [];
    for (let i = 0; i < wall.startWaypoints.length - 1; i++) {
      allSegs.push({ start: wall.startWaypoints[i], end: wall.startWaypoints[i + 1] });
    }
    for (let i = 0; i < wall.endWaypoints.length - 1; i++) {
      allSegs.push({ start: wall.endWaypoints[i], end: wall.endWaypoints[i + 1] });
    }
    for (const seg of allSegs) {
      if (wouldWallTrapBallCheck(seg.start, seg.end, game)) {
        game.activeWall = null;
        return;
      }
    }
  }

  // Commit fence segments to wall list and rasterize them into the grid.
  // Each segment keeps the cell indices its rasterization removed, plus an
  // Ascension durability budget — both needed if the fence later breaks
  // (see breakFenceWall.ts).
  const addSegmentWalls = (waypoints: Vector2[]) => {
    const now = performance.now();
    for (let i = 0; i < waypoints.length - 1; i++) {
      const segment: Wall = {
        id: generateWallId(),
        start: { ...waypoints[i] },
        end: { ...waypoints[i + 1] },
        thickness: wall.thickness,
        createdAt: now,
      };
      if (game.spaceGrid) {
        segment.rasterCells = rasterizeCutToGrid(game.spaceGrid, waypoints[i], waypoints[i + 1], wall.thickness);
      }
      if (game.fenceDurability != null) {
        segment.maxHits = game.fenceDurability;
        segment.hitsLeft = game.fenceDurability;
      }
      game.walls.push(segment);
    }
  };
  addSegmentWalls(wall.startWaypoints);
  addSegmentWalls(wall.endWaypoints);

  if (game.spaceGrid) {
    const gridRegions = findGridRegions(game.spaceGrid);
    // Build index→region map once; use neighbour-search fallback so balls whose
    // grid-cell centre falls inside a mirror polygon (REMOVED) are still located.
    const gridRegionMap = buildGridRegionMap(gridRegions);
    const regionsWithBalls = new Set<(typeof gridRegions)[number]>();
    for (const ball of balls) {
      if (ball.state === 'won') continue;
      const ballRegion = findGridRegionForBall(game.spaceGrid, gridRegionMap, ball.position.x, ball.position.y);
      if (ballRegion) regionsWithBalls.add(ballRegion);
    }
    for (const region of gridRegions) {
      if (!regionsWithBalls.has(region)) removeRegion(game.spaceGrid, region);
    }
    game.gridRegions = [...regionsWithBalls];
  }

  // Update sample-based regions for rendering
  const updatedRegions: Region[] = [];
  for (const region of [...game.regions]) {
    const subRegions = findSubRegionsGrid(region, game.balls, game.walls);
    if (subRegions.length <= 1) {
      if (subRegions.length === 1) {
        updatedRegions.push({
          ...region,
          samplePoints: subRegions[0].samples,
          estimatedArea: subRegions[0].samples.length * 15 * 15,
        });
      }
      continue;
    }
    for (const sub of subRegions.filter(r => r.hasBalls)) {
      const result = buildPolygonFromSamples(sub.samples, sub.samples.length);
      if (result && result.estimatedArea > 100) {
        updatedRegions.push({ id: generateRegionId(), polygon: result.polygon, estimatedArea: result.estimatedArea, samplePoints: result.samplePoints });
      }
    }
  }
  game.regions = updatedRegions;
  if (game.spaceGrid) paintCellRegionIds(game.spaceGrid, game.regions);

  callbacks.collectAndDrawRemovedSamples();
  callbacks.repaintRegionCanvas();
  reassignBallsToRegions(game.balls, game.regions, game.walls);
  validateAllBallOwnership(game.balls, game.regions, game.walls);
  game.activeWall = null;

  checkAndUpdateBallWonStates(game, activeModifiers, cumulativeLockedBalls, callbacks);
  callbacks.render();

  // Issue #37: ball speeds are flat — no per-cut acceleration ramp. Only the
  // MicroManager upgrade still caps speeds, floored so the stack never drops a
  // ball below MIN_BALL_SPEED_FACTOR of normal (issue #42).
  applyMicroManagerSpeedCap(balls, activeModifiers, cumulativeLockedBalls + game.lockedBallsCount);

  if (areAllBallsWon(game)) {
    triggerLevelComplete(game, level, levelNumber, activeModifiers, callbacks);
    return;
  }

  const percent = Math.round(getGridRemainingPercent(game));
  callbacks.setRemainingPercent(percent);

  if (tutorialMode && !tutorialCutMade && percent < 100) {
    callbacks.setTutorialCutMade(true);
    callbacks.onTutorialCutSuccess?.();
  }

  if (game.pushMode === "pushing" && percent < game.bestRemainingPercent) {
    game.bestRemainingPercent = percent;
  }

  // Breaking objects is a bonus, not a win condition (issue #38) — the level is
  // completed by shrinking the board, exactly as normal.
  const lockReq = level.threadLockRequired ?? 0;
  if (percent < level.sizeThreshold && game.lockedBallsCount >= lockReq && game.pushMode === "none") {
    // The frame is already drawn (loop render + the post-cut render above) and
    // pushMode is still "none" here, so these would be pixel-identical repaints.
    // The two redundant full renders spiked this frame to 4 redraws and caused a
    // visible twitch right as the push-your-luck modal mounted.
    game.pushMode = "prompt";
    game.levelClearedTime = performance.now();
    callbacks.setPushMode("prompt");
    callbacks.setClearedPercent(percent);
    game.bestRemainingPercent = percent;
    game.pushStartPercent = percent;
  }
}

type CompleteCallbacks = Pick<GameCallbacks, 'setRemainingPercent' | 'onLevelComplete' | 'startDissolve' | 'onMapComplete'>;

/** Finalise the level: score it, fire onLevelComplete, and start the dissolve. */
export function triggerLevelComplete(
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
  callbacks: CompleteCallbacks,
): void {
  if (game.levelComplete) return;
  game.levelComplete = true;
  const percent = Math.round(getGridRemainingPercent(game));
  callbacks.setRemainingPercent(percent);

  // Fold lock + break bonuses in before the cap so a single map can't exceed
  // the per-map ceiling (issue #43).
  const { levelScore, breakdown } = calculateScore(
    game.wallCount, level.expectedCuts, percent,
    level.sizeThreshold, level.points, activeModifiers.scoreMultiplier, levelNumber,
    game.lockBonus + game.breakBonus,
  );
  const lockDelay = game.assimilations.size > 0 ? LOCK_TOTAL_DURATION + 200 : 0;
  // Celebratory beat: after any lock animations settle, sweep a shimmer down the
  // whole board (fences, obstacles and all) before the completion overlay mounts.
  game.shimmerStart = performance.now() + lockDelay;
  callbacks.onMapComplete?.(); // freeze the background code for the "dead" beat
  setTimeout(() => {
    callbacks.onLevelComplete({
      levelNumber, levelId: level.id, cutCount: game.wallCount,
      expectedCuts: level.expectedCuts, basePoints: level.points,
      levelScore,
      remainingPercent: percent, thresholdPercent: level.sizeThreshold,
      underParBonus: breakdown.underParBonus, spaceBonus: breakdown.spaceBonus,
      spaceBonusRaw: breakdown.spaceBonusRaw, performanceMultiplier: breakdown.performanceMultiplier,
      fencesUnderPar: breakdown.fencesUnderPar, fencesOverPar: breakdown.fencesOverPar,
      extraPercent: breakdown.extraPercent, lockBonus: game.lockBonus,
      lockedBallsCount: game.lockedBallsCount,
      breakBonus: game.breakBonus,
    });
    callbacks.startDissolve(() => {});
  }, lockDelay + LEVEL_CLEAR_SHIMMER_MS);
}
