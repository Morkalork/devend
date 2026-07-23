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
import { calculateScore, getShipEarlyBonus } from "@/lib/scoring";
import { getMapTimeLimit, isTimingExempt } from "@/lib/mapTiming";
import { mutatorOvertimePremium } from "@/lib/mapMutators";
import { objectiveClearReward } from "@/lib/mapObjectives";
import { wasteCapturedPickups } from "@/lib/pickups";
import { LOCK_TOTAL_DURATION, LEVEL_CLEAR_SHIMMER_MS, LEVEL_CLEAR_HOLD_MS } from "@/lib/gameConstants";
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
  // Single allocation-free scan (runs every frame via the win-condition check):
  // true iff at least one ball counts and every counting ball is won.
  let any = false;
  for (const b of game.balls) {
    if (b.speed > 0 || b.state === 'won') {
      any = true;
      if (b.state !== 'won') return false;
    }
  }
  return any;
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
        game.activeWalls = game.activeWalls.filter(w => w !== wall);
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

  // Snapshot the grid with the new fence rasterized but BEFORE reachability
  // capture severs any sub-ball-width gaps. The lock check uses it to demand a
  // REAL seal: a ball only locks in a pocket enclosed by actual barriers, not
  // one the capture "closed" across a gap the ball merely can't fit through.
  const preCaptureCells = game.spaceGrid ? Uint8Array.from(game.spaceGrid.cells) : null;

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
  game.activeWalls = game.activeWalls.filter(w => w !== wall);
  playCutClaimedSound();

  const lockedBefore = game.lockedBallsCount;
  const anyBallWon = checkAndUpdateBallWonStates(game, activeModifiers, cumulativeLockedBalls, callbacks, preCaptureCells);
  if (anyBallWon) {
    // How many balls this cut locked: the simultaneous-trap multiplier pays
    // x2/x3 for multi-locks, and the tint mask below stores the same count so
    // multi-ball pockets render brighter (pay and visual stay in sync).
    const newlyLocked = Math.max(1, game.lockedBallsCount - lockedBefore);
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
        // The mask stores the lock INTENSITY (balls locked by this cut), not
        // just 0/1: pockets that trapped 2+ balls at once render a brighter
        // tint (see GameCanvas step 2b). Never downgrade an earlier pocket.
        const intensity = Math.min(newlyLocked, 255);
        for (const idx of floodRemovedEnclosure(grid, seeds, game.walls)) {
          if (grid.lockCaptured[idx] < intensity) grid.lockCaptured[idx] = intensity;
        }
      }
    }
    callbacks.repaintRegionCanvas();
  }

  // Pickups: any token whose cell got captured WITHOUT a lock claiming it is
  // wasted (empty-space capture, or the fence was drawn straight over it).
  // Runs after the lock pass, so a properly sealed token was already claimed.
  wasteCapturedPickups(game);

  callbacks.render();

  // Issue #37: ball speeds are flat — no per-cut acceleration ramp. Only the
  // MicroManager upgrade still caps speeds, floored so the stack never drops a
  // ball below MIN_BALL_SPEED_FACTOR of normal (issue #42).
  applyMicroManagerSpeedCap(balls, activeModifiers, cumulativeLockedBalls + game.lockedBallsCount);

  const percent = evaluateWinConditions(game, level, levelNumber, activeModifiers, callbacks);

  if (percent !== null && tutorialMode && !tutorialCutMade && percent < 100) {
    callbacks.setTutorialCutMade(true);
    callbacks.onTutorialCutSuccess?.();
  }
}

/**
 * Evaluate BOTH win conditions in the canonical order and act on them: all
 * balls locked finishes the level immediately; otherwise the space-clear check
 * runs (opening the push-your-luck prompt at/under the goal).
 *
 * This is the single shared entry point for every win check — the post-cut and
 * post-destroy checks AND the per-frame safety net in the game loop. Making it
 * frame-safe is the whole point: triggerLevelComplete and checkSpaceWin each
 * guard against re-entry, so re-running this every active frame is a cheap
 * no-op until a win is genuinely reachable. That guarantees the top bar can
 * never sit on CLEAR while an unfinished, non-pushing map quietly fails to end
 * (the win was previously only evaluated when a cut or a destroy fired, so any
 * other path to the goal could strand the map showing CLEAR forever).
 *
 * Returns the remaining percent from the space check, or null when the
 * all-balls-won path finished the level (no percent was computed).
 */
