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
import { zonePulse, dormantColor, FLARE_MS, BREATH_MS } from "@/lib/rendering/sleek/areaLayer";
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
  /**
   * The renderer's pulse is time-driven, so it needs to know WHEN the zone
   * fired. A `satisfied` boolean alone can only produce a static bright state,
   * which is what the player reported being unable to read.
   */
  it("stamps when the zone was activated, not just that it was", () => {
    const before = performance.now();
    const { game } = sealCorner([LET]);
    const area = game.coloredAreas!.find(a => a.kind === "let")!;

    expect(area.satisfied).toBe(true);
    expect(area.satisfiedAt).toBeGreaterThanOrEqual(before);
    expect(area.satisfiedAt).toBeLessThanOrEqual(performance.now());
  });

  it("leaves an untouched zone unstamped", () => {
    const faraway: ColoredArea = { ...LET, x: 60, y: 640 } as ColoredArea;
    const { game } = sealCorner([faraway]);
    const area = game.coloredAreas![0];
    expect(area.satisfied).toBeFalsy();
    expect(area.satisfiedAt).toBeUndefined();
  });

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

/**
 * The pulse curve. Reported twice from play ("I still can't tell if the colored
 * area is activated"), so the claims it has to make good on are pinned here:
 * it must be unmissable at the moment of the lock, and still readable long
 * after, which is a property of these curves and not of the Pixi calls.
 */
describe("the activation pulse", () => {
  it("peaks at the instant the zone fires", () => {
    const at0 = zonePulse(0);
    expect(at0.flare).toBe(1);
    expect(at0.fillAlpha).toBeGreaterThan(zonePulse(FLARE_MS).fillAlpha);
  });

  it("drains the flare away, monotonically", () => {
    const samples = [0, 200, 400, 700, 1000, FLARE_MS].map(t => zonePulse(t).flare);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThan(samples[i - 1]);
    }
    expect(zonePulse(FLARE_MS).flare).toBe(0);
    expect(zonePulse(FLARE_MS * 5).flare).toBe(0); // never goes negative
  });

  it("expands the ring outward as the flare drains", () => {
    expect(zonePulse(0).grow).toBe(0);
    expect(zonePulse(FLARE_MS / 2).grow).toBeGreaterThan(0);
    expect(zonePulse(FLARE_MS).grow).toBeGreaterThan(zonePulse(FLARE_MS / 2).grow);
  });

  /** The half that answers "did that count?" a minute later. */
  it("keeps breathing forever, and never goes dark", () => {
    for (const t of [2000, 10_000, 60_000, 600_000]) {
      const p = zonePulse(t);
      expect(p.fillAlpha).toBeGreaterThan(0.05);
      expect(p.strokeAlpha).toBeGreaterThan(0.3);
    }
  });

  it("actually oscillates rather than sitting at a constant", () => {
    const overOneCycle = Array.from({ length: 12 }, (_, i) => zonePulse(5000 + i * (BREATH_MS / 12)).strokeAlpha);
    const spread = Math.max(...overOneCycle) - Math.min(...overOneCycle);
    expect(spread).toBeGreaterThan(0.3); // a visible swing, not a shimmer
  });

  it("is brighter during the flare than at any point in the steady breath", () => {
    const peakIdle = Math.max(
      ...Array.from({ length: 40 }, (_, i) => zonePulse(5000 + i * 50).fillAlpha),
    );
    expect(zonePulse(0).fillAlpha).toBeGreaterThan(peakIdle);
  });

  it("treats a negative age as the moment of activation", () => {
    expect(zonePulse(-50).flare).toBe(1); // clock skew must not blank the pulse
  });
});

/**
 * Dormant vs live appearance. Reported three times running ("still can't tell",
 * "not different enough"), each time after a change that made the LIVE state
 * louder. The lesson encoded here is that loudness alone does not work: a
 * player looking at one zone has nothing to compare it against, so the dormant
 * state has to be visibly impoverished in its own right.
 */
describe("a dormant zone reads as dormant", () => {
  const KINDS = ["var", "let", "const"] as const;
  const packed = (kind: typeof KINDS[number]) =>
    Number.parseInt(areaStyle(kind).color.replace("#", ""), 16);
  /** Chroma, the thing "bleak" actually refers to. */
  const saturation = (c: number) => {
    const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx === 0 ? 0 : (mx - mn) / mx;
  };

  it("drains the colour out of every kind, not just darkens it", () => {
    for (const kind of KINDS) {
      const live = packed(kind);
      const dormant = dormantColor(live, false);
      expect(saturation(dormant)).toBeLessThan(saturation(live) * 0.75);
    }
  });

  it("keeps a dormant gate more legible than a dormant bonus pocket", () => {
    // A gate is a required win condition: it must stay readable while unused.
    for (const kind of KINDS) {
      const live = packed(kind);
      expect(saturation(dormantColor(live, true)))
        .toBeGreaterThan(saturation(dormantColor(live, false)));
    }
  });

  it("never drains a zone all the way to grey, so the kind is still identifiable", () => {
    for (const kind of KINDS) {
      expect(saturation(dormantColor(packed(kind), false))).toBeGreaterThan(0.05);
    }
  });

  it("leaves a live zone at full chroma", () => {
    for (const kind of KINDS) {
      const live = packed(kind);
      expect(dormantColor(live, false)).not.toBe(live);
    }
  });
});
