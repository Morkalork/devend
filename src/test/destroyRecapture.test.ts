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
import { processDestroysFn } from "@/lib/physics/destructibles";
import { CellState, gridIndexToWorld, SpaceGrid } from "@/lib/spaceGrid";
import { pointInPolygon, Polygon } from "@/lib/polygon";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { LevelConfig } from "@/types/level";
import { GrowingWall, Vector2 } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";

// Regression for the "incompletely filled captured pocket" (level-2b screenshot):
// destroying a breakable reopens its grid footprint as ACTIVE space with no
// reachability check. When the destroyed/toppled box sits INSIDE captured
// territory (stack-chain topple across a sealed fence), the reopened footprint
// used to linger forever as an uncapturable dark island in the captured fill,
// inflating the remaining-%. processDestroysFn must recapture reopened cells no
// ball can physically reach - while reopened cells in ball-reachable space stay
// ACTIVE (that's the point of breaking things).

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
};

// Mimics level-2b: obstacle block top-left, a breakable box inside the future
// pocket, and a control breakable out in the open field.
const LEVEL: LevelConfig = {
  id: "destroy-recapture", level: 2, sizeThreshold: 40, expectedCuts: 5, points: 40,
  maxBalls: 2,
  entities: [
    { id: "wall-1", kind: "wall", shape: "rect", x: -11, y: -11, width: 400, height: 180 },
    { id: "pocket-box", kind: "wall", shape: "rect", x: 100, y: 290, width: 60, height: 40, breakable: true },
    { id: "open-box", kind: "wall", shape: "rect", x: 500, y: 600, width: 80, height: 50, breakable: true },
  ],
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

/** ACTIVE cells whose center lies inside the polygon. */
function activeCellsIn(grid: SpaceGrid, poly: Polygon): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] !== CellState.ACTIVE) continue;
    if (pointInPolygon(gridIndexToWorld(grid, i), poly)) n++;
  }
  return n;
}

/** Seal the top-left pocket with two cuts; the pocket ball locks. */
function sealPocket(game: CanvasGameState): void {
  game.balls = game.balls.slice(0, 2);
  const [A, B] = game.balls;
  A.position = { x: 200, y: 210 }; A.velocity = { x: 80, y: 60 }; A.speed = 100;
  B.position = { x: 620, y: 420 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;
  // Vertical fence at x=64, then diagonal (285,169)->(64,472), like the report.
  applyCutFn(completedWall({ x: 64, y: 500 }, { x: 64, y: 169 }, { x: 64, y: 855 }), game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
  applyCutFn(completedWall({ x: 175, y: 320 }, { x: 285, y: 169 }, { x: 64, y: 472 }), game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
}

function destroyBox(game: CanvasGameState, id: string): void {
  const d = game.destructibles.find(x => x.id === id && x.kind === "breakable");
  expect(d, `destructible ${id} exists`).toBeTruthy();
  d!.destroyed = true;
  game.pendingDestroys.push(d!);
  processDestroysFn(game, {
    repaintRegionCanvas: () => {},
    setRemainingPercent: () => {},
    onObjectDestroyed: () => {},
  });
}

describe("destroy-reopen inside captured territory (#incomplete pocket fill)", () => {
  it("sealing the pocket captures it fully (base invariant)", () => {
    const game = makeGame();
    sealPocket(game);
    expect(game.balls[0].state).toBe("won"); // pocket ball locked
    // Every cell of the pocket triangle is REMOVED (captured), except the box
    // footprint which is REMOVED too (obstacle).
    const pocketProbe: Polygon = { vertices: [{ x: 70, y: 175 }, { x: 270, y: 175 }, { x: 70, y: 455 }] };
    expect(activeCellsIn(game.spaceGrid!, pocketProbe)).toBe(0);
  });

  it("a box destroyed INSIDE the captured pocket does not leave an active island", () => {
    const game = makeGame();
    sealPocket(game);
    const boxPoly: Polygon = { vertices: [{ x: 100, y: 290 }, { x: 160, y: 290 }, { x: 160, y: 330 }, { x: 100, y: 330 }] };
    destroyBox(game, "pocket-box");
    // Without the recapture, the reopened footprint stayed ACTIVE forever - an
    // uncapturable dark island in the captured fill (the reported bug).
    expect(activeCellsIn(game.spaceGrid!, boxPoly)).toBe(0);
  });

  it("a box destroyed in OPEN space stays capturable (reopened cells remain active)", () => {
    const game = makeGame();
    sealPocket(game);
    const boxPoly: Polygon = { vertices: [{ x: 500, y: 600 }, { x: 580, y: 600 }, { x: 580, y: 650 }, { x: 500, y: 650 }] };
    destroyBox(game, "open-box");
    // Reachable reopened space must NOT be swallowed by the recapture.
    expect(activeCellsIn(game.spaceGrid!, boxPoly)).toBeGreaterThan(0);
  });
});
