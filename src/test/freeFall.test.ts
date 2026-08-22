/**
 * Free Fall: locking a ball UNDER GRAVITY pays a multiplied lock bonus.
 *
 * The design decision worth recording is what "under gravity" means. Keyed on
 * gravity wells alone, the family would be dead on most of a run: wells are
 * authored onto a handful of maps, and an upgrade that does nothing on nine
 * maps in ten is exactly the trap pick the archetype rework exists to remove.
 * Counting the shifting-gravity mutator as well makes "the gravity build"
 * something a run can commit to, and gives the mutator a build to belong to.
 *
 * The base game pays nothing extra for a well lock. Wells stay neutral terrain
 * for a player who has not bought in, so this changes no existing map's economy;
 * the upgrade is what turns a well into a payday.
 *
 * These run against the real cut/lock pipeline rather than a stubbed scorer,
 * because every interesting failure here is a wiring failure: a multiplier that
 * is computed correctly and then not applied, or applied to the wrong total,
 * looks perfect in a unit test of the arithmetic.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playBallLockSound: () => {}, playWallHitSound: () => {}, playBallCollideSound: () => {},
  playFenceBreakSound: () => {}, playDeathSound: () => {}, playCutClaimedSound: () => {},
  playLevelCompleteSound: () => {}, playBossChargeSound: () => {}, playPickupClaimedSound: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
}));

import { createInitialGameData } from "@/lib/initGame";
import { applyCutFn } from "@/lib/physics/applyCut";
import { DEFAULT_MODIFIERS, type GameModifiers } from "@/hooks/useActiveModifiers";
import { getLockValue, getLockQuality } from "@/lib/scoring";
import { wellStep } from "@/lib/physics/gravityWells";
import { gravityStep, DEFAULT_GRAVITY } from "@/lib/physics/gravity";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";
import type { GrowingWall, Vector2 } from "@/types/game";
import type { GravityWell, LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const LEVEL: LevelConfig = {
  id: "free-fall", level: 12, sizeThreshold: 40, expectedCuts: 5, points: 40,
  // randomShapes: 0 keeps the pocket deterministic; a random obstacle landing
  // inside it skews the cell count and the lock grade with it.
  maxBalls: 2, entities: [], randomShapes: 0,
} as unknown as LevelConfig;

/** A well over the top-right corner, where the pocket below is sealed. */
const CORNER_WELL: GravityWell = { x: 690, y: 30, width: 200, height: 190 };

const mods = (over: Partial<GameModifiers> = {}): GameModifiers =>
  ({ ...DEFAULT_MODIFIERS, ...over });

