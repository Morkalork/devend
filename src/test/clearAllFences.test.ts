/**
 * Clear All Fences ability (#38, the risky one): removing all player fences must
 * reopen non-locked captured space (remaining % rises) while KEEPING locked-ball
 * pockets captured and the locked balls + their points intact. Built on a real
 * grid via createInitialGameData + a couple of cuts that lock a ball, mirroring
 * destroyRecapture.test.ts.
 */
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
import { clearAllFences } from "@/lib/abilityEffects";
import { CellState, getRemainingPercent } from "@/lib/spaceGrid";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { LevelConfig } from "@/types/level";
import { GrowingWall, Vector2 } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";

const MODS: GameModifiers = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1, shopDiscountMultiplier: 1, pushBonusMultiplier: 1,
  instantFencesPerMap: 0, additionalConcurrentFences: 0, bonusRemovalChance: 0,
  bonusRemovalAmount: 0, extraLives: 0, extraShopItems: 0,
  shopRestockCount: 0, extraContinues: 0, extraCertificateHours: 0,
  startingCapturePercent: 0, fenceDurabilityBonus: 0, microManagerPerLock: 0,
  ballPathPredictionBounces: 0, ballPathPredictionBalls: 0, ballFreezeDuration: 0,
  freezeUsesPerMap: 0, slowOneBallFactor: 0, freezePickups: 0, ballFreezeCount: 0, autoFreezeDuration: 0, showHighscoreProgress: 0,
  overtimePerLock: 0, overtimePerSuperiorLock: 0, fenceSpeedPerLock: 0, frozenLockBonus: 0,
  simultaneousLockBonus: 0, freezeNoCooldown: 0, fenceSpeedPerFence: 0, underParInstantFence: 0,
  bankedSlowPer50h: 0, spaceBonusMultiplier: 1, overtimeCapBonus: 0, freeCheapestOffer: 0,
  wallShieldsPerMap: 0, fenceGraceMs: 0, shipEarlySecondsPerBall: 0,
  scopeCreepImmediate: 0, shipEarlyBonusMultiplier: 1,
  runwayInstantFenceAt: 0, runwayConcurrentFenceAt: 0, runwayFreezeAt: 0,
  spendInstantFencePerChunk: 0, spendFenceSpeedPerChunk: 0, spendCapturePerChunk: 0, spendChunkCapBonus: 0,
  lockThresholdBonus: 0, spawnFreezeSeconds: 0, pickupChanceBonus: 0, pickupPayoutLevel: 0,
};

// Obstacle top-left; no random shapes (cell-coverage test, per the flaky-locktint
// lesson) so capture is deterministic.
const LEVEL: LevelConfig = {
  id: "clear-fences", level: 2, sizeThreshold: 40, expectedCuts: 5, points: 40,
  maxBalls: 2, variety: 0, randomShapes: 0,
  entities: [
    { id: "wall-1", kind: "wall", shape: "rect", x: -11, y: -11, width: 400, height: 180 },
  ],
} as unknown as LevelConfig;

