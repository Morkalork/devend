import { GrowingWall, Ball, Region, Vector2, WinReason } from "@/types/game";
import { traceContours, snapContoursToWalls } from "@/lib/rendering/regionContour";
import { CanvasGameState } from "@/types/gameState";
import { LevelConfig } from "@/types/level";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { GameCallbacks } from "./gameCallbacks";
import { checkAndUpdateBallWonStates, applyMicroManagerSpeedCap } from "./checkBallWonState";
import { handleGameOverFn } from "./handleGameOver";
import { fenceBudgetExhausted } from "@/lib/fenceBudget";
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
import { rebuildWallGrid } from "@/lib/physics/wallGrid";
import { calculateScore, getShipEarlyPercent } from "@/lib/scoring";
import { readLockAxes } from "@/lib/lockCapacity";
import { effectivePar } from "@/lib/par";
import { tickBoardTilt } from "@/lib/physics/boardTiltTick";
import { getMapTimeLimit, isTimingExempt } from "@/lib/mapTiming";
import { gateAreas } from "@/lib/coloredAreas";
import { mutatorOvertimePremium } from "@/lib/mapMutators";
import { objectiveClearReward } from "@/lib/mapObjectives";
import { wasteCapturedPickups } from "@/lib/pickups";
import { tickCircuitOnCut } from "@/lib/physics/circuit";
import { tickChargeOnCut } from "@/lib/physics/charge";
import { tickDataStreamOnCut } from "@/lib/physics/dataStream";
import { LOCK_TOTAL_DURATION, LEVEL_CLEAR_SHIMMER_MS, LEVEL_CLEAR_HOLD_MS, BASE_BALL_RADIUS } from "@/lib/gameConstants";
import { playCutClaimedSound, playLevelCompleteSound } from "@/lib/gameAudio";
import {
  resolveWinSpec, isWinMet, winReasonFor, winBonusPercent, metAlternative, requirementsMet,
} from "@/lib/winSpec";
import type { WinSnapshot, WinSpec } from "@/types/winSpec";

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
    // A dormant ball (#73) counts and is NOT won, so the lock-all win can't fire
    // until every dormant ball has been booted (and then trapped).
    if (b.speed > 0 || b.state === 'won' || b.state === 'dormant') {
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
  return wouldWallOrphanBall(start, end, game.balls, game.regions, game.walls, game.spaceGrid);
}

/**
 * Capture (REMOVE from the space grid) every cell no active ball can physically
 * reach. This captures fenced-off, ball-free areas AND pockets sealed behind an
 * obstacle by a gap too narrow for the ball to fit through (which plain 1-cell
 * connectivity wrongly counts as reachable — the "shadow behind the obstacle").
 * A won ball counts as no ball, so a region a ball just locked in is captured.
 * game.gridRegions is left holding only the surviving (ball-bearing) regions.
 */
function captureUnreachableSpace(game: CanvasGameState): {
  gridRegions: ReturnType<typeof findGridRegions>;
  gridRegionMap: ReturnType<typeof buildGridRegionMap>;
} | null {
  if (!game.spaceGrid) return null;
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
  // Return the FULL region set + map: checkBallWonState needs the same thing and
  // the grid cells don't change before it runs, so it reuses these instead of
  // recomputing findGridRegions + a ~3600-entry Map every cut.
  return { gridRegions, gridRegionMap };
}

/** How long a claim flash lives, in ms. Short: it is punctuation, not an event. */
const CLAIM_FLASH_MS = 420;
/** Below this many cells a claim is a sliver, and flashing it is just noise. */
const CLAIM_MIN_CELLS = 6;

/**
 * Flash the ground this cut just took.
 *
 * The cells are the difference between the grid before the capture and after,
 * traced into smooth outlines the same way a lock flash traces its pocket, so
 * the two effects speak in one visual language rather than one being cells and
 * the other a shape.
 *
 * Silent for tiny claims. Every cut shaves a few cells off somewhere, and
 * flashing those turns the punctuation into a stutter.
 */
