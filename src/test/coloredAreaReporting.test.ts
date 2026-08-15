/**
 * Making Colored Areas legible (reported from live play: "I fenced a ball over
 * a colored area, nothing showed in the post-map view and nothing in-game said
 * I had activated it").
 *
 * The credit RULE is covered by coloredAreaLockCredit.test.ts. This covers the
 * reporting around it, which was the other half of that report and was missing
 * outright:
 *
 *   - the zone multiplier was multiplied into lockBonus and never itemised, so
 *     a var/let/const lock and an ordinary lock were indistinguishable on the
 *     results screen;
 *   - the only signal at lock time was the zone quietly lighting up, which is
 *     impossible to tell apart from a near miss;
 *   - devend:lockDebug recorded whether the pocket sat inside an area, but not
 *     whether the area PAID, so the existing diagnostic could not answer the
 *     question either.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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
import { areaStyle } from "@/lib/coloredAreas";
import { getLockValue } from "@/lib/scoring";
import {
  getLockDecisions, setLockDebugEnabled, clearLockDecisions,
} from "@/lib/lockDiagnostics";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { CanvasGameState } from "@/types/gameState";
import type { GrowingWall, Vector2 } from "@/types/game";
import type { ColoredArea, LevelConfig } from "@/types/level";

const MODS = new Proxy({}, {
  get: (_t, p) => (String(p).includes("Multiplier") ? 1 : 0),
}) as unknown as GameModifiers;

const LEVEL = {
  id: "area-reporting", level: 3, sizeThreshold: 40, expectedCuts: 5, points: 20,
  maxBalls: 2, entities: [], randomShapes: 0,
} as unknown as LevelConfig;

/** A `let` (2x) bonus pocket in the top-right corner of the playable board. */
const LET: ColoredArea = {
  kind: "let", x: 640, y: 45, width: 215, height: 215, required: false,
} as ColoredArea;

const noopCallbacks = new Proxy({}, {
  get: (_t, prop) => (prop === "then" ? undefined : () => {}),
}) as never;

const completedWall = (origin: Vector2, a: Vector2, b: Vector2): GrowingWall => ({
  origin, direction: { x: 0, y: 0 },
  startWaypoints: [origin, a], endWaypoints: [origin, b],
  startSegmentIndex: 0, endSegmentIndex: 0,
  startPoint: a, endPoint: b, targetStart: a, targetEnd: b,
  thickness: 6, isComplete: true, activeRegionId: "",
});

function makeGame(areas: ColoredArea[]): CanvasGameState {
  const data = createInitialGameData(LEVEL, 3, MODS);
  const game = {
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
    lockedBallsCount: 0, lockBonus: 0, superiorLockCount: 0, superiorLockBonus: 0,
    zoneLockCount: 0, zoneLockBonus: 0,
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
  game.coloredAreas = areas.map(a => ({ ...a }));
  game.balls = game.balls.slice(0, 2);
  return game;
}

/** Seal ball A into the top-right corner; `areas` decides whether a zone pays. */
function sealCorner(areas: ColoredArea[]) {
  const game = makeGame(areas);
  const [A, B] = game.balls;
  A.position = { x: 800, y: 100 }; A.velocity = { x: 20, y: 15 }; A.speed = 25;
  B.position = { x: 200, y: 700 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;
  // A diagonal across the corner, well outside the tight-pocket (superior) bar
  // so the zone multiplier is the only thing under test.
  applyCutFn(
    completedWall({ x: 700, y: 200 }, { x: 535, y: 45 }, { x: 855, y: 365 }),
    game, LEVEL, 3, MODS, false, false, 0, noopCallbacks,
  );
  return { game, ball: A };
}

describe("the results screen can see the zone", () => {
  it("credits the lock and counts it", () => {
    const { game, ball } = sealCorner([LET]);
    expect(ball.state).toBe("won");
    expect(game.zoneLockCount).toBe(1);
    expect(game.zoneLockBonus).toBeGreaterThan(0);
  });

  /**
   * The reported symptom. Without a separate figure the multiplier vanishes
   * into lockBonus and the results screen has nothing it could possibly show.
   */
  it("reports exactly the hours the zone added, no more", () => {
    const withZone = sealCorner([LET]);
    const without = sealCorner([]);

    expect(without.game.zoneLockBonus).toBe(0);
    expect(without.game.zoneLockCount).toBe(0);
    expect(withZone.game.zoneLockBonus)
      .toBe(withZone.game.lockBonus - without.game.lockBonus);
  });

  // The row is a breakdown OF lockBonus, not an addition to it. If it were ever
  // summed into the total the map would pay the zone twice.
  it("keeps the zone hours inside lockBonus rather than beside it", () => {
    const { game } = sealCorner([LET]);
    expect(game.zoneLockBonus).toBeLessThan(game.lockBonus);
  });

  it("matches the kind's multiplier", () => {
    const withZone = sealCorner([LET]);
    const without = sealCorner([]);
    const mult = areaStyle("let").multiplier; // 2x
    expect(withZone.game.lockBonus).toBe(Math.round(without.game.lockBonus * mult));
    expect(getLockValue()).toBeGreaterThan(0); // the pay is real, not a zero-times-zero pass
  });

  it("stays silent when the map has no areas at all", () => {
    const { game } = sealCorner([]);
    expect(game.zoneLockBonus).toBe(0);
    expect(game.lockBonus).toBeGreaterThan(0);
  });
});

describe("the lock is legible the moment it happens", () => {
  it("tints the pocket flash with the zone colour", () => {
    const { game, ball } = sealCorner([LET]);
    expect(game.assimilations.get(ball.id)?.zoneColor).toBe(areaStyle("let").color);
  });

  it("leaves the flash untinted when no zone paid", () => {
    const { game, ball } = sealCorner([]);
    expect(game.assimilations.get(ball.id)?.zoneColor).toBeNull();
  });
});

describe("lockDebug can answer 'why did my zone not count?'", () => {
  beforeEach(() => {
    clearLockDecisions();
    setLockDebugEnabled(true);
  });

  it("records which kind was credited and how the three tests went", () => {
    const { ball } = sealCorner([LET]);
    const decision = getLockDecisions().find(d => d.ballId === ball.id);

    expect(decision).toBeTruthy();
    expect(decision!.area).toBeTruthy();
    expect(decision!.area!.creditedKind).toBe("let");
    expect(decision!.area!.bestCoverFraction).toBeGreaterThan(0);
  });

  /**
   * The number that settles a bug report: a near miss reads as a coverage
   * fraction just under the bar, a bad cut reads as near zero.
   */
  it("records a coverage fraction even when nothing was credited", () => {
    const faraway: ColoredArea = { ...LET, x: 60, y: 640 } as ColoredArea;
    const { ball } = sealCorner([faraway]);
    const decision = getLockDecisions().find(d => d.ballId === ball.id);

    expect(decision!.area).toBeTruthy();
    expect(decision!.area!.creditedKind).toBeNull();
    expect(decision!.area!.bestCoverFraction).toBe(0);
  });

  it("records null for a map with no areas, rather than a fake verdict", () => {
    const { ball } = sealCorner([]);
    const decision = getLockDecisions().find(d => d.ballId === ball.id);
    expect(decision!.area).toBeNull();
  });
});
