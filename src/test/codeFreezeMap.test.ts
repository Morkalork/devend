/**
 * "Code Freeze" (level-33): the STACKED greed hook.
 *
 * Lived at level 22 until the feature schedule gave act III that slot for the
 * gravity Slingshot. The map moved wholesale and its geometry is unchanged:
 * the two pockets are sized against the denominator swing described below,
 * not against the level number, so relocating it moves nothing that matters.
 *
 * The economy has two lock multipliers that MULTIPLY each other, and no map had
 * ever set up both at once:
 *   - the Colored Area kind      const = 3x   (checkBallWonState: zoneMult)
 *   - lock quality               superior = 2x (pocket <= 40% of base threshold)
 * so 6x existed in the code and was unreachable in play. This map is authored
 * around that stack, with a middle rung (3x, not superior) between skipping the
 * hook and taking it.
 *
 * What makes the rungs worth a test is that a lock GRADE is not a property of
 * the geometry alone: it is cells/denominator, and the denominator is
 * `max(active cells, initial / active balls)`, which swings ~2x over a map. A
 * pocket sized by eye therefore grades superior or not depending on WHEN you
 * seal it, which is exactly the trap that would collapse the two rungs into one
 * (or make them a coin flip). The geometry block below pins that both pockets
 * sit OUTSIDE that swing, so the map plays the same at second 5 and second 50.
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { createInitialGameData } from "@/lib/initGame";
import { applyCutFn } from "@/lib/physics/applyCut";
import {
  createSpaceGrid, rasterizeCutToGrid, findGridRegions, findRegionForPosition,
} from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";
import { getLockValue, getLockQuality } from "@/lib/scoring";
import { areaStyle, regionWithinAreas } from "@/lib/coloredAreas";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { CanvasGameState } from "@/types/gameState";
import type { GrowingWall, Vector2 } from "@/types/game";
import type { LevelConfig, LevelData, WallRectEntity } from "@/types/level";

const MODS = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1, shopDiscountMultiplier: 1, pushBonusMultiplier: 1,
  instantFencesPerMap: 0, additionalConcurrentFences: 0, extraLives: 0, extraShopItems: 0, shopRestockCount: 0, extraAbilityOffers: 0, freeAbilityPerStore: 0,
  extraContinues: 0, extraCertificateHours: 0, startingCapturePercent: 0,
  fenceDurabilityBonus: 0, microManagerPerLock: 0, ballPathPredictionBounces: 0,
  ballPathPredictionBalls: 0, disablePushYourLuck: 0, ballFreezeDuration: 0,
  freezeUsesPerMap: 0, slowOneBallFactor: 0, freezePickups: 0, ballFreezeCount: 0,
  autoFreezeDuration: 0, showHighscoreProgress: 0, overtimePerLock: 0,
  overtimePerSuperiorLock: 0, fenceSpeedPerLock: 0, frozenLockBonus: 0, gravityLockBonus: 0, gravityBendMultiplier: 1,
  simultaneousLockBonus: 0, freezeNoCooldown: 0, fenceSpeedPerFence: 0,
  fenceSpeedPerMapCleared: 0, underParInstantFence: 0, bankedSlowPer50h: 0,
  spaceBonusMultiplier: 1, overtimeCapBonus: 0, freeCheapestOffer: 0,
  wallShieldsPerMap: 0, fenceGraceMs: 0, shipEarlySecondsPerBall: 0,
  scopeCreepImmediate: 0, shipEarlyBonusMultiplier: 1, runwayInstantFenceAt: 0,
  runwayConcurrentFenceAt: 0, runwayFreezeAt: 0, spendInstantFencePerChunk: 0,
  spendFenceSpeedPerChunk: 0, spendCapturePerChunk: 0, spendChunkCapBonus: 0,
  lockThresholdBonus: 0, spawnFreezeSeconds: 0, pickupChanceBonus: 0, pickupPayoutLevel: 0,
} as unknown as GameModifiers;

const MAP = yaml.load(
  readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
) as LevelData;
const LEVEL = MAP.levels.find(l => l.id === "level-33") as LevelConfig;

if (!LEVEL) throw new Error("level-33 (Code Freeze) is missing from map.yml");

/**
 * Rotation is picked from the run seed for level >= 4, which would move every
 * coordinate below. It is covered by mapRotation's own tests and is a rigid
 * transform, so it cannot change a cell COUNT: init the map at level 2 to hold
 * the standard orientation and test the geometry that rotation preserves.
 */
const AS_LEVEL = 2;

