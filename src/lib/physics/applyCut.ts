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
  CellState,
  rasterizeCutToGrid,
  findGridRegions,
  getRemainingPercent,
  captureUnreachableCells,
  buildGridRegionMap,
  findGridRegionForBall,
  floodRemovedEnclosure,
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
import { playCutClaimedSound, playLevelCompleteSound } from "@/lib/gameAudio";

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

/**
 * Capture (REMOVE from the space grid) every cell no active ball can physically
 * reach. This captures fenced-off, ball-free areas AND pockets sealed behind an
 * obstacle by a gap too narrow for the ball to fit through (which plain 1-cell
 * connectivity wrongly counts as reachable — the "shadow behind the obstacle").
 * A won ball counts as no ball, so a region a ball just locked in is captured.
 * game.gridRegions is left holding only the surviving (ball-bearing) regions.
 */
function captureUnreachableSpace(game: CanvasGameState): void {
  if (!game.spaceGrid) return;
  // Wall segments let the capture verify borderline corridors geometrically
  // instead of severing every gap the cell grid can't resolve (false locks).
  captureUnreachableCells(game.spaceGrid, game.balls, game.walls);

  // Recompute the surviving regions (all now ball-reachable) for downstream
  // bookkeeping. Neighbour-search fallback locates balls whose grid-cell centre
  // sits in a REMOVED cell (e.g. touching a mirror boundary).
  const gridRegions = findGridRegions(game.spaceGrid);
  const gridRegionMap = buildGridRegionMap(gridRegions);
  const regionsWithBalls = new Set<(typeof gridRegions)[number]>();
  for (const ball of game.balls) {
    if (ball.state === 'won') continue;
    const ballRegion = findGridRegionForBall(game.spaceGrid, gridRegionMap, ball.position.x, ball.position.y);
    if (ballRegion) regionsWithBalls.add(ballRegion);
  }
  game.gridRegions = [...regionsWithBalls];
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

  captureUnreachableSpace(game);

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
  playCutClaimedSound();

  const anyBallWon = checkAndUpdateBallWonStates(game, activeModifiers, cumulativeLockedBalls, callbacks);
  if (anyBallWon) {
    // A ball locked during this cut. It was still an active ball when the capture
    // above ran, so the region it locked in wasn't captured then and would linger
    // as an uncaptured (active) region beside the obstacle until the next cut -
    // the "shadow behind the obstacle". Capture ball-free regions again now that
    // it's won, and repaint (the region-fill's space-grid mask then renders those
    // cells as captured instead of punching them dark).
    const grid = game.spaceGrid;
    // Snapshot ACTIVE cells so we can tag what this lock captures and give it
    // the persistent accent tint that marks locked territory.
    const before = grid ? Uint8Array.from(grid.cells) : null;
    captureUnreachableSpace(game);
    if (grid && before) {
      if (!grid.lockCaptured) grid.lockCaptured = new Uint8Array(grid.cells.length);
      // The capture diff alone under-covers the pocket: the sealing fence's own
      // raster band and any cells captured in the PRE-lock pass (e.g. the acute
      // tip of a wedge the ball never fit into) aren't in the diff, so they
      // rendered as dark, cell-quantized fringes between the tint and the fence
      // line. Flood from the diff across REMOVED cells, stopping at actual wall
      // segments: the tint then spans the whole enclosed chamber, up to (never
      // across) each bounding fence, obstacle edge and board edge.
      const seeds: number[] = [];
      for (let i = 0; i < grid.cells.length; i++) {
        if (before[i] === CellState.ACTIVE && grid.cells[i] === CellState.REMOVED) {
          seeds.push(i);
        }
      }
      if (seeds.length > 0) {
        for (const idx of floodRemovedEnclosure(grid, seeds, game.walls)) {
          grid.lockCaptured[idx] = 1;
        }
      }
    }
    callbacks.repaintRegionCanvas();
  }
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

type CompleteCallbacks = Pick<GameCallbacks, 'setRemainingPercent' | 'onLevelComplete' | 'startDissolve' | 'onMapComplete' | 'freezeOnComplete'>;

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
  playLevelCompleteSound();
  const percent = Math.round(getGridRemainingPercent(game));
  callbacks.setRemainingPercent(percent);

  // Fold lock + break bonuses in before the cap so a single map can't exceed
  // the per-map ceiling (issue #43).
  const { levelScore, breakdown } = calculateScore(
    game.wallCount, level.expectedCuts, percent, level.sizeThreshold, level.points, {
      scoreMultiplier: activeModifiers.scoreMultiplier,
      extraBonus: game.lockBonus + game.breakBonus,
      spaceBonusMultiplier: activeModifiers.spaceBonusMultiplier,
      overtimeCapBonus: activeModifiers.overtimeCapBonus,
    },
  );
  const lockDelay = game.assimilations.size > 0 ? LOCK_TOTAL_DURATION + 200 : 0;
  // Celebratory beat: after any lock animations settle, sweep a shimmer down the
  // whole board (fences, obstacles and all) before the completion overlay mounts.
  game.shimmerStart = performance.now() + lockDelay;
  game.shimmerFrozen = callbacks.freezeOnComplete?.() ?? false;
  callbacks.onMapComplete?.(); // freeze the background code for the "dead" beat
  // Dev/playground freeze: play the shimmer, then hold the drained frame instead
  // of advancing to the completion overlay / dissolve.
  if (game.shimmerFrozen) return;
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