export function evaluateWinConditions(
  game: CanvasGameState,
  level: LevelConfig,
  levelNumber: number,
  activeModifiers: GameModifiers,
  callbacks: GameCallbacks,
): number | null {
  if (game.levelComplete || game.gameOver) return null;
  // Hard map deadline: out of time is game over regardless of lives. Runs on
  // the pausable active-play clock, so shops/holds/recovery never count. Only
  // fires during normal play (this check is gated behind those states upstream)
  // and before any win is registered, so beating the buzzer still wins.
  const timeLimit = getMapTimeLimit(level, levelNumber);
  if (timeLimit != null && game.activePlaySeconds >= timeLimit) {
    handleGameOverFn(game, level, levelNumber, activeModifiers, callbacks);
    return null;
  }
  // Boss maps (issue #56): DEFEATING THE BOSS SHIPS IT. The moment the boss is
  // beaten the map completes, regardless of remaining space - the fight is about
  // the boss, not grinding the board. So on a boss map only the boss's defeat
  // finishes the map (the space-clear path never applies); the deadline above is
  // the fail state.
  if (level.boss) {
    if (game.bossDefeated) {
      triggerLevelComplete(game, level, levelNumber, activeModifiers, callbacks);
    }
    return null;
  }
  // Non-boss maps keep the normal all-balls-locked and space-clear win paths.
  if (areAllBallsWon(game)) {
    triggerLevelComplete(game, level, levelNumber, activeModifiers, callbacks);
    return null;
  }
  return checkSpaceWin(game, level, callbacks);
}

type SpaceWinCallbacks = Pick<GameCallbacks, 'setRemainingPercent' | 'setClearedPercent' | 'setPushMode'>;

/**
 * Recompute the remaining space and open the push-your-luck prompt when the
 * win condition is met. Shared by every path that can shrink the playable
 * space: a completed cut (applyCut above) AND post-cut object destroys, which
 * can capture pocket cells without a fence involved — previously those could
 * cross the threshold with "CLEAR" in the top bar but no prompt.
 *
 * NB the comparison is <= to match the HUD: the top bar shows CLEAR at
 * remaining == sizeThreshold, and a win check of strictly-less left the map
 * unfinished on an exact landing.
 *
 * Returns the rounded remaining percent for the caller's own bookkeeping.
 */
export function checkSpaceWin(
  game: CanvasGameState,
  level: LevelConfig,
  callbacks: SpaceWinCallbacks,
): number {
  const percent = Math.round(getGridRemainingPercent(game));
  callbacks.setRemainingPercent(percent);

  if (game.pushMode === "pushing" && percent < game.bestRemainingPercent) {
    game.bestRemainingPercent = percent;
  }

  // Breaking objects is a bonus, not a win condition (issue #38) — the level is
  // completed by shrinking the board, exactly as normal.
  const lockReq = level.threadLockRequired ?? 0;
  if (percent <= level.sizeThreshold && game.lockedBallsCount >= lockReq && game.pushMode === "none" && !game.pushPromptPending && !game.levelComplete) {
    // The frame is already drawn (loop render + the post-cut render above) and
    // pushMode is still "none" here, so these would be pixel-identical repaints.
    // The two redundant full renders spiked this frame to 4 redraws and caused a
    // visible twitch right as the push-your-luck modal mounted.
    game.levelClearedTime = performance.now();
    // Ship Early: freeze the tempo clock at the first win moment, so time spent
    // in the prompt or pushing is never taxed. Only reachable once per map
    // (guarded by pushMode === "none" / pushPromptPending).
    game.clearedActiveSeconds = game.activePlaySeconds;
    callbacks.setClearedPercent(percent);
    game.bestRemainingPercent = percent;
    game.pushStartPercent = percent;
    // If a lock flash is still playing (the winning cut usually locked a ball),
    // hold the world and let it finish before the modal mounts; the game loop
    // opens the prompt when the flash ends. Otherwise open it right away.
    const now = performance.now();
    let flashActive = false;
    for (const [, f] of game.assimilations) {
      if (now - f.startTime < LOCK_TOTAL_DURATION) { flashActive = true; break; }
    }
    if (flashActive) {
      game.pushPromptPending = true;
    } else {
      game.pushMode = "prompt";
      callbacks.setPushMode("prompt");
    }
  }
  return percent;
}

