/**
 * Three map mechanics, checked where they actually take effect.
 *
 * All three are cheap to write and easy to get subtly wrong in a way nothing
 * reports: a one-way membrane that is solid both ways still plays, a gate that
 * lets everything through still plays, a slow zone that changes nothing still
 * plays. None of them errors. So each is tested against the engine that reads
 * it, not against the config that declares it.
 */
import { describe, it, expect } from "vitest";
import { ballMayPass, isEmptyRule, type ObstacleRule } from "@/lib/physics/obstacleRules";
import {
  zoneFactorAt, pathSpeedFactor, cutSpeedFactor, clampZoneSpeed,
  MIN_ZONE_SPEED, MAX_ZONE_SPEED, type FenceZone,
} from "@/lib/physics/fenceZones";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { setRunSeedText } from "@/lib/runRng";
import { rotateEntity } from "@/lib/mapRotation";
import type { Ball } from "@/types/game";
import type { LevelConfig, WallRectEntity } from "@/types/level";
import { updateBall } from "@/lib/physics/updateBall";
import { createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { PHYSICS_STEP } from "@/lib/gameConstants";

const ball = (typeId: string): Ball => ({ typeId } as Ball);

// ── One-way membranes ──────────────────────────────────────────────────────

describe("a one-way membrane", () => {
  const facingRight: ObstacleRule = { oneWay: "right" };

  it("lets a ball through going its way", () => {
    expect(ballMayPass(facingRight, ball("red"), { x: 200, y: 0 })).toBe(true);
    expect(ballMayPass(facingRight, ball("red"), { x: 200, y: 150 })).toBe(true);
  });

  it("stops a ball coming back", () => {
    expect(ballMayPass(facingRight, ball("red"), { x: -200, y: 0 })).toBe(false);
    expect(ballMayPass(facingRight, ball("red"), { x: -200, y: 150 })).toBe(false);
  });

  it("stops a ball running exactly along it", () => {
    // A ball travelling parallel has no side to be on, and calling that "pass"
    // is how one ends up resolving inside a solid wall.
    expect(ballMayPass(facingRight, ball("red"), { x: 0, y: 300 })).toBe(false);
    expect(ballMayPass(facingRight, ball("red"), { x: 0, y: -300 })).toBe(false);
  });

  it("faces every bearing", () => {
    expect(ballMayPass({ oneWay: "down" }, ball("red"), { x: 0, y: 5 })).toBe(true);
    expect(ballMayPass({ oneWay: "down" }, ball("red"), { x: 0, y: -5 })).toBe(false);
    expect(ballMayPass({ oneWay: "up" }, ball("red"), { x: 0, y: -5 })).toBe(true);
    expect(ballMayPass({ oneWay: "left" }, ball("red"), { x: -5, y: 0 })).toBe(true);
  });

  it("turns with the map", () => {
    // A membrane is a bearing, like a well's pull, and has to end up facing the
    // same way relative to the board however the map is dealt.
    const e = { id: "m", kind: "wall", shape: "rect", x: 100, y: 100, width: 200, height: 20, oneWay: "right" } as WallRectEntity;
    const seen = new Set<string>();
    for (const r of [0, 1, 2, 3] as const) {
      const rotated = rotateEntity(e, r) as WallRectEntity;
      expect(rotated.oneWay).toBeDefined();
      seen.add(rotated.oneWay!);
    }
    // Four rotations of one bearing are four different bearings; if they were
    // not, the membrane would face the same absolute way whatever the map did.
    expect(seen.size).toBe(4);
  });
});

// ── Ball-type gates ────────────────────────────────────────────────────────

describe("a ball-type gate", () => {
  const blackOnly: ObstacleRule = { passTypes: ["black"] };

  it("passes the type it names and stops the rest", () => {
    expect(ballMayPass(blackOnly, ball("black"), { x: 5, y: 0 })).toBe(true);
    expect(ballMayPass(blackOnly, ball("red"), { x: 5, y: 0 })).toBe(false);
  });

  it("passes it from either side, unlike a membrane", () => {
    expect(ballMayPass(blackOnly, ball("black"), { x: -5, y: 0 })).toBe(true);
  });

  it("names more than one type when it wants to", () => {
    const ghosts: ObstacleRule = { passTypes: ["white", "green"] };
    expect(ballMayPass(ghosts, ball("white"), { x: 1, y: 0 })).toBe(true);
    expect(ballMayPass(ghosts, ball("green"), { x: 1, y: 0 })).toBe(true);
    expect(ballMayPass(ghosts, ball("black"), { x: 1, y: 0 })).toBe(false);
  });

  it("treats an empty list as an ordinary wall, not as a wall nothing passes", () => {
    // A half-finished edit in the admin must leave a solid wall, not a wall
    // that happens to already be correct.
    expect(isEmptyRule({ passTypes: [] })).toBe(true);
    expect(ballMayPass({ passTypes: [] }, ball("red"), { x: 5, y: 0 })).toBe(false);
  });
});

describe("a gate that is also a membrane", () => {
  it("lets the named type through either way, and anything else only one way", () => {
    // OR, not AND, and deliberately: an AND would make a blue ball bounce off
    // a gate it had just come through, which no player could reason about.
    const both: ObstacleRule = { oneWay: "right", passTypes: ["black"] };
    expect(ballMayPass(both, ball("black"), { x: -5, y: 0 })).toBe(true);
    expect(ballMayPass(both, ball("red"), { x: 5, y: 0 })).toBe(true);
    expect(ballMayPass(both, ball("red"), { x: -5, y: 0 })).toBe(false);
  });
});

describe("rules that say nothing", () => {
  it("leaves an ordinary wall solid", () => {
    expect(ballMayPass(undefined, ball("red"), { x: 5, y: 0 })).toBe(false);
    expect(ballMayPass({}, ball("red"), { x: 5, y: 0 })).toBe(false);
    expect(isEmptyRule(undefined)).toBe(true);
    expect(isEmptyRule({})).toBe(true);
    expect(isEmptyRule({ oneWay: "up" })).toBe(false);
  });
});

// ── Fence-speed ground ─────────────────────────────────────────────────────

const SLOW: FenceZone = { x: 200, y: 0, width: 200, height: 900, speed: 0.5 };

describe("fence-speed ground", () => {
  it("does nothing where there is no zone", () => {
    expect(zoneFactorAt(undefined, { x: 100, y: 100 })).toBe(1);
    expect(zoneFactorAt([], { x: 100, y: 100 })).toBe(1);
    expect(zoneFactorAt([SLOW], { x: 100, y: 100 })).toBe(1);
  });

  it("applies inside its rect", () => {
    expect(zoneFactorAt([SLOW], { x: 300, y: 400 })).toBe(0.5);
  });

  it("multiplies where zones overlap", () => {
    const other: FenceZone = { x: 0, y: 0, width: 900, height: 900, speed: 0.5 };
    expect(zoneFactorAt([SLOW, other], { x: 300, y: 400 })).toBe(0.25);
  });

  it("clamps a zone that would stall a fence forever or make it instant", () => {
    expect(clampZoneSpeed(0)).toBe(MIN_ZONE_SPEED);
    expect(clampZoneSpeed(-3)).toBe(MIN_ZONE_SPEED);
    expect(clampZoneSpeed(99)).toBe(MAX_ZONE_SPEED);
    expect(zoneFactorAt([{ ...SLOW, speed: 0 }], { x: 300, y: 400 })).toBe(MIN_ZONE_SPEED);
  });
});

describe("a path across mixed ground", () => {
  it("costs the time each piece really takes, not the average of the factors", () => {
    // Half a path at 1x and half at 0.5x costs 0.5 + 1 = 1.5 units of time, so
    // the effective factor is 1/1.5 = 0.667. Averaging the factors gives 0.75
    // and a fence that finishes noticeably early - the whole reason this is a
    // harmonic mean.
    const zone: FenceZone = { x: 0, y: 0, width: 100, height: 100, speed: 0.5 };
    const path = [{ x: 0, y: 50 }, { x: 200, y: 50 }];  // half inside, half out
    const f = pathSpeedFactor([zone], path);
    expect(f).toBeCloseTo(2 / 3, 2);
    expect(f).not.toBeCloseTo(0.75, 2);
  });

  it("reduces to the zone's own speed when the whole path is inside it", () => {
    const zone: FenceZone = { x: 0, y: 0, width: 900, height: 900, speed: 0.4 };
    expect(pathSpeedFactor([zone], [{ x: 10, y: 10 }, { x: 800, y: 10 }])).toBeCloseTo(0.4, 3);
  });

  it("is 1 for a path that misses every zone", () => {
    expect(pathSpeedFactor([SLOW], [{ x: 500, y: 0 }, { x: 800, y: 0 }])).toBe(1);
  });

  it("survives a degenerate path instead of dividing by its length", () => {
    expect(pathSpeedFactor([SLOW], [])).toBe(1);
    expect(pathSpeedFactor([SLOW], [{ x: 1, y: 1 }])).toBe(1);
    expect(pathSpeedFactor([SLOW], [{ x: 1, y: 1 }, { x: 1, y: 1 }])).toBe(1);
  });

  it("prices a cut by its LONGER half, which is what has to finish", () => {
    // A cut completes when the longer side lands, so a slow zone on the short
    // side does not decide the cost.
    const zone: FenceZone = { x: 0, y: 0, width: 100, height: 900, speed: 0.25 };
    const shortSlow = [{ x: 100, y: 50 }, { x: 40, y: 50 }];       // 60 long, in the zone
    const longClear = [{ x: 100, y: 50 }, { x: 800, y: 50 }];      // 700 long, outside
    expect(cutSpeedFactor([zone], shortSlow, longClear)).toBe(1);
    // ...and the other way round, the slow half decides it.
    expect(cutSpeedFactor([zone], longClear, shortSlow)).toBe(1);
    const longSlow = [{ x: 90, y: 50 }, { x: 10, y: 50 }];
    expect(cutSpeedFactor([zone], longSlow, [{ x: 90, y: 50 }, { x: 80, y: 50 }])).toBeCloseTo(0.25, 3);
  });
});

// ── Reaching the board ─────────────────────────────────────────────────────

describe("the mechanics reach the game, not just the config", () => {
  const build = (extra: Partial<LevelConfig>, entity: WallRectEntity) => {
    setRunSeedText("mech-fixture");
    const level = {
      id: "mech", level: 1, name: "M", sizeThreshold: 30, expectedCuts: 4, points: 100,
      variety: 0, randomShapes: 0,
      balls: [{ id: "b1", type: "red", startX: 700, startY: 700 }],
      entities: [entity], ...extra,
    } as unknown as LevelConfig;
    const data = createInitialGameData(level, 1, DEFAULT_MODIFIERS);
    setRunSeedText(null);
    return data;
  };

  const WALL = { id: "w", kind: "wall", shape: "rect", x: 200, y: 400, width: 300, height: 24 } as WallRectEntity;

  it("records a membrane against the polygon it belongs to", () => {
    const data = build({}, { ...WALL, oneWay: "down" });
    expect(data.obstacleRules.size).toBe(1);
    const [poly, rule] = [...data.obstacleRules.entries()][0];
    // Keyed by identity, so the polygon in the map IS one of the obstacles.
    expect(data.obstaclePolygons).toContain(poly);
    expect(rule.oneWay).toBe("down");
  });

  it("records a gate", () => {
    const data = build({}, { ...WALL, passTypes: ["black"] });
    expect([...data.obstacleRules.values()][0].passTypes).toEqual(["black"]);
  });

  it("records nothing for an ordinary wall", () => {
    // Every map in the game has walls; a no-op entry on each would make the
    // Map as big as the board for no reason.
    expect(build({}, WALL).obstacleRules.size).toBe(0);
    expect(build({}, { ...WALL, passTypes: [] }).obstacleRules.size).toBe(0);
  });

  it("carries fence zones onto the board", () => {
    const data = build({ fenceZones: [SLOW] }, WALL);
    expect(data.fenceZones).toHaveLength(1);
    expect(data.fenceZones![0].speed).toBe(0.5);
  });

  it("leaves fenceZones absent when the map has none", () => {
    expect(build({}, WALL).fenceZones).toBeUndefined();
  });
});

// ── The engine actually reads them ─────────────────────────────────────────

/**
 * Everything above proves the rules are BUILT correctly and land in the game
 * data. None of it proves anything reads them: delete the check in updateBall
 * and every assertion so far stays green while a membrane is a plain wall.
 *
 * The same trap caught a pricing test and a HUD guard earlier in this codebase.
 * These drive the real physics instead.
 */
describe("a membrane the physics honours", () => {
  const membraneLevel = (extra: Record<string, unknown>) => {
    setRunSeedText("membrane");
    const level = {
      // Level 1: below ROTATION_MIN_LEVEL, so the board is dealt upright and
      // the membrane really does face the way this test thinks it does.
      id: "membrane", level: 1, name: "M", sizeThreshold: 30, expectedCuts: 4, points: 100,
      variety: 0, randomShapes: 0, pickupChance: 0,
      balls: [{ id: "b1", type: "red", startX: 100, startY: 100 }],
      entities: [{
        id: "wall", kind: "wall", shape: "rect",
        x: 400, y: 200, width: 40, height: 500, ...extra,
      }],
    } as unknown as LevelConfig;
    const data = createInitialGameData(level, 1, DEFAULT_MODIFIERS);
    setRunSeedText(null);
    return data;
  };

  /** Fire a ball at the wall from `fromX` and report whether it got through. */
  function crosses(data: ReturnType<typeof membraneLevel>, fromX: number, vx: number): boolean {
    const ball = {
      ...data.balls[0],
      position: { x: fromX, y: 450 },
      prevPosition: { x: fromX, y: 450 },
      velocity: { x: vx, y: 0 },
      speed: Math.abs(vx),
      radius: 10,
      state: "active",
      typeId: data.balls[0].typeId,
    } as unknown as Ball;
    const game = { ...data, balls: [ball] } as unknown as Parameters<typeof updateBall>[2];
    const startedLeft = fromX < 420;
    for (let i = 0; i < 400; i++) {
      updateBall(ball, 1 / 120, game);
      if (startedLeft ? ball.position.x > 470 : ball.position.x < 370) return true;
    }
    return false;
  }

  it("lets a ball through going its way, and stops it coming back", () => {
    // Positive x is "right". A membrane facing right must pass a ball moving
    // right and bounce one moving left.
    const data = membraneLevel({ oneWay: "right" });
    expect(crosses(data, 300, 300), "a ball was blocked going the way it may pass").toBe(true);
    expect(crosses(data, 540, -300), "a ball came back through a one-way membrane").toBe(false);
  });

  it("is solid both ways without the rule, so the test above means something", () => {
    // The control. If a plain wall also let balls through, "it crossed" would
    // be measuring the fixture, not the membrane.
    const data = membraneLevel({});
    expect(crosses(data, 300, 300)).toBe(false);
    expect(crosses(data, 540, -300)).toBe(false);
  });

  it("passes only the ball type a gate names", () => {
    const data = membraneLevel({ passTypes: ["black"] });
    expect(crosses(data, 300, 300), "a red ball walked through a black-only gate").toBe(false);
    // Same board, but the ball is now the type the gate admits.
    data.balls[0].typeId = "black";
    expect(crosses(data, 300, 300), "the gate did not admit the type it names").toBe(true);
  });
});

describe("fence ground the physics honours", () => {
  /** Frames for one straight cut to complete on this level. */
  function framesToComplete(zones: FenceZone[] | undefined): number {
    setRunSeedText("ground");
    const level = {
      id: "ground", level: 1, name: "G", sizeThreshold: 5, expectedCuts: 9, points: 100,
      variety: 0, randomShapes: 0, pickupChance: 0,
      balls: [{ id: "b1", type: "red", startX: 820, startY: 820 }],
      entities: [], ...(zones ? { fenceZones: zones } : {}),
    } as unknown as LevelConfig;
    const ctx = createBotGame(level, 1, plainModifiers());
    installClock();
    try {
      // A vertical cut straight down the middle, well clear of the ball.
      tryCut(ctx, { x: 300, y: 450 }, { x: 0, y: 1 });
      for (let f = 0; f < 4000; f++) {
        stepBot(ctx, PHYSICS_STEP);
        if (ctx.game.activeWalls.length === 0) return f;
      }
      return -1;
    } finally {
      releaseClock();
      setRunSeedText(null);
    }
  }

  it("makes a cut across slow ground take measurably longer", () => {
    const plain = framesToComplete(undefined);
    const slow = framesToComplete([{ x: 0, y: 0, width: 900, height: 900, speed: 0.5 }]);
    expect(plain, "the control cut never completed").toBeGreaterThan(0);
    expect(slow, "the slowed cut never completed").toBeGreaterThan(0);
    // Half speed over the whole board, so close to twice as long. Loose bounds:
    // the ease curve and the completion snap both round the edges.
    expect(slow).toBeGreaterThan(plain * 1.5);
  });

  it("makes a cut across fast ground finish sooner", () => {
    // The other direction matters too: the minimum-build-time floor swallowed
    // Overclock once, and would have swallowed this.
    const plain = framesToComplete(undefined);
    const fast = framesToComplete([{ x: 0, y: 0, width: 900, height: 900, speed: 2 }]);
    expect(fast).toBeGreaterThan(0);
    expect(fast).toBeLessThan(plain);
  });

  it("leaves a cut that misses the zone completely alone", () => {
    const plain = framesToComplete(undefined);
    const away = framesToComplete([{ x: 700, y: 700, width: 150, height: 150, speed: 0.25 }]);
    expect(away).toBe(plain);
  });
});
