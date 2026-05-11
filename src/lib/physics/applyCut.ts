import { GrowingWall, Ball, Region, Vector2 } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { LevelConfig } from "@/types/level";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GameCallbacks } from "./gameCallbacks";
import { checkAndUpdateBallWonStates } from "./checkBallWonState";
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
  worldToGridIndex,
} from "@/lib/spaceGrid";
import {
  reassignBallsToRegions,
  validateAllBallOwnership,
  wouldWallOrphanBall,
} from "@/lib/regionOwnership";
import { generateRegionId, generateWallId } from "@/lib/gameUtils";
import { findSubRegionsGrid, buildPolygonFromSamples } from "@/lib/regionSplit";
import { calculateScore } from "@/hooks/useScoring";
import { LOCK_TOTAL_DURATION, BALL_SPEED_INCREASE } from "@/lib/gameConstants";

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

  // Commit fence segments to wall list
  const addSegmentWalls = (waypoints: Vector2[]) => {
    for (let i = 0; i < waypoints.length - 1; i++) {
      game.walls.push({
        id: generateWallId(),
        start: { ...waypoints[i] },
        end: { ...waypoints[i + 1] },
        thickness: wall.thickness,
      } as Wall);
    }
  };
  addSegmentWalls(wall.startWaypoints);
  addSegmentWalls(wall.endWaypoints);

  // Rasterize cut to grid
  if (game.spaceGrid) {
    const rasterizeWaypoints = (waypoints: Vector2[]) => {
      for (let i = 0; i < waypoints.length - 1; i++) {
        rasterizeCutToGrid(game.spaceGrid!, waypoints[i], waypoints[i + 1], wall.thickness);
      }
    };
    rasterizeWaypoints(wall.startWaypoints);
    rasterizeWaypoints(wall.endWaypoints);

    const gridRegions = findGridRegions(game.spaceGrid);
    const regionsWithBalls = [];
    const regionsWithoutBalls = [];
    for (const region of gridRegions) {
      let hasBall = false;
      for (const ball of balls) {
        if (ball.state === 'won') continue;
        const ballIndex = worldToGridIndex(game.spaceGrid, ball.position.x, ball.position.y);
        if (ballIndex >= 0 && region.cellIndices.includes(ballIndex)) { hasBall = true; break; }
      }
      if (hasBall) regionsWithBalls.push(region);
      else regionsWithoutBalls.push(region);
    }
    for (const empty of regionsWithoutBalls) removeRegion(game.spaceGrid, empty);
    game.gridRegions = regionsWithBalls;
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

  callbacks.collectAndDrawRemovedSamples();
  callbacks.repaintRegionCanvas();
  reassignBallsToRegions(game.balls, game.regions, game.walls);
  validateAllBallOwnership(game.balls, game.regions, game.walls);
  game.activeWall = null;

  checkAndUpdateBallWonStates(game, activeModifiers, cumulativeLockedBalls, callbacks);
  callbacks.render();

  // Speed up balls + MicroManager cap
  for (const ball of balls) {
    if (ball.speed === 0) continue;
    const newSpeed = Math.min(ball.speed * BALL_SPEED_INCREASE, ball.topSpeed);
    const ratio = newSpeed / ball.speed;
    ball.speed = newSpeed;
    ball.baseSpeed = Math.min(ball.baseSpeed * BALL_SPEED_INCREASE, ball.topSpeed);
    ball.velocity.x *= ratio;
    ball.velocity.y *= ratio;
  }
  const totalLockedMM = cumulativeLockedBalls + game.lockedBallsCount;
  if (activeModifiers.microManagerPerLock > 0 && totalLockedMM > 0) {
    const speedFactor = Math.max(0.30, Math.pow(1 - activeModifiers.microManagerPerLock, totalLockedMM));
    for (const ball of balls) {
      if (ball.state === 'won' || ball.speed === 0) continue;
      const actualSpeed = vec2Length(ball.velocity);
      const cappedSpeed = ball.baseSpeed * speedFactor;
      if (actualSpeed > cappedSpeed && cappedSpeed > 0) {
        const ratio = cappedSpeed / actualSpeed;
        ball.velocity.x *= ratio;
        ball.velocity.y *= ratio;
        ball.speed = cappedSpeed;
      }
    }
  }

  if (areAllBallsWon(game)) {
    game.levelComplete = true;
    const percent = Math.round(getGridRemainingPercent(game));
    callbacks.setRemainingPercent(percent);

    const { levelScore, breakdown } = calculateScore(
      game.wallCount, level.expectedCuts, percent,
      level.sizeThreshold, level.points, activeModifiers.scoreMultiplier, levelNumber,
    );
    const lockDelay = game.assimilations.size > 0 ? LOCK_TOTAL_DURATION + 200 : 0;
    setTimeout(() => {
      callbacks.onLevelComplete({
        levelNumber, levelId: level.id, cutCount: game.wallCount,
        expectedCuts: level.expectedCuts, basePoints: level.points,
        levelScore: levelScore + game.lockBonus,
        remainingPercent: percent, thresholdPercent: level.sizeThreshold,
        underParBonus: breakdown.underParBonus, spaceBonus: breakdown.spaceBonus,
        spaceBonusRaw: breakdown.spaceBonusRaw, performanceMultiplier: breakdown.performanceMultiplier,
        fencesUnderPar: breakdown.fencesUnderPar, fencesOverPar: breakdown.fencesOverPar,
        extraPercent: breakdown.extraPercent, lockBonus: game.lockBonus,
        lockedBallsCount: game.lockedBallsCount,
      });
      callbacks.startDissolve(() => {});
    }, lockDelay);
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

  const lockReq = level.threadLockRequired ?? 0;
  if (percent < level.sizeThreshold && game.lockedBallsCount >= lockReq && game.pushMode === "none") {
    callbacks.render();
    callbacks.render();
    game.pushMode = "prompt";
    game.levelClearedTime = performance.now();
    callbacks.setPushMode("prompt");
    callbacks.setClearedPercent(percent);
    game.bestRemainingPercent = percent;
    game.pushStartPercent = percent;
  }
}