type CompleteCallbacks = Pick<GameCallbacks, 'setRemainingPercent' | 'setPushMode' | 'onLevelComplete' | 'startDissolve' | 'onMapComplete' | 'freezeOnComplete'>;

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
  game.levelCompleteTime = performance.now(); // anchors the space bar fade-out
  playLevelCompleteSound();
  const percent = Math.round(getGridRemainingPercent(game));
  callbacks.setRemainingPercent(percent);

  // Ship Early: the all-balls-locked path never opens the push prompt, so the
  // tempo clock freezes here; banking after a prompt keeps the earlier value.
  if (game.clearedActiveSeconds == null) game.clearedActiveSeconds = game.activePlaySeconds;
  // Ship Early is disabled on the tutorial band (levels 1-3), which also has no
  // time limit — early play stays pressure free.
  const shipEarlyBonus = isTimingExempt(levelNumber)
    ? 0
    : getShipEarlyBonus(game.clearedActiveSeconds, game.balls.length, activeModifiers.shipEarlySecondsPerBall, activeModifiers.shipEarlyBonusMultiplier);

  // Locking the last ball can finish the level MID-PUSH (the per-frame win
  // check). End the push here: award the chunks banked so far and drop the
  // pushing HUD. Bank & Continue guards on levelComplete, so its button can
  // never queue a second, competing completion pipeline after this one.
  let pushBonus = 0;
  if (game.pushMode === "pushing") {
    const chunkSize = game.pushStartPercent * 0.25;
    const areaCleared = Math.max(0, game.pushStartPercent - game.bestRemainingPercent);
    pushBonus = chunkSize > 0
      ? Math.round(Math.floor(areaCleared / chunkSize) * activeModifiers.pushBonusMultiplier)
      : 0;
  }
  if (game.pushMode !== "none") {
    game.pushMode = "none";
    callbacks.setPushMode("none");
  }

  // Per-map objective bonus (issue #55): if the rolled objective is met at
  // clear, its reward folds under the cap too. Optional and non-failing.
  const objectiveBonus = objectiveClearReward(game.objective, {
    lockedBalls: game.lockedBallsCount,
    superiorLocks: game.superiorLockCount,
    cuts: game.wallCount,
    par: level.expectedCuts,
    activeSeconds: game.activePlaySeconds,
    bossDefeated: game.bossDefeated,
  });

  // Fold lock + break + push + ship-early + map-mutator + objective bonuses in
  // before the cap so a single map can't exceed the per-map ceiling (issue #43).
  const { levelScore, breakdown } = calculateScore(
    game.wallCount, level.expectedCuts, percent, level.sizeThreshold, level.points, {
      scoreMultiplier: activeModifiers.scoreMultiplier,
      extraBonus: game.lockBonus + game.breakBonus + pushBonus + shipEarlyBonus + mutatorOvertimePremium(game.mapMutator) + objectiveBonus,
      spaceBonusMultiplier: activeModifiers.spaceBonusMultiplier,
      // Comp Time pickups raise THIS map's cap on top of the capstone raise.
      overtimeCapBonus: activeModifiers.overtimeCapBonus + (game.pickupCapBonus ?? 0),
      // Overtime pickups pay after the cap (a claimed token always pays).
      postCapBonus: game.pickupOvertime ?? 0,
      // Demolition multiplier: compounds ×1.15 per destructible smashed.
      payoutMultiplier: game.breakMultiplier ?? 1,
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
  // Post-sweep beat: hold the drained board for a moment, shatter it away,
  // and only then mount the completion overlay (mounting it at the exact
  // sweep end read as a jerky cut, and hid the shatter behind the card).
  setTimeout(() => {
    callbacks.startDissolve(() => {
      callbacks.onLevelComplete({
        levelNumber, levelId: level.id, cutCount: game.wallCount,
        expectedCuts: level.expectedCuts, basePoints: level.points,
        levelScore,
        remainingPercent: percent, thresholdPercent: level.sizeThreshold, pushBonus,
        underParBonus: breakdown.underParBonus, spaceBonus: breakdown.spaceBonus,
        spaceBonusRaw: breakdown.spaceBonusRaw, performanceMultiplier: breakdown.performanceMultiplier,
        fencesUnderPar: breakdown.fencesUnderPar, fencesOverPar: breakdown.fencesOverPar,
        extraPercent: breakdown.extraPercent, lockBonus: game.lockBonus,
        lockedBallsCount: game.lockedBallsCount,
        superiorLockCount: game.superiorLockCount, superiorLockBonus: game.superiorLockBonus,
        breakBonus: game.breakBonus,
        breakMultiplier: game.breakMultiplier,
        chestRewards: (game.chestRewardsLog && game.chestRewardsLog.length > 0) ? [...game.chestRewardsLog] : undefined,
        shipEarlyBonus, clearTimeSeconds: game.clearedActiveSeconds ?? undefined,
        pickupBonus: game.pickupOvertime || undefined,
        // triggerLevelComplete is only reached via the all-balls-locked win, so
        // the board drained to 0% remaining - flag it so the results screen
        // hides the now-meaningless Remaining row.
        wonByAllLocked: true,
      });
    });
  }, lockDelay + LEVEL_CLEAR_SHIMMER_MS + LEVEL_CLEAR_HOLD_MS);
}
