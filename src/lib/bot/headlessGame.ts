/**
 * A game you can play without a screen.
 *
 * Every test in this repo so far checks one function against one situation
 * someone thought of. This drives the REAL physics - the same updateBall,
 * updateFenceWallFn and applyCutFn the browser runs - through thousands of
 * frames of actual play, and watches for states nobody thought of.
 *
 * The value is in the second kind of bug. A unit test asks "does this do what I
 * expect"; a bot asks "is there any sequence of legal moves that breaks it",
 * which is the question that finds unwinnable maps, softlocks, and arithmetic
 * that only goes non-finite on the four hundredth frame of a particular seed.
 *
 * ── What this is NOT ───────────────────────────────────────────────────────
 *
 * Not the game loop. useGameLoop owns rendering, timing, React state and the
 * hundred callbacks the UI needs; reproducing it here would be a second copy
 * that drifts. This is the SUBSET that moves the world: the same functions in
 * the same order, stepped at the same fixed PHYSICS_STEP, with the UI
 * callbacks stubbed. If the loop's order changes, this must change with it -
 * which is why the order below is commented against its source.
 */
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { runtimeDefaults } from "./runtimeDefaults";
import { DEFAULT_SCOPE_CREEP } from "@/lib/scopeCreep";
import { createInitialGameData } from "@/lib/initGame";
import { castRayWithReflections } from "@/lib/wallGeometry";
import { vec2Normalize } from "@/lib/polygon";
import { applyLodestones } from "@/lib/physics/lodestone";
import { updateMoversFn } from "@/lib/physics/updateMovers";
import { tickPhasing } from "@/lib/physics/phasing";
import { updateBall } from "@/lib/physics/updateBall";
import { updateFenceWallFn } from "@/lib/physics/updateFenceWall";
import { applyCutFn } from "@/lib/physics/applyCut";
import { wallBlocksCutStart } from "@/lib/physics/cutStart";
import { isPositionActive } from "@/lib/spaceGrid";
import { findRegionContainingPoint } from "@/lib/gameUtils";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { GrowingWall, Vector2 } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";
import { DEFAULT_MODIFIERS, type GameModifiers } from "@/hooks/useActiveModifiers";

/**
 * A clock the bot controls.
 *
 * The engine reads wall-clock time in several places - fence growth is
 * `performance.now() - wall.startTime`, and the boss leap, the lock glide and
 * the freeze all key off it too. That is correct in the browser, where a frame
 * takes a frame. Headlessly it is fatal: the bot steps thousands of frames in a
 * few milliseconds of real time, so `elapsed` stays near zero, fences never
 * finish, and the bot sits watching a board that cannot change.
 *
 * So simulated time IS the clock while a run is in progress. The engine is
 * untouched and still reads performance.now(); it just gets told the time the
 * simulation is at. That also makes a run independent of how fast the machine
 * is, which is what lets a seed reproduce a finding exactly.
 */
let virtualNowMs = 0;
let realNow: (() => number) | null = null;

/** Take over the clock. Must be paired with releaseClock in a finally. */
export function installClock(startMs = 1000): void {
  if (realNow) return;
  realNow = performance.now.bind(performance);
  virtualNowMs = startMs;
  performance.now = () => virtualNowMs;
}

export function releaseClock(): void {
  if (!realNow) return;
  performance.now = realNow;
  realNow = null;
}

/** Move simulated time forward. */
export function advanceClock(seconds: number): void {
  virtualNowMs += seconds * 1000;
}

/** Everything the bot did and everything the game told it, for the report. */
export interface BotEvents {
  levelComplete: boolean;
  gameOver: boolean;
  livesLost: number;
  cutsMade: number;
  locks: number;
  remainingPercent: number;
}

export interface BotGame {
  game: CanvasGameState;
  level: LevelConfig;
  levelNumber: number;
  modifiers: GameModifiers;
  callbacks: GameCallbacks;
  events: BotEvents;
  frames: number;
}

