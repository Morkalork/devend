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
import { getLockValue, getLockQuality } from "@/lib/scoring";

// Superior locks (lock quality): a ball sealed into a TIGHT pocket (at most
// superiorThresholdFraction of the BASE lock threshold) pays lockValue x
// superiorMultiplier; a roomy pocket that still locks pays plain lockValue.
// This pins the grading, the pay split (lockBonus vs superiorLockBonus) and
// the flash decoration against the real cut/lock pipeline.

const MODS: GameModifiers = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1, shopDiscountMultiplier: 1, pushBonusMultiplier: 1,
  instantFencesPerMap: 0, additionalConcurrentFences: 0, bonusRemovalChance: 0,
  bonusRemovalAmount: 0, extraLives: 0, extraShopItems: 0,
  shopRestockCount: 0, extraContinues: 0, extraCertificateHours: 0,
  startingCapturePercent: 0, fenceDurabilityBonus: 0, microManagerPerLock: 0,
  ballPathPredictionBounces: 0, ballPathPredictionBalls: 0, ballFreezeDuration: 0,
  freezeUsesPerMap: 0, slowOneBallFactor: 0, freezePickups: 0, ballFreezeCount: 0, autoFreezeDuration: 0, showHighscoreProgress: 0,
  overtimePerLock: 0, fenceSpeedPerLock: 0, frozenLockBonus: 0,
  simultaneousLockBonus: 0, freezeNoCooldown: 0, fenceSpeedPerFence: 0, underParInstantFence: 0,
  bankedSlowPer50h: 0, spaceBonusMultiplier: 1, overtimeCapBonus: 0, freeCheapestOffer: 0,
  wallShieldsPerMap: 0, fenceGraceMs: 0, shipEarlySecondsPerBall: 0,
  scopeCreepImmediate: 0, shipEarlyBonusMultiplier: 1,
  runwayInstantFenceAt: 0, runwayConcurrentFenceAt: 0, runwayFreezeAt: 0,
  spendInstantFencePerChunk: 0, spendFenceSpeedPerChunk: 0,
  lockThresholdBonus: 0, spawnFreezeSeconds: 0, pickupChanceBonus: 0, pickupPayoutLevel: 0,
};

const LEVEL: LevelConfig = {
  id: "superior-lock", level: 2, sizeThreshold: 40, expectedCuts: 5, points: 40,
  // randomShapes: 0 keeps the board deterministic (see lockTintCoverage.test.ts:
  // a random obstacle landing in the pocket skews its cell count).
  maxBalls: 2, entities: [], randomShapes: 0,
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
    lockedBallsCount: 0, lockBonus: 0, superiorLockCount: 0, superiorLockBonus: 0,
    moneyMultiplier: 1, ballSpeedScale: 1,
    assimilations: new Map(), dissolve: null, bonusCutCells: new Set(),
    lockWinThresholdPercent: BALL_WON_REGION_THRESHOLD,
    lockBaseThresholdPercent: BALL_WON_REGION_THRESHOLD,
    lockMinRegionCells: 0,
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

// Board is inset by 5%: playable (45,45)-(855,855), ~656k units². The fences
// below seal the top-right corner triangle; leg length picks the pocket size:
//  - legs 150 -> ~11k units², ~1.7% of the board: far under the 4% superior
//    bar (0.4 x the 10% base threshold).
//  - legs 320 -> ~51k units², ~8.5% of the live board: locks (<= 10%) but is
//    well over the superior bar, so it grades as a plain lock.

describe("superior locks: tight pockets pay the quality multiplier", () => {
  it("a tight pocket grades superior: double pay, counted, flash decorated", () => {
    const game = makeGame();
    game.balls = game.balls.slice(0, 2);
    const [A, B] = game.balls;
    A.position = { x: 800, y: 100 }; A.velocity = { x: 80, y: 60 }; A.speed = 100;
    B.position = { x: 300, y: 600 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;

    applyCutFn(completedWall({ x: 780, y: 120 }, { x: 705, y: 45 }, { x: 855, y: 195 }), game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
    expect(A.state).toBe("won");
    expect(game.lockedBallsCount).toBe(1);

    const { superiorMultiplier } = getLockQuality();
    const expected = Math.round((A.lockMultiplier ?? 1) * getLockValue() * superiorMultiplier);
    expect(game.superiorLockCount).toBe(1);
    expect(game.superiorLockBonus).toBe(expected);
    expect(game.lockBonus).toBe(expected);
    expect(game.assimilations.get(A.id)?.superior).toBe(true);
  });

  it("a roomy pocket still locks but grades standard: plain lock value only", () => {
    const game = makeGame();
    game.balls = game.balls.slice(0, 2);
    const [A, B] = game.balls;
    A.position = { x: 780, y: 120 }; A.velocity = { x: 80, y: 60 }; A.speed = 100;
    B.position = { x: 300, y: 600 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;

    applyCutFn(completedWall({ x: 700, y: 200 }, { x: 535, y: 45 }, { x: 855, y: 365 }), game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
    expect(A.state).toBe("won");
    expect(game.lockedBallsCount).toBe(1);

    expect(game.superiorLockCount).toBe(0);
    expect(game.superiorLockBonus).toBe(0);
    expect(game.lockBonus).toBe(Math.round((A.lockMultiplier ?? 1) * getLockValue()));
    expect(game.assimilations.get(A.id)?.superior).toBe(false);
  });

  it("the split always sums to the total: mixed passes keep lockBonus consistent", () => {
    // Two sequential cuts on one map: first a superior lock, then a standard
    // one. The results-screen split (standard = lockBonus - superiorLockBonus)
    // must account for every hour paid.
    const game = makeGame();
    game.balls = game.balls.slice(0, 2);
    const [A, B] = game.balls;
    A.position = { x: 800, y: 100 }; A.velocity = { x: 80, y: 60 }; A.speed = 100;
    B.position = { x: 100, y: 780 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;

    // Tight top-right pocket for A (superior)...
    applyCutFn(completedWall({ x: 780, y: 120 }, { x: 705, y: 45 }, { x: 855, y: 195 }), game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
    expect(A.state).toBe("won");
    // ...then a roomy bottom-left pocket for B (standard).
    applyCutFn(completedWall({ x: 150, y: 730 }, { x: 45, y: 535 }, { x: 365, y: 855 }), game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
    expect(B.state).toBe("won");

    const { superiorMultiplier } = getLockQuality();
    const superiorPay = Math.round((A.lockMultiplier ?? 1) * getLockValue() * superiorMultiplier);
    const standardPay = Math.round((B.lockMultiplier ?? 1) * getLockValue());
    expect(game.superiorLockCount).toBe(1);
    expect(game.lockedBallsCount).toBe(2);
    expect(game.superiorLockBonus).toBe(superiorPay);
    expect(game.lockBonus).toBe(superiorPay + standardPay);
  });
});