function makeGame(over: Partial<CanvasGameState> = {}): CanvasGameState {
  const data = createInitialGameData(LEVEL, 12, DEFAULT_MODIFIERS);
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
    lockedBallsCount: 0, lockBonus: 0, superiorLockCount: 0, superiorLockBonus: 0,
    zoneLockBonus: 0, zoneLockCount: 0,
    moneyMultiplier: 1, ballSpeedScale: 1,
    assimilations: new Map(), dissolve: null, bonusCutCells: new Set(),
    lockWinThresholdPercent: BALL_WON_REGION_THRESHOLD,
    lockBaseThresholdPercent: BALL_WON_REGION_THRESHOLD,
    lockMinRegionCells: 0,
    fenceDurability: null, pendingWallBreaks: [], destructibles: data.destructibles,
    pendingDestroys: [], objectDebris: [], stackObjects: data.stackObjects,
    fallingObjects: [], objectivesTotal: data.objectivesTotal, objectivesBroken: 0,
    breakBonus: 0, lastDudAt: 0,
    coloredAreas: [], gravityWells: undefined, mapMutator: null, gravityConfig: null,
    ...over,
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
 * Seal the top-right corner with ball A inside it and return what the lock paid.
 * The pocket is the same one superiorLock.test.ts uses, so it is known to lock.
 */
function lockInCorner(over: Partial<CanvasGameState>, m: GameModifiers) {
  const game = makeGame(over);
  game.balls = game.balls.slice(0, 2);
  const [A, B] = game.balls;
  A.position = { x: 800, y: 100 }; A.velocity = { x: 80, y: 60 }; A.speed = 100;
  B.position = { x: 300, y: 600 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;

  applyCutFn(
    completedWall({ x: 780, y: 120 }, { x: 705, y: 45 }, { x: 855, y: 195 }),
    game, LEVEL, 12, m, false, false, 0, noopCallbacks,
  );
  expect(A.state, "the probe must actually lock, or it measures nothing").toBe("won");
  return { game, ball: A, pay: game.lockBonus };
}

/**
 * What THAT lock would have paid with no gravity bonus: the baseline, priced
 * from the ball that actually locked.
 *
 * Deliberately not "build a second game and read its first ball". That version
 * passed alone and failed in the full suite, because a seeded run RNG is
 * stateful: once another test sets a run seed, a second createInitialGameData
 * draws a DIFFERENT ball roster, so the baseline was pricing a ball with a
 * different lockMultiplier than the one under test. Pricing the ball in hand
 * removes the ordering dependency entirely rather than papering over it.
 */
function plainPayFor(ball: { lockMultiplier?: number }): number {
  const { superiorMultiplier } = getLockQuality();
  return Math.round((ball.lockMultiplier ?? 1) * getLockValue() * superiorMultiplier);
}

describe("the base game is unchanged", () => {
  it("pays a well lock exactly what it pays any other lock", () => {
    const withWell = lockInCorner({ gravityWells: [CORNER_WELL] }, mods());
    expect(withWell.pay).toBe(plainPayFor(withWell.ball));
    const without = lockInCorner({}, mods());
    expect(without.pay).toBe(plainPayFor(without.ball));
  });

  it("pays nothing extra on a gravity map either, without the upgrade", () => {
    const r = lockInCorner(
      { mapMutator: { behavior: "gravity" } as never, gravityConfig: DEFAULT_GRAVITY },
      mods(),
    );
    expect(r.pay).toBe(plainPayFor(r.ball));
  });
});

describe("with Free Fall owned", () => {
  it("doubles a lock inside a well", () => {
    const r = lockInCorner({ gravityWells: [CORNER_WELL] }, mods({ gravityLockBonus: 1 }));
    expect(r.pay).toBe(plainPayFor(r.ball) * 2);
  });

  it("triples it at the next tier", () => {
    const r = lockInCorner({ gravityWells: [CORNER_WELL] }, mods({ gravityLockBonus: 2 }));
    expect(r.pay).toBe(plainPayFor(r.ball) * 3);
  });

  it("doubles a lock anywhere on a gravity map, with no well in sight", () => {
    const r = lockInCorner(
      { mapMutator: { behavior: "gravity" } as never, gravityConfig: DEFAULT_GRAVITY },
      mods({ gravityLockBonus: 1 }),
    );
    expect(r.pay).toBe(plainPayFor(r.ball) * 2);
  });

  /**
   * The case that decides whether the family is a trap. If it only ever paid
   * inside a well it would be dead on most maps of a run, so this is the
   * property, not an edge case.
   */
  it("pays nothing on an ordinary map with neither", () => {
    const r = lockInCorner({}, mods({ gravityLockBonus: 1 }));
    expect(r.pay).toBe(plainPayFor(r.ball));
  });

  it("pays nothing for a lock OUTSIDE the well on a well map", () => {
    // The well is parked far from the corner pocket, so the ball locks clear of it.
    const r = lockInCorner(
      { gravityWells: [{ x: 100, y: 500, width: 150, height: 150 }] },
      mods({ gravityLockBonus: 1 }),
    );
    expect(r.pay).toBe(plainPayFor(r.ball));
  });

  /**
   * A mutator that is not the gravity one must not pay. Reading the mutator's
   * mere presence rather than its behaviour would quietly turn Free Fall into
   * "locks pay double on any mutated map", which is a different and much
   * stronger upgrade than the one on the card.
   */
  it("pays nothing under a non-gravity mutator", () => {
    const r = lockInCorner(
      { mapMutator: { behavior: "conveyor" } as never, gravityConfig: DEFAULT_GRAVITY },
      mods({ gravityLockBonus: 1 }),
    );
    expect(r.pay).toBe(plainPayFor(r.ball));
  });

  it("pays nothing when the map declares gravity but has no config", () => {
    const r = lockInCorner(
      { mapMutator: { behavior: "gravity" } as never, gravityConfig: null },
      mods({ gravityLockBonus: 1 }),
    );
    expect(r.pay).toBe(plainPayFor(r.ball));
  });
});

describe("a dormant well is not a risk, so it is not a payday", () => {
  const SLEEPER: GravityWell = { ...CORNER_WELL, activeFrom: 40 };

  it("pays nothing while the well is still asleep", () => {
    const r = lockInCorner(
      { gravityWells: [SLEEPER], spaceRemainingPercent: 90 },
      mods({ gravityLockBonus: 1 }),
    );
    expect(r.pay).toBe(plainPayFor(r.ball));
  });

  it("pays once it has woken", () => {
    const r = lockInCorner(
      { gravityWells: [SLEEPER], spaceRemainingPercent: 30 },
      mods({ gravityLockBonus: 1 }),
    );
    expect(r.pay).toBe(plainPayFor(r.ball) * 2);
  });
});

/**
 * Escape Velocity, the other half of the Principal fork: gravity bends your
 * balls less. Two-sided on purpose, which is what makes it a choice rather than
 * a downgrade - a softer pull is easier to survive and worse to aim with, and a
 * well is a tool as much as a hazard.
 */
describe("Escape Velocity softens the bend", () => {
  const V: Vector2 = { x: 200, y: 0 };
  const P: Vector2 = { x: 400, y: 400 };
  const WELL: GravityWell = { x: 300, y: 300, width: 200, height: 200, turnRate: 2.8 };
  const bendOf = (v: Vector2) => Math.atan2(v.y, v.x);

  it("turns a well's pull down proportionally", () => {
    const full = wellStep(P, V, [WELL], 1 / 60, undefined, 1)!;
    const soft = wellStep(P, V, [WELL], 1 / 60, undefined, 0.67)!;
    expect(bendOf(soft)).toBeGreaterThan(0);
    expect(bendOf(soft)).toBeCloseTo(bendOf(full) * 0.67, 6);
  });

  it("turns a gravity map's pull down the same way", () => {
    const cfg = { ...DEFAULT_GRAVITY, sequence: ["down" as const] };
    const full = gravityStep(V, 0, cfg, 1 / 60, 1)!;
    const soft = gravityStep(V, 0, cfg, 1 / 60, 0.67)!;
    expect(bendOf(soft)).toBeCloseTo(bendOf(full) * 0.67, 6);
  });

  it("never touches speed, which every rescaler downstream depends on", () => {
    for (const k of [0.2, 0.67, 1, 2]) {
      const out = wellStep(P, V, [WELL], 1 / 60, undefined, k)!;
      expect(Math.hypot(out.x, out.y), `bend ${k}`).toBeCloseTo(200, 6);
    }
  });

  /**
   * A zero or negative multiplier would stall the steer or invert the pull, and
   * a well that quietly pushes AWAY is far worse than one that does nothing.
   * Neither is reachable from the shop, but both are one bad YAML edit away.
   */
  it("refuses a nonsense multiplier rather than inverting the pull", () => {
    for (const bad of [0, -1, Number.NaN]) {
      const out = wellStep(P, V, [WELL], 1 / 60, undefined, bad);
      if (out) {
        expect(bendOf(out), `bend ${bad}`).toBeGreaterThanOrEqual(0);
        expect(Math.hypot(out.x, out.y), `bend ${bad}`).toBeCloseTo(200, 6);
      }
      const g = gravityStep(V, 0, { ...DEFAULT_GRAVITY, sequence: ["down"] }, 1 / 60, bad);
      if (g) expect(bendOf(g), `gravity bend ${bad}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("leaves the bend alone when nobody has bought it", () => {
    expect(DEFAULT_MODIFIERS.gravityBendMultiplier).toBe(1);
    const full = wellStep(P, V, [WELL], 1 / 60, undefined, 1)!;
    const dflt = wellStep(P, V, [WELL], 1 / 60, undefined, DEFAULT_MODIFIERS.gravityBendMultiplier)!;
    expect(bendOf(dflt)).toBeCloseTo(bendOf(full), 9);
  });
});