function recordClaimFlash(game: CanvasGameState, before: Uint8Array | null): void {
  const grid = game.spaceGrid;
  if (!grid || !before) return;
  const cells = grid.cells;
  const claimed = new Set<number>();
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== before[i]) claimed.add(i);
  }
  if (claimed.size < CLAIM_MIN_CELLS) return;

  const gw = grid.width;
  const contours = snapContoursToWalls(
    traceContours(grid, (col, row) => claimed.has(row * gw + col)),
    game.walls,
    grid.cellSize * 1.05,
  );
  if (contours.length === 0) return;
  (game.claimFlashes ??= []).push({ contours, startTime: performance.now() });
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
    if (ball.state === 'dormant') continue; // un-booted (#73): fences pass through it
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

  // The grid regions this computes are still valid at the lock check below (no
  // code between mutates grid cells), so hand them off to avoid recomputing.
  const capturedRegions = captureUnreachableSpace(game);
  recordClaimFlash(game, preCaptureCells);

  // Update sample-based regions.
  //
  // Built fresh rather than reusing game.wallGrid: the fence's own segments were
  // pushed above, and a stale index would let samples adjacent to the new fence
  // connect straight through it - silently merging the two halves of the cut the
  // player just made. One O(walls) build per cut is nothing next to what the
  // index saves inside the split (profiled at ~90% of the whole cut pass).
  const splitIndex = rebuildWallGrid(null, game.walls, game.boardPolygon ?? null);
  const updatedRegions: Region[] = [];
  for (const region of [...game.regions]) {
    const subRegions = findSubRegionsGrid(region, game.balls, game.walls, splitIndex);
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
  // paintCellRegionIds ran just above for the new regions, so the grid gives
  // each ball's region in O(1) here (falling back to the sample scan near walls)
  // instead of the O(balls x regions x samples x walls) scan this used to be.
  reassignBallsToRegions(game.balls, game.regions, game.walls, game.spaceGrid);
  validateAllBallOwnership(game.balls, game.regions, game.walls, game.spaceGrid);
  game.activeWalls = game.activeWalls.filter(w => w !== wall);
  playCutClaimedSound();

  // Remaining space as this cut left it, BEFORE any lock drains the board.
  //
  // Locking the last ball captures everything still unreachable, so remaining
  // drops to 0% and the size threshold is then met as a CONSEQUENCE of the lock.
  // Comparing against that would let every all-locked win claim it also cleared
  // the board. Measured here, the number is the space this cut genuinely
  // captured, so "the space target was also met" can only be said when it is
  // independently true.
  const lockedBefore = game.lockedBallsCount;
  game.percentBeforeLocks = getGridRemainingPercent(game);
  // Snapshot the superior tally so the tint pass below can tell whether the
  // lock it is about to paint was a tight seal. The grade is decided inside
  // checkBallWonState and nothing else carries it out here.
  const superiorBefore = game.superiorLockCount;
  const anyBallWon = checkAndUpdateBallWonStates(game, activeModifiers, cumulativeLockedBalls, callbacks, preCaptureCells, capturedRegions);
  const wasSuperior = game.superiorLockCount > superiorBefore;
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
        // Bounded to the captured area's own box, generously inflated so the
        // tint can still pick up cells captured in an earlier pass within the
        // same chamber, while a flood escaping through a sub-ball-width gap
        // cannot reach the space beyond. A cell budget could not tell those two
        // apart; a box can.
        const pad = 6;
        let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
        for (const idx of seeds) {
          const r = (idx / grid.width) | 0;
          const c = idx % grid.width;
          if (c < minCol) minCol = c;
          if (c > maxCol) maxCol = c;
          if (r < minRow) minRow = r;
          if (r > maxRow) maxRow = r;
        }
        // Smallest ball still in play, so the gate only blocks a slit that NO
        // ball could have passed. Blocking on a bigger ball's width would wall
        // off gaps a smaller one legitimately uses, and under-fill the tint.
        const liveRadii = game.balls
          .filter(b => b.state !== 'won' && b.state !== 'dormant')
          .map(b => b.radius);
        const throatWidth = 2 * (liveRadii.length > 0 ? Math.min(...liveRadii) : BASE_BALL_RADIUS);
        const bounded = floodRemovedEnclosure(grid, seeds, game.walls, {
          bounds: {
            minCol: minCol - pad, maxCol: maxCol + pad,
            minRow: minRow - pad, maxRow: maxRow + pad,
          },
          minThroatWidth: throatWidth,
        });
        if (!grid.superiorCaptured) grid.superiorCaptured = new Uint8Array(grid.cells.length);
        for (const idx of bounded) {
          if (grid.lockCaptured[idx] < intensity) grid.lockCaptured[idx] = intensity;
          // Never downgrade: a pocket that ever held a superior lock keeps the
          // mark, the same way lockCaptured keeps its highest intensity.
          if (wasSuperior) grid.superiorCaptured[idx] = 1;
        }
      }
    }
  }

  // Pickups: any token whose cell got captured WITHOUT a lock claiming it is
  // wasted (empty-space capture, or the fence was drawn straight over it).
  // Runs after the lock pass, so a properly sealed token was already claimed.
  wasteCapturedPickups(game);

  // "Wire the Integration": light any circuit terminals this fence routed
  // through; completing the circuit opens its sealed bonus vault (reopens space
  // + repaints), reflected by the single paint below.
  tickCircuitOnCut(game, wall, callbacks);

  // "Deploy Charge": arm any fuse this fence routed over (it detonates later,
  // on its telegraphed delay, in tickCharges).
  tickChargeOnCut(game, wall, callbacks);

  // "Data Stream": harvest any seam spans this fence ran along (scaled payoff).
  tickDataStreamOnCut(game, wall, callbacks);

  // Paint the region canvas ONCE per cut, here at the end, reflecting the FINAL
  // grid (post-capture, post-lock), then present. It used to repaint mid-cut AND
  // again after a lock's recapture - two full contour-trace + GPU-texture passes
  // on the hitchiest frame. One pass halves that work on lock frames.
  callbacks.repaintRegionCanvas();
  callbacks.render();

  // Issue #37: ball speeds are flat — no per-cut acceleration ramp. Only the
  // MicroManager upgrade still caps speeds, floored so the stack never drops a
  // ball below MIN_BALL_SPEED_FACTOR of normal (issue #42).
  applyMicroManagerSpeedCap(balls, activeModifiers, cumulativeLockedBalls + game.lockedBallsCount);

  // This fence completed and partitioned the space: it counts toward the fence
  // budget (only successful cuts do).
  game.completedCuts += 1;
  callbacks.setCompletedCuts?.(game.completedCuts);

  const percent = evaluateWinConditions(game, level, levelNumber, activeModifiers, callbacks);

  // Sporadic board tilt (issue #77). Rolled here, right after a cut has changed
  // how much is cleared, because the tiers are PROGRESS not time: tying them to
  // a clock means a well-played map ends before the first roll and the tilt only
  // ever hits players who were already struggling.
  //
  // Landing it just after a committed fence is also when it bites hardest: you
  // have just decided where your walls go, and the board turns under them.
  if (percent !== null) {
    // Recorded before the tilt roll so anything reading cleared space this
    // frame (dormant wells) sees the same number the roll used.
    game.spaceRemainingPercent = percent;
    tickBoardTilt(game, level, levelNumber, 100 - percent);
  }

  if (percent !== null && tutorialMode && !tutorialCutMade && percent < 100) {
    callbacks.setTutorialCutMade(true);
    callbacks.onTutorialCutSuccess?.();
  }

  // Fence budget / WIP Limit: the last allowed fence just completed and it did
  // not finish the map -> lose a life + restart (evaluateWinConditions ran
  // first, so a winning final cut wins instead of failing here).
  if (fenceBudgetExhausted(level.fenceBudget, game.completedCuts, {
    levelComplete: game.levelComplete, gameOver: game.gameOver,
    pushMode: game.pushMode, pushPromptPending: game.pushPromptPending,
  })) {
    handleGameOverFn(game, level, levelNumber, activeModifiers, callbacks);
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
  // Hard map deadline. Runs on the pausable active-play clock, so
  // shops/holds/recovery never count; fires only during normal play and before
  // any win registers, so beating the buzzer still wins. Out of time costs ONE
  // life and restarts the map fresh (not a whole-run loss); the run ends only
  // when the last life is spent.
  const timeLimit = getMapTimeLimit(level, levelNumber);
  if (timeLimit != null && game.activePlaySeconds >= timeLimit) {
    const newLives = callbacks.getLives() - 1;
    callbacks.setLivesRef(newLives);
    callbacks.setDisplayLives(newLives);
    callbacks.onLivesChange(newLives);
    if (newLives <= 0) {
      handleGameOverFn(game, level, levelNumber, activeModifiers, callbacks);
      return null;
    }
    // A life remains: freeze the loop, flash red, then remount this level.
    game.gameOver = true;
    if (callbacks.shakeTimeoutRef.current) clearTimeout(callbacks.shakeTimeoutRef.current);
    callbacks.setScreenFlash("red");
    callbacks.setIsShaking(true);
    callbacks.shakeTimeoutRef.current = setTimeout(() => {
      callbacks.shakeTimeoutRef.current = null;
      callbacks.setScreenFlash("none");
      callbacks.setIsShaking(false);
      callbacks.onMapTimedOut?.();
    }, 700);
    return null;
  }
  // ── The win, read from the map's spec rather than from a chain of ifs ────
  //
  // resolveWinSpec derives an identical spec from the legacy fields when a map
  // has no authored `win:` block, so all 40 existing maps behave exactly as
  // before: a gate area or a boss is still the SOLE win, and the space clear
  // still carries threadLockRequired alongside it.
  const spec = resolveWinSpec(level);
  const snap = readWinSnapshot(game, level);

  // The area gate has a FAIL state as well as a win: if no target can still
  // reach a zone, the map is lost rather than merely unfinished. That is a
  // property of the board, not of the spec, so it is checked whenever the win
  // actually depends on an area.
  if (spec.require.some(c => c.kind === "area") && !isWinMet(spec, snap)) {
    const hasBoss = game.balls.some(b => b.isBoss);
    const activeTargets = game.balls.some(b =>
      b.state !== "won" && b.speed > 0 && (!hasBoss || b.isBoss));
    if (!activeTargets) {
      handleGameOverFn(game, level, levelNumber, activeModifiers, callbacks);
      return null;
    }
  }

  // An ALTERNATIVE win ends the map outright. "Every ball locked" is the one
  // every ordinary map carries, and it has always shipped immediately for a
  // plain reason: there is nothing left to push with. Checked before the
  // requirements, exactly as the old chain checked areAllBallsWon before the
  // space clear - reading the win as one boolean and then deciding on the
  // shape of `require` sent an all-locked win into the push prompt and offered
  // the player a push on an empty board.
  if (metAlternative(spec, snap)) {
    triggerLevelComplete(
      game, level, levelNumber, activeModifiers, callbacks, winReasonFor(spec, snap));
    return null;
  }

  if (requirementsMet(spec, snap)) {
    // The ordinary clear keeps the push-your-luck prompt: that is the whole
    // push mechanic. Anything else (a gate zone, a boss, a named ball) ships
    // the moment it lands, the way those wins always have.
    if (isPlainSpaceWin(spec)) {
      return checkSpaceWin(game, level, callbacks, levelNumber, activeModifiers);
    }
    triggerLevelComplete(
      game, level, levelNumber, activeModifiers, callbacks, winReasonFor(spec, snap));
    return null;
  }

  // Not won yet. Only a spec that can still end through the space clear needs
  // the percent recomputed for the HUD; a gate map's top bar is not counting
  // down to anything.
  if (spec.require.some(c => c.kind === "space")) {
    return checkSpaceWin(game, level, callbacks, levelNumber, activeModifiers);
  }
  return null;
}

