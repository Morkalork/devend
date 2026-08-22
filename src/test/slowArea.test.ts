/**
 * Slow Areas: a placed patch of board where balls crawl for the rest of the map.
 *
 * The load-bearing decision is that this scales DISPLACEMENT, not velocity.
 * updateBall rewrites velocity to absolute magnitudes from three places every
 * frame (the minimum-speed floor, grey's wind-down, yellow's variable speed), so
 * a halved velocity would be erased within a frame; and the floor exists
 * precisely to stop a ball moving this slowly, so the two would fight outright.
 *
 * That makes "the ball is slower but its velocity is untouched" the property to
 * pin, because every plausible wrong implementation gets it backwards.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playBallLockSound: () => {}, playWallHitSound: () => {}, playBallCollideSound: () => {},
  playFenceBreakSound: () => {}, playDeathSound: () => {}, playCutClaimedSound: () => {},
  playLevelCompleteSound: () => {}, playBossChargeSound: () => {}, playPickupClaimedSound: () => {},
  playBossJumpSound: () => {}, playBossLandSound: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
}));

import {
  slowFactorAt, placeSlowArea, pointInSlowArea,
  DEFAULT_SLOW_AREA_FACTOR, DEFAULT_SLOW_AREA_SIZE,
} from "@/lib/physics/slowAreas";
import { createInitialGameData } from "@/lib/initGame";
import { updateBall } from "@/lib/physics/updateBall";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { BOARD_WIDTH } from "@/lib/boardConstants";
import type { SlowArea } from "@/types/game";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const AREA: SlowArea = { x: 300, y: 300, width: 240, height: 240, factor: 0.5 };

describe("what counts as inside", () => {
  it("contains its middle and its edges", () => {
    expect(pointInSlowArea(420, 420, AREA)).toBe(true);
    expect(pointInSlowArea(300, 300, AREA)).toBe(true);
    expect(pointInSlowArea(540, 540, AREA)).toBe(true);
  });

  it("excludes everything outside, on every side", () => {
    expect(pointInSlowArea(299, 420, AREA)).toBe(false);
    expect(pointInSlowArea(541, 420, AREA)).toBe(false);
    expect(pointInSlowArea(420, 299, AREA)).toBe(false);
    expect(pointInSlowArea(420, 541, AREA)).toBe(false);
  });
});

describe("the factor a ball feels", () => {
  it("is 1 outside every area, so the common case costs nothing", () => {
    expect(slowFactorAt(100, 100, [AREA])).toBe(1);
    expect(slowFactorAt(420, 420, [])).toBe(1);
    expect(slowFactorAt(420, 420, undefined)).toBe(1);
  });

  it("is the area's factor inside it", () => {
    expect(slowFactorAt(420, 420, [AREA])).toBeCloseTo(0.5, 9);
  });

  /**
   * The decision that keeps this from being a free lock: overlapping areas take
   * the STRONGEST, not the product. Two halvings would multiply to a quarter and
   * three to an eighth, which is a ball that has effectively stopped, and a
   * player would stack every charge on one pocket precisely because it works.
   */
  it("takes the strongest area, never the product, where they overlap", () => {
    const softer: SlowArea = { ...AREA, factor: 0.8 };
    expect(slowFactorAt(420, 420, [AREA, softer])).toBeCloseTo(0.5, 9);
    expect(slowFactorAt(420, 420, [softer, AREA])).toBeCloseTo(0.5, 9);
    // Explicitly NOT 0.5 * 0.8.
    expect(slowFactorAt(420, 420, [AREA, softer])).not.toBeCloseTo(0.4, 6);
  });

  it("stacks three areas no further than the strongest one", () => {
    const all = [AREA, { ...AREA, factor: 0.6 }, { ...AREA, factor: 0.7 }];
    expect(slowFactorAt(420, 420, all)).toBeCloseTo(0.5, 9);
  });

  it("falls back to the default for a nonsense factor", () => {
    for (const bad of [0, -1, Number.NaN]) {
      const f = slowFactorAt(420, 420, [{ ...AREA, factor: bad as number }]);
      expect(f, `factor ${bad}`).toBeCloseTo(DEFAULT_SLOW_AREA_FACTOR, 9);
    }
  });
});