/**
 * Modifiers with everything off, so a run measures the map and not a build.
 *
 * DEFAULT_MODIFIERS rather than a hand-written subset. A partial object does
 * not fail loudly here: `1 + activeModifiers.fenceSpeedPerLock * 0` on a
 * missing key is NaN, which flows into the fence speed, which makes every
 * growth step NaN, and the fence simply never moves. The bot then sits
 * watching a board that cannot change and reports the MAP as unresolvable -
 * a bug in the harness, dressed as a finding about the game.
 */
export function plainModifiers(over: Partial<GameModifiers> = {}): GameModifiers {
  return { ...DEFAULT_MODIFIERS, ...over };
}

/**
 * Callbacks that record instead of rendering.
 *
 * Deliberately not silent no-ops: the callbacks ARE the game telling you what
 * happened, and a bot that ignores them cannot tell a win from a crash. The
 * ones that matter are recorded; the rest are stubs because they drive pixels.
 */
function recordingCallbacks(events: BotEvents): GameCallbacks {
  const noop = () => {};
  return {
    // ── what the game is telling us ──────────────────────────────────────
    setLockedBallsCount: (n: number) => { events.locks = n; },
    setRemainingPercent: (n: number) => { events.remainingPercent = n; },
    onLevelComplete: () => { events.levelComplete = true; },
    onGameEnd: () => { events.gameOver = true; },
    onLivesChange: () => { events.livesLost += 1; },

    // ── things that only exist to paint ──────────────────────────────────
    // Enumerated rather than proxied on purpose: a Proxy returning a function
    // for any name would let the harness sail past a callback the engine
    // genuinely needs a real answer from, and the bot would report whatever
    // that silence caused as a bug in the game.
    collectAndDrawRemovedSamples: noop,
    repaintRegionCanvas: noop,
    render: noop,
    startDissolve: noop,
    setTutorialCutMade: noop,
    setPushMode: noop,
    setClearedPercent: noop,
    setScreenFlash: noop,
    setIsShaking: noop,
    setIsRecovering: noop,
    setWallShieldCount: noop,
    setDisplayLives: noop,
    setCompletedCuts: noop,
    onMapComplete: noop,
    onMapTimedOut: noop,
    onTutorialCutSuccess: noop,
    onBossState: noop,
    onChargeArmed: noop,
    onChargeBlown: noop,
    onChestReward: noop,
    onCircuitComplete: noop,
    onFenceBroke: noop,
    onObjectDestroyed: noop,
    onStreamHarvested: noop,

    // ── answers the engine actually branches on ──────────────────────────
    // A lock is only counted if this says yes, and freezeOnComplete false is
    // what lets a finished map finish rather than holding on a frozen board.
    onBallTypeLocked: () => true,
    freezeOnComplete: () => false,
    getLives: () => 3,
    setLivesRef: noop,
    flashTimeoutRef: { current: null },
    shakeTimeoutRef: { current: null },
  } as unknown as GameCallbacks;
}

/** Deal a map, ready to be played. */
export function createBotGame(
  level: LevelConfig, levelNumber: number, modifiers: GameModifiers = plainModifiers(),
): BotGame {
  const events: BotEvents = {
    levelComplete: false, gameOver: false, livesLost: 0,
    cutsMade: 0, locks: 0, remainingPercent: 100,
  };
  // The runtime fields first, then the map's own data over the top - the same
  // order GameCanvas builds its gameRef in. createInitialGameData describes a
  // BOARD; the loop also needs the mutable play state (activeWalls, the swipe,
  // the beat trackers) that the component owns.
  const game = {
    ...runtimeDefaults(),
    creepConfig: DEFAULT_SCOPE_CREEP,
    mapMutator: null,
    gravityConfig: null,
    objective: null,
    ...createInitialGameData(level, levelNumber, modifiers),
  } as unknown as CanvasGameState;
  return {
    game, level, levelNumber, modifiers,
    callbacks: recordingCallbacks(events),
    events, frames: 0,
  };
}

