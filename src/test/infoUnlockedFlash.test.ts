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

// The "Info Unlocked" flash (first-ever lock of a ball type) is driven by
// GameCallbacks.onBallTypeLocked's return value, threaded through
// checkBallWonState.ts into the lock's assimilation state (LockFlashState.
// firstEncounter). This pins that wiring against the real cut/lock pipeline:
// the callback's return value - not some default - decides the flag, and the
// callback fires with the correct ball-type id.

const MODS: GameModifiers = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1, shopDiscountMultiplier: 1, pushBonusMultiplier: 1,
  instantFencesPerMap: 0, additionalConcurrentFences: 0, bonusRemovalChance: 0,
  bonusRemovalAmount: 0, extraLives: 0, scoreInterestRate: 0, extraShopItems: 0,
  shopRestockCount: 0, extraContinues: 0, extraCertificateHours: 0,
  startingCapturePercent: 0, fenceDurabilityBonus: 0, microManagerPerLock: 0,
  ballPathPredictionBounces: 0, ballPathPredictionBalls: 0, ballFreezeDuration: 0,
  ballFreezeCount: 0, autoFreezeDuration: 0, showHighscoreProgress: 0,
  overtimePerLock: 0, fenceSpeedPerLock: 0, frozenLockBonus: 0, scoreInterestCapBonus: 0,
  simultaneousLockBonus: 0, freezeNoCooldown: 0, fenceSpeedPerFence: 0, underParInstantFence: 0,
  bankedSlowPer50h: 0, spaceBonusMultiplier: 1, overtimeCapBonus: 0, freeCheapestOffer: 0,
  wallShieldsPerMap: 0, fenceGraceMs: 0,
};

const LEVEL: LevelConfig = {
  id: "info-unlocked", level: 2, sizeThreshold: 40, expectedCuts: 5, points: 40,
  maxBalls: 2, entities: [],
} as unknown as LevelConfig;

function makeGame(): CanvasGameState {
  const data = createInitialGameData(LEVEL, 2, MODS);
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

function callbacksWithLockHandler(onBallTypeLocked: (typeId: string) => boolean) {
  return new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "then") return undefined;
      if (prop === "onBallTypeLocked") return onBallTypeLocked;
      return () => {};
    },
  }) as never;
}

function completedWall(origin: Vector2, a: Vector2, b: Vector2): GrowingWall {
  return {
    origin, direction: { x: 0, y: 0 },
    startWaypoints: [origin, a], endWaypoints: [origin, b],
    startSegmentIndex: 0, endSegmentIndex: 0,
    startPoint: a, endPoint: b, targetStart: a, targetEnd: b,
    thickness: 6, isComplete: true, activeRegionId: "",
  };
}

// Diagonal fence sealing the top-right corner triangle - locks whichever ball
// sits in it (same geometry as lockTintCoverage.test.ts).
const FA = { x: 600, y: 45 }, FB = { x: 855, y: 300 };

function lockAPocketBall(onBallTypeLocked: (typeId: string) => boolean) {
  const game = makeGame();
  game.balls = game.balls.slice(0, 2);
  const [pocketBall, otherBall] = game.balls;
  pocketBall.position = { x: 780, y: 120 };
  pocketBall.velocity = { x: 80, y: 60 };
  pocketBall.speed = 100;
  otherBall.position = { x: 300, y: 600 };
  otherBall.velocity = { x: -70, y: 90 };
  otherBall.speed = 114;

  applyCutFn(
    completedWall({ x: 727, y: 172 }, FA, FB), game, LEVEL, 2, MODS,
    false, false, 0, callbacksWithLockHandler(onBallTypeLocked),
  );
  return { game, pocketBall };
}

describe("Info Unlocked flash: onBallTypeLocked return value drives LockFlashState.firstEncounter", () => {
  it("firstEncounter is true when onBallTypeLocked reports a new type", () => {
    const seen: string[] = [];
    const { game, pocketBall } = lockAPocketBall(typeId => { seen.push(typeId); return true; });
    expect(pocketBall.state).toBe("won");
    expect(seen).toEqual([pocketBall.typeId]);
    const flash = game.assimilations.get(pocketBall.id);
    expect(flash?.firstEncounter).toBe(true);
  });

  it("firstEncounter is false when onBallTypeLocked reports an already-known type", () => {
    const { game, pocketBall } = lockAPocketBall(() => false);
    expect(pocketBall.state).toBe("won");
    const flash = game.assimilations.get(pocketBall.id);
    expect(flash?.firstEncounter).toBe(false);
  });

  it("firstEncounter defaults to false when no callback is supplied (bare tools/tests)", () => {
    const game = makeGame();
    game.balls = game.balls.slice(0, 2);
    const [pocketBall, otherBall] = game.balls;
    pocketBall.position = { x: 780, y: 120 };
    pocketBall.velocity = { x: 80, y: 60 };
    pocketBall.speed = 100;
    otherBall.position = { x: 300, y: 600 };
    otherBall.velocity = { x: -70, y: 90 };
    otherBall.speed = 114;
    const bareCallbacks = new Proxy({}, {
      get: (_t, prop) => (prop === "then" || prop === "onBallTypeLocked" ? undefined : () => {}),
    }) as never;
    applyCutFn(
      completedWall({ x: 727, y: 172 }, FA, FB), game, LEVEL, 2, MODS,
      false, false, 0, bareCallbacks,
    );
    expect(pocketBall.state).toBe("won");
    expect(game.assimilations.get(pocketBall.id)?.firstEncounter).toBe(false);
  });
});