function makeGame(): CanvasGameState {
  const data = createInitialGameData(LEVEL, 2, MODS);
  return {
    spaceGrid: data.spaceGrid, gridRegions: data.gridRegions, regions: data.regions,
    walls: data.walls, obstaclePolygons: data.obstaclePolygons, mirrorPolygons: data.mirrorPolygons,
    boardPolygon: data.boardPolygon, originalArea: data.originalArea,
    basePlayableArea: data.basePlayableArea, balls: data.balls, movers: data.movers,
    activeWalls: [], gameOver: false, levelComplete: false,
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
    lockedBallsCount: 0, lockBonus: 0, superiorLockCount: 0, superiorLockBonus: 0, moneyMultiplier: 1, ballSpeedScale: 1,
    assimilations: new Map(), dissolve: null, bonusCutCells: new Set(),
    lockWinThresholdPercent: BALL_WON_REGION_THRESHOLD, lockMinRegionCells: 0,
    fenceDurability: null, pendingWallBreaks: [], destructibles: data.destructibles,
    pendingDestroys: [], objectDebris: [], stackObjects: data.stackObjects,
    fallingObjects: [], objectivesTotal: data.objectivesTotal, objectivesBroken: 0,
    breakBonus: 0, lastDudAt: 0, activePlaySeconds: 0,
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

/** Seal the top-left pocket with two cuts; the pocket ball locks. */
function sealPocket(game: CanvasGameState): void {
  game.balls = game.balls.slice(0, 2);
  const [A, B] = game.balls;
  A.position = { x: 200, y: 210 }; A.velocity = { x: 80, y: 60 }; A.speed = 100;
  B.position = { x: 620, y: 420 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;
  applyCutFn(completedWall({ x: 64, y: 500 }, { x: 64, y: 169 }, { x: 64, y: 855 }), game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
  applyCutFn(completedWall({ x: 175, y: 320 }, { x: 285, y: 169 }, { x: 64, y: 472 }), game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
}

const isFenceWall = (id: string) => !id.startsWith("board-") && !id.startsWith("obstacle-");

describe("Clear All Fences (#38)", () => {
  it("removes all player fences but keeps board and obstacle walls", () => {
    const game = makeGame();
    sealPocket(game);
    expect(game.walls.some(w => isFenceWall(w.id))).toBe(true); // fences exist first
    const boardCount = game.walls.filter(w => w.id.startsWith("board-")).length;
    const obstacleCount = game.walls.filter(w => w.id.startsWith("obstacle-")).length;

    clearAllFences(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} });

    expect(game.walls.some(w => isFenceWall(w.id))).toBe(false); // all fences gone
    expect(game.walls.filter(w => w.id.startsWith("board-")).length).toBe(boardCount);
    expect(game.walls.filter(w => w.id.startsWith("obstacle-")).length).toBe(obstacleCount);
  });

  it("reopens captured space so remaining % rises", () => {
    const game = makeGame();
    sealPocket(game);
    const before = getRemainingPercent(game.spaceGrid!);
    expect(before).toBeLessThan(100); // the seal captured space

    clearAllFences(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} });

    const after = getRemainingPercent(game.spaceGrid!);
    expect(after).toBeGreaterThan(before); // non-locked space reopened
  });

  it("keeps locked balls locked and their pocket cells captured", () => {
    const game = makeGame();
    sealPocket(game);
    expect(game.balls[0].state).toBe("won"); // pocket ball locked
    const lockedCount = game.lockedBallsCount;
    const lockBonus = game.lockBonus;
    // Snapshot the locked-pocket cells (lockCaptured >= 1) that must stay REMOVED.
    const lockCap = game.spaceGrid!.lockCaptured!;
    const pocketCells: number[] = [];
    for (let i = 0; i < lockCap.length; i++) if (lockCap[i] >= 1) pocketCells.push(i);
    expect(pocketCells.length).toBeGreaterThan(0);

    clearAllFences(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} });

    // Points + locked ball untouched.
    expect(game.balls[0].state).toBe("won");
    expect(game.lockedBallsCount).toBe(lockedCount);
    expect(game.lockBonus).toBe(lockBonus);
    // Every locked-pocket cell is still captured (REMOVED), never reopened.
    for (const idx of pocketCells) {
      expect(game.spaceGrid!.cells[idx]).toBe(CellState.REMOVED);
    }
  });

  it("shatters the cleared fences into debris (not a silent vanish)", () => {
    const game = makeGame();
    sealPocket(game);
    game.objectDebris = [];
    clearAllFences(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {}, fenceColor: '#00ff88' });
    expect(game.objectDebris.length).toBeGreaterThan(0);
    // Each burst carries flying shard particles.
    expect(game.objectDebris[0].particles.length).toBeGreaterThan(0);
  });

  it("is a no-op when there are no fences to clear", () => {
    const game = makeGame();
    const wallsBefore = game.walls.length;
    const pctBefore = getRemainingPercent(game.spaceGrid!);
    clearAllFences(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} });
    expect(game.walls.length).toBe(wallsBefore);
    expect(getRemainingPercent(game.spaceGrid!)).toBe(pctBefore);
  });
});

describe("concurrent fences (#38)", () => {
  it("applyCut finalizes ONLY its own wall, leaving the other still growing", () => {
    const game = makeGame();
    const w1 = completedWall({ x: 64, y: 500 }, { x: 64, y: 169 }, { x: 64, y: 855 });
    const w2 = completedWall({ x: 800, y: 500 }, { x: 800, y: 169 }, { x: 800, y: 855 });
    game.activeWalls = [w1, w2];
    applyCutFn(w1, game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
    // w1 is committed and removed; w2 keeps growing.
    expect(game.activeWalls).toEqual([w2]);
  });
});