/** The two authored seals, as the player would draw them. */
const ALCOVE_CUT = { a: { x: 625, y: 180 }, b: { x: 695, y: 250 } };  // the 85-long diagonal doorway
const NOOK_CUT = { a: { x: 745, y: 40 }, b: { x: 745, y: 135 } };     // the 85-long fence onto the shelf

/** A point deep inside each pocket, used to identify the sealed region. */
const IN_ALCOVE: Vector2 = { x: 690, y: 90 };
const IN_NOOK: Vector2 = { x: 800, y: 85 };

/** superior = pocket at most 40% of the BASE lock threshold (4% of denominator). */
const SUPERIOR_PCT = BALL_WON_REGION_THRESHOLD * getLockQuality().superiorThresholdFraction;

describe("the map is authored the way the design says", () => {
  it("carries exactly one hook: a single const BONUS area", () => {
    const areas = LEVEL.coloredAreas ?? [];
    expect(areas).toHaveLength(1);
    expect(areas[0].kind).toBe("const");
    // Bonus, not gate: skipping the hook must never fail the map.
    expect(areas[0].required).toBe(false);
    expect(areaStyle(areas[0].kind).multiplier).toBe(3);
  });

  it("suppresses random obstacles, which would resize the nook", () => {
    expect(LEVEL.randomShapes).toBe(0);
  });

  it("leaves a doorway and a nook mouth a ball can actually pass", () => {
    const rect = (id: string) => LEVEL.entities!.find(e => e.id === id) as WallRectEntity;
    const lipV = rect("alcove-lip-v");
    const lipH = rect("alcove-lip-h");
    const shelf = rect("nook-shelf");
    const BALL_DIAMETER = 36;

    // The corner gap between the two lip ends, closed by one diagonal fence.
    const gapW = lipH.x - (lipV.x + lipV.width);
    const gapH = lipH.y - (lipV.y + lipV.height);
    expect(gapW).toBeGreaterThan(BALL_DIAMETER);
    expect(gapH).toBeGreaterThan(BALL_DIAMETER);
    expect(Math.hypot(gapW, gapH)).toBeCloseTo(85, 0);

    // The nook's mouth: from the top board edge down to the shelf.
    expect(shelf.y - 45).toBeGreaterThan(BALL_DIAMETER);
  });
});

/**
 * The load-bearing block. Both pockets must grade the SAME way no matter when
 * they are sealed, so each is checked against the WORST denominator for it:
 * the alcove against the largest the map can ever produce, the nook against the
 * smallest.
 */
describe("both rungs survive the denominator swing", () => {
  const data = createInitialGameData(LEVEL, AS_LEVEL, MODS);

  /** The pocket that `cut` seals off around `inside`, on a fresh board. */
  const pocket = (cut: { a: Vector2; b: Vector2 }, inside: Vector2) => {
    const grid = createSpaceGrid(
      createRectPolygon(
        data.boardPolygon.vertices[0].x, data.boardPolygon.vertices[0].y,
        data.boardPolygon.vertices[2].x, data.boardPolygon.vertices[2].y,
      ),
      data.obstaclePolygons,
      15,
    );
    rasterizeCutToGrid(grid, cut.a, cut.b, 6);
    const region = findRegionForPosition(grid, findGridRegions(grid), inside);
    expect(region).not.toBeNull();
    return { grid, cells: region!.cellIndices };
  };

  const pocketCells = (cut: { a: Vector2; b: Vector2 }, inside: Vector2): number =>
    pocket(cut, inside).cells.length;

  // denominator = max(active cells, initial / active balls). It is largest on an
  // untouched board and smallest once the board is nearly captured.
  const maxDenominator = data.spaceGrid.initialActiveCount;
  const minDenominator = Math.floor(data.spaceGrid.initialActiveCount / (LEVEL.maxBalls ?? 2));

  it("the alcove can never grade superior, however early you seal it", () => {
    const cells = pocketCells(ALCOVE_CUT, IN_ALCOVE);
    // Worst case for "not superior" is the LARGEST denominator, i.e. an
    // untouched board: if it is over the bar there, it is over it everywhere.
    expect((cells / maxDenominator) * 100).toBeGreaterThan(SUPERIOR_PCT);
  });

  it("the nook always grades superior, however late you seal it", () => {
    const cells = pocketCells(NOOK_CUT, IN_NOOK);
    // Worst case for "superior" is the SMALLEST denominator, i.e. a nearly
    // captured board with every ball still live.
    expect((cells / minDenominator) * 100).toBeLessThanOrEqual(SUPERIOR_PCT);
  });

  it("the alcove is the roomier pocket, so the rungs are ordered", () => {
    expect(pocketCells(ALCOVE_CUT, IN_ALCOVE))
      .toBeGreaterThan(pocketCells(NOOK_CUT, IN_NOOK) * 2);
  });

  /**
   * Rung 2 has to stay available for the WHOLE map, and late on it is over the
   * 10% lock threshold, so it stops locking by percentage and survives only on
   * the area-containment rule ("sealed inside an area is a lock"). That rule
   * needs EVERY alcove cell inside the box, which is why the const area is
   * drawn to cover the alcove rather than sized like a normal const marker.
   */
  it("the const box covers the whole alcove, which is what keeps rung 2 alive late", () => {
    const { grid, cells } = pocket(ALCOVE_CUT, IN_ALCOVE);
    // First: confirm the containment rule is genuinely load-bearing, i.e. that
    // late in a map the percentage gate really does reject this pocket.
    expect((cells.length / minDenominator) * 100).toBeGreaterThan(BALL_WON_REGION_THRESHOLD);
    // Then: the rule holds.
    expect(regionWithinAreas(grid, cells, LEVEL.coloredAreas!)).toBe(true);
  });
});