/**
 * One physics frame, in useGameLoop's order.
 *
 * The order is the contract, not a detail: lodestones pull before anything
 * moves so a cluster feels one pull rather than a cascade, and phasing flips
 * solidity BEFORE ball physics so a ball never resolves against an obstacle
 * that is about to stop existing. Both are commented at the loop; both are
 * reproduced here on purpose.
 */
export function stepBot(ctx: BotGame, dt: number = PHYSICS_STEP): void {
  const { game, level, levelNumber, modifiers, callbacks } = ctx;
  if (game.levelComplete || game.gameOver) return;

  // Time moves before anything reads it, so a fence started on the previous
  // frame sees a non-zero elapsed on this one.
  advanceClock(dt);
  game.activePlaySeconds = (game.activePlaySeconds ?? 0) + dt;

  for (const ball of game.balls) {
    if (!ball.prevPosition) ball.prevPosition = { x: ball.position.x, y: ball.position.y };
    ball.prevPosition.x = ball.position.x;
    ball.prevPosition.y = ball.position.y;
  }

  applyLodestones(game.balls, dt, game.frozenBallId ?? null);
  updateMoversFn(dt, game);
  tickPhasing(game, game.activePlaySeconds);

  for (const ball of game.balls) updateBall(ball, dt, game);

  // Growing fences, then the cuts any of them just finished. applyCutFn
  // removes the wall itself, so the list is snapshotted exactly as the loop
  // does it.
  for (const wall of [...game.activeWalls]) {
    updateFenceWallFn(dt, game, level, levelNumber, modifiers, 680, 750, 50, callbacks, wall);
  }
  if (!game.levelComplete) {
    for (const wall of [...game.activeWalls]) {
      if (game.levelComplete) break;
      if (wall.isComplete) {
        applyCutFn(wall, game, level, levelNumber, modifiers, false, true, 0, callbacks);
      }
    }
  }
  ctx.frames += 1;
}

/**
 * Start a fence at `origin` heading along `direction`, if the game allows it.
 *
 * Mirrors useGameInput: cast a ray both ways to find where the fence would
 * stop, and build the wall from those waypoints. Returns false when the cut is
 * not legal from here, which is information rather than a failure - a bot that
 * could always cut would never find the states where you cannot.
 */
export function tryCut(ctx: BotGame, origin: Vector2, direction: Vector2): boolean {
  const { game } = ctx;
  if (game.levelComplete || game.gameOver) return false;

  // The same legality chain useGameInput walks, in the same order. A bot that
  // skipped it would happily start fences from inside captured space or through
  // a wall, and every "bug" it reported would be its own.
  if (!game.spaceGrid || !isPositionActive(game.spaceGrid, origin)) return false;
  const region = findRegionContainingPoint(game.regions, origin.x, origin.y);
  if (!region) return false;
  for (const w of game.walls) {
    if (wallBlocksCutStart(origin, w, game.spaceGrid)) return false;
  }

  const dir = vec2Normalize(direction);
  if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y)) return false;
  const neg = { x: -dir.x, y: -dir.y };

  const forward = castRayWithReflections(origin, dir, game.walls);
  const backward = castRayWithReflections(origin, neg, game.walls);
  const endWaypoints = forward.waypoints;
  const startWaypoints = backward.waypoints;
  if (endWaypoints.length < 2 || startWaypoints.length < 2) return false;

  game.wallCount = (game.wallCount ?? 0) + 1;
  game.activeWalls.push({
    origin: { ...origin },
    direction: dir,
    startWaypoints,
    endWaypoints,
    startSegmentIndex: 0,
    endSegmentIndex: 0,
    startPoint: { ...origin },
    endPoint: { ...origin },
    targetStart: startWaypoints[startWaypoints.length - 1],
    targetEnd: endWaypoints[endWaypoints.length - 1],
    thickness: 4,
    isComplete: false,
    activeRegionId: region.id,
    startTime: performance.now(),
  } as unknown as GrowingWall);
  ctx.events.cutsMade += 1;
  return true;
}
