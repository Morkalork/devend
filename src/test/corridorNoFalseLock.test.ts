import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playBallLockSound: () => {}, playWallHitSound: () => {}, playBallCollideSound: () => {},
  playFenceBreakSound: () => {}, playDeathSound: () => {}, playCutClaimedSound: () => {},
  playLevelCompleteSound: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
}));

import { createInitialGameData } from "@/lib/initGame";
import { applyCutFn } from "@/lib/physics/applyCut";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { LevelConfig } from "@/types/level";
import { GrowingWall, Vector2 } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";

// Regression for the FALSE LOCK: a fence sealed a pocket whose only exit was a
// corridor under an obstacle box, just wider than the ball. The ball-size-aware
// capture's cell-quantized core test couldn't see the corridor was passable
// (the ball-centre passband is narrower than a cell and may miss every cell
// centre), severed it, and the lock check right after saw the ball in a small
// disconnected region -> locked a ball that could physically escape. The core
// test now verifies boundary cells geometrically against the wall segments.

const MODS: GameModifiers = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1, shopDiscountMultiplier: 1, pushBonusMultiplier: 1,
  instantFencesPerMap: 0, additionalConcurrentFences: 0, bonusRemovalChance: 0,
  bonusRemovalAmount: 0, extraLives: 0, extraShopItems: 0,
  shopRestockCount: 0, extraContinues: 0, extraCertificateHours: 0,
  startingCapturePercent: 0, fenceDurabilityBonus: 0, microManagerPerLock: 0,
  ballPathPredictionBounces: 0, ballPathPredictionBalls: 0, ballFreezeDuration: 0,
  ballFreezeCount: 0, autoFreezeDuration: 0, showHighscoreProgress: 0,
  overtimePerLock: 0, fenceSpeedPerLock: 0, frozenLockBonus: 0,
  simultaneousLockBonus: 0, freezeNoCooldown: 0, fenceSpeedPerFence: 0, underParInstantFence: 0,
  bankedSlowPer50h: 0, spaceBonusMultiplier: 1, overtimeCapBonus: 0, freeCheapestOffer: 0,
  wallShieldsPerMap: 0, fenceGraceMs: 0, shipEarlySecondsPerBall: 0,
  scopeCreepImmediate: 0, shipEarlyBonusMultiplier: 1,
  runwayInstantFenceAt: 0, runwayConcurrentFenceAt: 0, runwayFreezeAt: 0,
  spendInstantFencePerChunk: 0, spendFenceSpeedPerChunk: 0,
  lockThresholdBonus: 0, spawnFreezeSeconds: 0,
};

// Board is inset to (45,45)-(855,855). The box's bottom edge sits `gap` world
// units above the bottom board edge; the ball is radius 18 (36 diameter).
function levelWithGap(gap: number): LevelConfig {
  return {
    id: `corridor-${gap}`, level: 6, sizeThreshold: 25, expectedCuts: 14, points: 40,
    maxBalls: 2,
    entities: [
      { id: "box", kind: "wall", shape: "rect", x: 200, y: 500, width: 200, height: 355 - gap },
    ],
  } as unknown as LevelConfig;
}

function makeGame(level: LevelConfig): CanvasGameState {
  const data = createInitialGameData(level, 6, MODS);
  return {
    spaceGrid: data.spaceGrid, gridRegions: data.gridRegions, regions: data.regions,
    walls: data.walls, obstaclePolygons: data.obstaclePolygons, mirrorPolygons: data.mirrorPolygons,
    boardPolygon: data.boardPolygon, originalArea: data.originalArea,
    basePlayableArea: data.basePlayableArea, balls: data.balls, movers: data.movers,
    activeWall: null, gameOver: false, levelComplete: false,
    swipeStart: null, swipeRegionId: null, currentSwipePos: null, swipePointerId: null,
    swipeTrail: null, lastTime: 0, accumulator: 0, animationId: 0, lastAutoFreezeAt: 0,
    screenSize: { width: 900, height: 900 },
    boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
    backgroundColor: "#0a1a10", regionColor: "#1a3020", wallCount: 0,
    wallShieldsRemaining: 0, fastestBallId: data.fastestBallId,
    pushMode: "none", bestRemainingPercent: 100, pushStartPercent: 100,
    levelClearedTime: 0, shimmerStart: 0, shimmerFrozen: false, gameLoopFn: null,
    isRecovering: false, recoveryEndTime: 0, initialSamplePoints: data.initialSamplePoints,
    frozenBallId: null, frozenBallVelocity: null, frozenBallPosition: null,
    lockedBallsCount: 0, lockBonus: 0, moneyMultiplier: 1, ballSpeedScale: 1,
    assimilations: new Map(), dissolve: null, bonusCutCells: new Set(),
    lockWinThresholdPercent: BALL_WON_REGION_THRESHOLD, lockMinRegionCells: 0,
    fenceDurability: null, pendingWallBreaks: [], destructibles: data.destructibles,
    pendingDestroys: [], objectDebris: [], stackObjects: data.stackObjects,
    fallingObjects: [], objectivesTotal: data.objectivesTotal, objectivesBroken: 0,
    breakBonus: 0, lastDudAt: 0,
  } as unknown as CanvasGameState;
}

const noopCallbacks = new Proxy({}, {
  get: (_t, prop) => (prop === "then" ? undefined : () => {}),
}) as never;

function completedWall(origin: Vector2, a: Vector2, b: Vector2): GrowingWall {
  return {
    origin, direction: { x: 0, y: 0 },
    startWaypoints: [origin, a], endWaypoints: [origin, b],
    startSegmentIndex: 0, endSegmentIndex: 0,
    startPoint: a, endPoint: b, targetStart: a, targetEnd: b,
    thickness: 6, isComplete: true, activeRegionId: "",
  };
}

/**
 * Seal the area right of the box with a diagonal fence from the box's
 * bottom-right corner up to the right board edge. The pocket's only exit is the
 * corridor under the box. Ball A sits in the pocket, ball B in the open field.
 */
function runScenario(gap: number): CanvasGameState {
  const level = levelWithGap(gap);
  const game = makeGame(level);
  game.balls = game.balls.slice(0, 2);
  const [A, B] = game.balls;
  A.position = { x: 600, y: 800 }; A.velocity = { x: 80, y: 60 }; A.speed = 100;
  B.position = { x: 120, y: 300 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;
  const boxBottomRight = { x: 400, y: 855 - gap };
  applyCutFn(
    completedWall({ x: 620, y: (boxBottomRight.y + 700) / 2 }, boxBottomRight, { x: 855, y: 700 }),
    game, level, 6, MODS, false, false, 0, noopCallbacks,
  );
  return game;
}

describe("corridor under a box: no false lock (ball-passable gap)", () => {
  it("gap 42 (ball diameter 36 fits): the pocket ball does NOT lock", () => {
    const game = runScenario(42);
    expect(game.balls[0].state).toBe("active");
    expect(game.lockedBallsCount).toBe(0);
  });

  it("gap 24 (ball cannot fit): the pocket ball DOES lock (real trap)", () => {
    const game = runScenario(24);
    expect(game.balls[0].state).toBe("won");
    expect(game.lockedBallsCount).toBe(1);
  });
});