describe("what each rung actually pays", () => {
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

  function makeGame(): CanvasGameState {
    const data = createInitialGameData(LEVEL, AS_LEVEL, MODS);
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
    // GameCanvas installs the (rotated) areas on the game; initGame does not.
    game.coloredAreas = (LEVEL.coloredAreas ?? []).map(a => ({ ...a }));
    game.balls = game.balls.slice(0, 2);
    return game;
  }

  /** Seal `ball` into a pocket with `cut` and report what the map paid. */
  const seal = (
    game: CanvasGameState, at: Vector2, cut: { a: Vector2; b: Vector2 },
  ) => {
    const [A, B] = game.balls;
    A.position = { ...at }; A.velocity = { x: 30, y: 25 }; A.speed = 40;
    // Parked far away in the lower chamber so it neither locks nor joins the pass.
    B.position = { x: 200, y: 750 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;
    applyCutFn(
      completedWall({ x: (cut.a.x + cut.b.x) / 2, y: (cut.a.y + cut.b.y) / 2 }, cut.a, cut.b),
      game, LEVEL, AS_LEVEL, MODS, false, false, 0, noopCallbacks,
    );
    return { ball: A, superior: !!game.assimilations.get(A.id)?.superior, paid: game.lockBonus };
  };

  const lockValue = getLockValue();
  const { superiorMultiplier } = getLockQuality();

  it("rung 2, the alcove: the const multiplier, but NOT the quality one", () => {
    const game = makeGame();
    const { ball, superior, paid } = seal(game, IN_ALCOVE, ALCOVE_CUT);

    expect(ball.state).toBe("won");
    expect(superior).toBe(false);
    expect(game.superiorLockBonus).toBe(0);
    // 3x for landing in the const box, and nothing for quality.
    expect(paid).toBe(Math.round((ball.lockMultiplier ?? 1) * 3 * lockValue));
  });

  it("rung 3, the nook: both multipliers, which is the point of the map", () => {
    const game = makeGame();
    const { ball, superior, paid } = seal(game, IN_NOOK, NOOK_CUT);

    expect(ball.state).toBe("won");
    expect(superior).toBe(true);
    // 3x (const) AND 2x (superior), multiplied - the payout the roster never reached.
    expect(paid).toBe(Math.round((ball.lockMultiplier ?? 1) * 3 * lockValue * superiorMultiplier));
    expect(game.superiorLockBonus).toBe(paid);
  });

  it("the greedy rung is worth exactly double the safe one", () => {
    const loose = seal(makeGame(), IN_ALCOVE, ALCOVE_CUT);
    const tight = seal(makeGame(), IN_NOOK, NOOK_CUT);
    expect(tight.paid).toBe(loose.paid * 2);
  });

  /**
   * The reason the map is interesting rather than merely generous: the same
   * ball, sealed the same way but anywhere else on the board, pays a sixth.
   */
  it("stacks to 6x what an ordinary sloppy lock pays", () => {
    const game = makeGame();
    const plain = makeGame();
    // A roomy pocket in the lower-left chamber: no area, no quality bonus.
    const p = seal(plain, { x: 150, y: 750 }, { a: { x: 45, y: 640 }, b: { x: 330, y: 855 } });
    const t = seal(game, IN_NOOK, NOOK_CUT);

    expect(p.ball.state).toBe("won");
    expect(p.superior).toBe(false);
    expect(p.paid).toBe(Math.round((p.ball.lockMultiplier ?? 1) * lockValue));
    expect(t.paid).toBe(p.paid * 6);
  });
});