describe("placing one", () => {
  it("centres it on the tap", () => {
    const a = placeSlowArea(450, 450, BOARD_WIDTH);
    expect(a.x + a.width / 2).toBeCloseTo(450, 6);
    expect(a.y + a.height / 2).toBeCloseTo(450, 6);
    expect(a.width).toBe(DEFAULT_SLOW_AREA_SIZE);
  });

  /**
   * Clamped rather than allowed to hang off the board: a player tapping a corner
   * wants a slow pocket in that corner, and half of one is a worse version of
   * what they paid a charge for.
   */
  it("slides a corner tap fully onto the board, at full size", () => {
    for (const [x, y] of [[0, 0], [900, 900], [10, 880], [880, 10]]) {
      const a = placeSlowArea(x, y, BOARD_WIDTH);
      expect(a.x, `tap ${x},${y}`).toBeGreaterThanOrEqual(0);
      expect(a.y, `tap ${x},${y}`).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width, `tap ${x},${y}`).toBeLessThanOrEqual(BOARD_WIDTH);
      expect(a.y + a.height, `tap ${x},${y}`).toBeLessThanOrEqual(BOARD_WIDTH);
      expect(a.width, "clamping must not shrink it").toBe(DEFAULT_SLOW_AREA_SIZE);
    }
  });

  it("degrades an absurd size to the whole board rather than inside out", () => {
    const a = placeSlowArea(450, 450, BOARD_WIDTH, 5000);
    expect(a.width).toBe(BOARD_WIDTH);
    expect(a.x).toBe(0);
    expect(a.x + a.width).toBe(BOARD_WIDTH);
  });

  it("keeps an authored factor and clamps a silly one", () => {
    expect(placeSlowArea(450, 450, BOARD_WIDTH, 200, 0.25).factor).toBeCloseTo(0.25, 9);
    expect(placeSlowArea(450, 450, BOARD_WIDTH, 200, 4).factor).toBe(1);
    expect(placeSlowArea(450, 450, BOARD_WIDTH, 200, -1).factor)
      .toBeCloseTo(DEFAULT_SLOW_AREA_FACTOR, 9);
  });
});

// ── Through the real physics ────────────────────────────────────────────────

describe("a ball crossing a real slow area", () => {
  const LEVEL = {
    id: "slow-probe", level: 12, sizeThreshold: 40, expectedCuts: 6, points: 20,
    maxBalls: 1, variety: 0, randomShapes: 0, entities: [],
  } as unknown as LevelConfig;

  function probe(areas: SlowArea[]): { game: CanvasGameState; ball: CanvasGameState["balls"][0] } {
    const data = createInitialGameData(LEVEL, 12, DEFAULT_MODIFIERS);
    const ball = data.balls[0];
    ball.position = { x: 100, y: 420 };
    const speed = Math.hypot(ball.velocity.x, ball.velocity.y) || ball.baseSpeed;
    ball.velocity = { x: speed, y: 0 };                 // flying flat, rightward
    const game = {
      ...data, balls: [ball], walls: data.walls, activeWalls: [],
      movers: data.movers ?? [], objectDebris: [], destructibles: [], pendingDestroys: [],
      obstaclePolygons: data.obstaclePolygons ?? [], mirrorPolygons: data.mirrorPolygons ?? [],
      pickups: [], pickupFeedback: [], regions: data.regions ?? [], chestLoot: [],
      coloredAreas: [], activePlaySeconds: 0, creepFactor: 1, ballSpeedScale: 1,
      frozenBallId: null, gravityWells: undefined, mapMutator: null, gravityConfig: null,
      slowAreas: areas,
      screenSize: { width: 900, height: 900 },
      boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
    } as unknown as CanvasGameState;
    return { game, ball };
  }

  const stepFor = (g: CanvasGameState, b: CanvasGameState["balls"][0], n: number) => {
    for (let i = 0; i < n; i++) updateBall(b, 1 / 120, g);
  };

  it("covers less ground inside than outside, over the same time", () => {
    const free = probe([]);
    const slowed = probe([{ x: 0, y: 0, width: 900, height: 900, factor: 0.5 }]);
    const x0f = free.ball.position.x, x0s = slowed.ball.position.x;
    stepFor(free.game, free.ball, 60);
    stepFor(slowed.game, slowed.ball, 60);
    const dFree = free.ball.position.x - x0f;
    const dSlow = slowed.ball.position.x - x0s;
    expect(dSlow).toBeGreaterThan(0);
    expect(dSlow).toBeCloseTo(dFree * 0.5, 0);
  });

  /**
   * The property that makes this compatible with everything else in updateBall.
   * If the slow had touched velocity, the minimum-speed floor would have snapped
   * it straight back the same frame and the zone would do nothing at all.
   */
  it("never touches the stored velocity, so no rescaler fights it", () => {
    const { game, ball } = probe([{ x: 0, y: 0, width: 900, height: 900, factor: 0.5 }]);
    const before = Math.hypot(ball.velocity.x, ball.velocity.y);
    stepFor(game, ball, 30);
    expect(Math.hypot(ball.velocity.x, ball.velocity.y)).toBeCloseTo(before, 6);
    expect(ball.velocity.y).toBeCloseTo(0, 6);
  });

  it("lets go the moment the ball leaves, with nothing to restore", () => {
    // A band the ball starts inside and exits: slow while crossing, full speed after.
    const { game, ball } = probe([{ x: 0, y: 0, width: 300, height: 900, factor: 0.5 }]);
    stepFor(game, ball, 400);                          // well clear of the band
    expect(ball.position.x).toBeGreaterThan(300);
    const x1 = ball.position.x;
    stepFor(game, ball, 30);
    const outsideStep = ball.position.x - x1;

    const free = probe([]);
    const x2 = free.ball.position.x;
    stepFor(free.game, free.ball, 30);
    expect(outsideStep).toBeCloseTo(free.ball.position.x - x2, 0);
  });

  it("does nothing at all when no area was ever placed", () => {
    const { game, ball } = probe([]);
    const x0 = ball.position.x;
    stepFor(game, ball, 60);
    expect(ball.position.x - x0).toBeGreaterThan(0);
    expect(game.slowAreas).toEqual([]);
  });
});
