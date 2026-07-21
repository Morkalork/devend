/**
 * Rainbow ball: the occasional post-level-10 spawner. Covers eligibility of its
 * spit-out pool, the seeded per-map appearance roll, and the timed spawn tick
 * (linear growth, active-only, never spawns another rainbow).
 */
import { describe, it, expect } from "vitest";
import {
  getSpawnableBallTypes,
  getEligibleBallTypes,
  selectBallTypesForMap,
  getBallType,
} from "@/lib/ballTypes";
import { tickRainbowSpawns } from "@/lib/physics/rainbowSpawner";
import { MAX_LIVE_BALLS } from "@/lib/gameConstants";
import { Ball } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";

function rainbowBall(): Ball {
  const type = getBallType("rainbow")!;
  return {
    id: "rainbow-0", position: { x: 400, y: 400 }, velocity: { x: 100, y: 0 },
    radius: 18, speed: type.baseSpeed, baseSpeed: type.baseSpeed, topSpeed: type.baseSpeed,
    color: type.color, regionId: "r1", rotation: 0, flashIntensity: 0,
    effects: {} as never, state: "active", wonSpinSpeed: 0, wonTime: 0,
    assimScale: 1, assimColorFade: 0, typeId: "rainbow", ability: "rainbow",
    lockMultiplier: type.lockMultiplier, spawnTime: 0, minimumSpeed: type.minimumSpeed,
    spawnActiveSeconds: 0, rainbowSpawnCount: 0,
  } as Ball;
}

function gameWith(balls: Ball[], activePlaySeconds: number): CanvasGameState {
  return { balls, activePlaySeconds } as unknown as CanvasGameState;
}

describe("rainbow ball catalogue", () => {
  it("is authored: fast, gated past level 10, with a spawn timer and chance", () => {
    const rb = getBallType("rainbow");
    expect(rb).toBeDefined();
    expect(rb!.ability).toBe("rainbow");
    expect(rb!.unlockLevel).toBeGreaterThan(10);
    expect(rb!.spawnIntervalSeconds).toBeGreaterThan(0);
    expect(rb!.spawnChance).toBeGreaterThan(0);
    expect(rb!.spawnChance).toBeLessThanOrEqual(1);
    // Faster than the standard balls.
    expect(rb!.baseSpeed).toBeGreaterThan(getBallType("red")!.baseSpeed);
  });

  it("spit-out pool is the level's eligible types minus rainbow itself", () => {
    const spawnable = getSpawnableBallTypes(12);
    expect(spawnable.length).toBeGreaterThan(0);
    expect(spawnable.every(t => t.ability !== "rainbow")).toBe(true);
    // Exactly the eligible set with the rainbow removed.
    const eligibleNonRainbow = getEligibleBallTypes(12).filter(t => t.ability !== "rainbow");
    expect(spawnable.map(t => t.id).sort()).toEqual(eligibleNonRainbow.map(t => t.id).sort());
  });
});

describe("rainbow per-map appearance roll", () => {
  it("is deterministic per map id and only sometimes includes rainbow", () => {
    const appears = (mapId: string) =>
      selectBallTypesForMap(mapId, 20, 4).some(t => t.ability === "rainbow");
    // Deterministic: same id, same answer.
    for (const id of ["level-20", "level-25", "level-31"]) {
      expect(appears(id)).toBe(appears(id));
    }
    // Occasional: across many ids it shows up on some but not all.
    const ids = Array.from({ length: 60 }, (_, i) => `map-${i}`);
    const hits = ids.filter(appears).length;
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(ids.length);
  });

  it("never appears before its unlock level", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `early-${i}`);
    const anyAtL9 = ids.some(id => selectBallTypesForMap(id, 9, 4).some(t => t.ability === "rainbow"));
    expect(anyAtL9).toBe(false);
  });
});

describe("rainbow timed spawner", () => {
  it("spits one eligible non-rainbow ball per interval, and grows linearly", () => {
    const rb = rainbowBall();
    const interval = getBallType("rainbow")!.spawnIntervalSeconds!;
    const game = gameWith([rb], 0);

    tickRainbowSpawns(game, 20);
    expect(game.balls.length).toBe(1); // nothing due yet

    game.activePlaySeconds = interval; // first spit
    tickRainbowSpawns(game, 20);
    expect(game.balls.length).toBe(2);

    game.activePlaySeconds = interval * 3.5; // two more intervals elapsed
    tickRainbowSpawns(game, 20);
    expect(game.balls.length).toBe(4); // linear, one per interval — never doubling

    // Every spawned ball is a real, non-rainbow type (no exponential chain).
    const children = game.balls.filter(b => b.id !== "rainbow-0");
    expect(children.length).toBe(3);
    expect(children.every(b => b.ability !== "rainbow")).toBe(true);
    expect(children.every(b => b.state === "active")).toBe(true);
  });

  it("stops spitting once the rainbow ball is locked away", () => {
    const rb = rainbowBall();
    const game = gameWith([rb], 100); // well past several intervals
    rb.state = "won"; // trapped
    tickRainbowSpawns(game, 20);
    expect(game.balls.length).toBe(1); // no new balls from a locked rainbow
  });

  it("never grows game.balls past the hard safety cap (long weak-time-limit map)", () => {
    const rb = rainbowBall();
    const interval = getBallType("rainbow")!.spawnIntervalSeconds!;
    const game = gameWith([rb], 0);
    // Simulate a very long map: advance far past the cap's worth of intervals and
    // tick repeatedly. Without the cap this would grow linearly forever.
    for (let s = 1; s <= 5000; s++) {
      game.activePlaySeconds = s * interval;
      tickRainbowSpawns(game, 20);
      if (game.balls.length >= MAX_LIVE_BALLS) break;
    }
    // Keep ticking well past the point the cap is hit; it must not exceed it.
    for (let i = 0; i < 50; i++) {
      game.activePlaySeconds += interval * 10;
      tickRainbowSpawns(game, 20);
    }
    expect(game.balls.length).toBe(MAX_LIVE_BALLS);
  });
});
