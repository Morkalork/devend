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
import { CellState, gridIndexToWorld } from "@/lib/spaceGrid";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { LevelConfig } from "@/types/level";
import { GrowingWall, Vector2 } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";

// Regression for the "glitchy" lock fill (screenshot: ball locked in the
// top-right corner behind a diagonal fence). The lock tint was tagged from the
// capture-on-lock diff only, which misses the sealing fence's own raster band
// and cells captured in the PRE-lock pass (the acute wedge tips a ball can't
// fit into). Those rendered as dark, cell-quantized fringes between the tinted
// fill and the fence line. The tint mask is now flooded across REMOVED cells to
// the bounding wall segments, so it must span the whole enclosed pocket - and
// never cross the fence into the live board's side.

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
};

const LEVEL: LevelConfig = {
  id: "lock-tint", level: 2, sizeThreshold: 40, expectedCuts: 5, points: 40,
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

// Board is inset by 5%: (45,45)-(855,855). Diagonal fence (600,45)->(855,300)
// seals the top-right corner triangle. Signed distance from the fence line:
// positive = pocket (top-right) side.
const FA = { x: 600, y: 45 }, FB = { x: 855, y: 300 };
function signedDist(p: Vector2): number {
  const dx = FB.x - FA.x, dy = FB.y - FA.y;
  const norm = Math.hypot(dx, dy);
  // For (855,45): dx*(0) - dy*(255) < 0 -> flip so pocket side is positive.
  return -(dx * (p.y - FA.y) - dy * (p.x - FA.x)) / norm;
}

describe("lock tint covers the whole enclosed pocket", () => {
  it("tint reaches the fence band and the wedge tips; never crosses the fence", () => {
    const game = makeGame();
    game.balls = game.balls.slice(0, 2);
    const [A, B] = game.balls;
    A.position = { x: 780, y: 120 }; A.velocity = { x: 80, y: 60 }; A.speed = 100;
    B.position = { x: 300, y: 600 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;

    applyCutFn(completedWall({ x: 727, y: 172 }, FA, FB), game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
    expect(A.state).toBe("won"); // pocket ball locked

    const grid = game.spaceGrid!;
    const tint = grid.lockCaptured!;
    let missingTint = 0, checked = 0, crossedTint = 0;
    for (let i = 0; i < grid.cells.length; i++) {
      const p = gridIndexToWorld(grid, i);
      const inBoard = p.x > 47 && p.x < 853 && p.y > 47 && p.y < 853;
      const d = signedDist(p);
      if (inBoard && d > 10) {
        // Pocket interior (including cells right up against the fence band and
        // the acute tips near (600,45) and (855,300)): must be captured + tinted.
        checked++;
        expect(grid.cells[i]).toBe(CellState.REMOVED);
        if (tint[i] !== 1) missingTint++;
      } else if (d < -12 && tint[i] === 1) {
        // Main-board side of the fence must never be tinted.
        crossedTint++;
      }
    }
    expect(checked).toBeGreaterThan(80); // sanity: the probe saw the pocket
    expect(missingTint).toBe(0);
    expect(crossedTint).toBe(0);
  });
});