/** The counters every win condition reads, gathered from live game state. */
export function readWinSnapshot(game: CanvasGameState, level: LevelConfig): WinSnapshot {
  return {
    remainingPercent: Math.round(getGridRemainingPercent(game)),
    lockedBalls: game.lockedBallsCount,
    superiorLocks: game.superiorLockCount,
    areaTargets: game.coloredAreaTargets ?? 0,
    lockedByType: game.lockedByType ?? {},
    bossDefeated: game.bossDefeated,
    allLocked: areAllBallsWon(game),
    cuts: game.wallCount,
    par: level.expectedCuts,
    activeSeconds: game.activePlaySeconds,
  };
}

/**
 * Is this the ordinary "clear the board" ending?
 *
 * Only that one opens the push-your-luck prompt. A gate zone, a boss or a
 * named-ball lock ships the map the instant it lands, which is the behaviour
 * those wins have always had and the reason the prompt cannot simply be
 * attached to every win.
 */
function isPlainSpaceWin(spec: WinSpec): boolean {
  return spec.require.every(c => c.kind === "space" || c.kind === "locks");
}





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
  callbacks: GameCallbacks,
  levelNumber: number,
  activeModifiers: GameModifiers,
): number {
  const percent = Math.round(getGridRemainingPercent(game));
  callbacks.setRemainingPercent(percent);

  if (game.pushMode === "pushing" && percent < game.bestRemainingPercent) {
    game.bestRemainingPercent = percent;
  }

  // Breaking objects is a bonus, not a win condition (issue #38) — the level is
  // completed by shrinking the board, exactly as normal.
  const lockReq = level.threadLockRequired ?? 0;
  // Never prompt on a board with nothing left in play. Push Your Luck is a bet
  // that you can keep clearing while the balls are still loose, so with every
  // ball locked there is no bet to make: the offer just hands the player an
  // empty map and a spent decision. Guarded here as well as at the call above,
  // because this is the mechanic's own precondition and not a property of any
  // one route into it.
  if (percent <= level.sizeThreshold && game.lockedBallsCount >= lockReq
      && game.pushMode === "none" && !game.pushPromptPending && !game.levelComplete) {
    // Push Your Luck is a bet that you can keep clearing while the balls are
    // still loose. With every ball locked there is no bet to make, so the offer
    // would hand the player an empty map and a spent decision. Banks straight
    // through instead of skipping: skipping would leave the top bar reading
    // CLEAR on a map that never ends, which is the one thing the win check is
    // there to make impossible.
    if (areAllBallsWon(game) || activeModifiers.disablePushYourLuck > 0) {
      triggerLevelComplete(
        game, level, levelNumber, activeModifiers, callbacks,
        areAllBallsWon(game) ? 'allLocked' : 'space');
      return percent;
    }
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
  /**
   * Which condition finished the map. Required rather than defaulted: four
   * different wins funnel through here and a default would quietly mislabel
   * whichever one a future caller forgets about, which is exactly how
   * `wonByAllLocked` came to be hardcoded true for all of them.
   */
  reason: WinReason,
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
  const shipEarlyPercent = isTimingExempt(levelNumber)
    ? 0
    : getShipEarlyPercent(game.clearedActiveSeconds, game.balls.length, activeModifiers.shipEarlySecondsPerBall);

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
    par: effectivePar(level.expectedCuts, activeModifiers),
    activeSeconds: game.activePlaySeconds,
    bossDefeated: game.bossDefeated,
  });

  // Fold lock + break + push + map-mutator + objective bonuses in before the cap
  // so a single map can't exceed the per-map ceiling (issue #43); ship-early is
  // paid as a percent ABOVE the cap (see shipEarlyPercent).
  // The map's own win premium: what its conditions said they were worth, for
  // the ones it actually met. Recomputed here rather than passed in, so every
  // caller of triggerLevelComplete gets it without having to remember to.
  const winSpec = resolveWinSpec(level);
  const winPct = winBonusPercent(winSpec, readWinSnapshot(game, level));
  const { levelScore, breakdown, shipEarlyBonus, winBonus } = calculateScore(
    game.wallCount, effectivePar(level.expectedCuts, activeModifiers), percent, level.sizeThreshold, level.points, {
      scoreMultiplier: activeModifiers.scoreMultiplier,
      // Upgrade multipliers raise an axis CEILING, so a lane you never played
      // has nothing for them to multiply. That is the build commitment.
      underParBonusMultiplier: activeModifiers.underParBonusMultiplier,
      spaceBonusMultiplier: activeModifiers.spaceBonusMultiplier,
      tempoCeilingMultiplier: activeModifiers.shipEarlyBonusMultiplier,
      // Delivery + Craft, read as a fraction of this map's own lock capacity.
      locks: readLockAxes(game),
      // Push-your-luck and demolition are the same bet as clearing past the
      // requirement, so they bank into Greed.
      greedBonus: pushBonus + game.breakBonus,
      // Owed regardless of route: the mutator's hazard premium, the objective
      // reward, and Stock Options / Comp Time, which used to raise a ceiling
      // that no longer binds anything.
      flatBonus: mutatorOvertimePremium(game.mapMutator) + objectiveBonus
        + activeModifiers.overtimeCapBonus + (game.pickupCapBonus ?? 0),
      postCapBonus: game.pickupOvertime ?? 0,
      // The Ship Early ladder's percent, which the Tempo axis is scored on.
      shipEarlyPercent,
      winBonusPercent: winPct,
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
        expectedCuts: effectivePar(level.expectedCuts, activeModifiers), basePoints: level.points,
        levelScore,
        remainingPercent: percent, thresholdPercent: level.sizeThreshold, pushBonus,
        underParBonus: breakdown.underParBonus, spaceBonus: breakdown.spaceBonus,
        spaceBonusRaw: breakdown.spaceBonusRaw, performanceMultiplier: breakdown.performanceMultiplier,
        fencesUnderPar: breakdown.fencesUnderPar, fencesOverPar: breakdown.fencesOverPar,
        extraPercent: breakdown.extraPercent, axes: breakdown.axes, winBonus, winBonusPercent: winPct, lockBonus: game.lockBonus,
        lockedBallsCount: game.lockedBallsCount,
        superiorLockCount: game.superiorLockCount, superiorLockBonus: game.superiorLockBonus,
        zoneLockCount: game.zoneLockCount, zoneLockBonus: game.zoneLockBonus,
        breakBonus: game.breakBonus,
        breakMultiplier: game.breakMultiplier,
        chestRewards: (game.chestRewardsLog && game.chestRewardsLog.length > 0) ? [...game.chestRewardsLog] : undefined,
        shipEarlyBonus, clearTimeSeconds: game.clearedActiveSeconds ?? undefined,
        pickupBonus: game.pickupOvertime || undefined,
        // Every power-up claimed this map (#59), so the finish screen lists them.
        pickupsClaimed: (game.pickupsClaimedLog && game.pickupsClaimedLog.length > 0) ? [...game.pickupsClaimedLog] : undefined,
        winReason: reason,
        // Both conditions genuinely landed on the same cut: the space target was
        // already met by what this cut captured, and then the lock ended the map
        // before the space win could open the Push Your Luck prompt. Naming only
        // the winner would be true but not the whole truth.
        alsoClearedSpace: reason === 'allLocked'
          && game.percentBeforeLocks != null
          && game.percentBeforeLocks <= level.sizeThreshold,
        // Only the all-balls-locked win drains the board to 0% remaining, which
        // makes the Remaining row meaningless and worth hiding. This was
        // hardcoded true, on a comment claiming this path was reachable only
        // that way - it is reached four ways, so boss, area and
        // push-disabled space wins were all hiding a row that mattered.
        wonByAllLocked: reason === 'allLocked',
      });
    });
  }, lockDelay + LEVEL_CLEAR_SHIMMER_MS + LEVEL_CLEAR_HOLD_MS);
}
