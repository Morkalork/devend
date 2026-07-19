/**
 * Boss encounters (issue #56), Phase 1 slice "Release Deadline".
 *
 * Covers the two genuinely new pieces:
 * - the MANDATORY-objective win gate (isBossGateSatisfied): a boss map cannot be
 *   won until its objective is met; a non-boss map is never gated;
 * - the phase controller (tickBossPhases): a phase fires exactly once when its
 *   threshold is crossed, spawns its adds, and never deadlocks when nothing can
 *   anchor a spawn.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({ playWallHitSound: () => {}, playCutClaimedSound: () => {}, playLevelCompleteSound: () => {} }));
vi.mock("@/lib/gameHaptics", () => ({ vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {} }));

import { isBossGateSatisfied } from "@/lib/physics/applyCut";
import { tickBossPhases, tickBossSpit } from "@/lib/physics/bossPhases";
import { bossTrapIsDamage, escalateBoss } from "@/lib/physics/checkBallWonState";
import { evaluateObjective } from "@/lib/mapObjectives";
import { updateBall } from "@/lib/physics/updateBall";
import { createRectPolygon } from "@/lib/polygon";
import { createBallEffectState } from "@/lib/ballEffects";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";
import type { Ball } from "@/types/game";
import type { MapObjective } from "@/types/objective";

const SHIP_IT: MapObjective = {
  id: "ship-it", name: "Ship It", description: "d", kind: "lockCount", reward: 8, params: { count: 2 },
};

function gameWith(part: Partial<CanvasGameState>): CanvasGameState {
  return {
    lockedBallsCount: 0, superiorLockCount: 0, wallCount: 0, activePlaySeconds: 0,
    objective: null, bossFiredPhases: [], balls: [], spaceGrid: null,
    ...part,
  } as unknown as CanvasGameState;
}
const bossLevel = (): LevelConfig => ({
  id: "level-10", level: 10, sizeThreshold: 15, expectedCuts: 16, points: 20, maxBalls: 2,
  boss: { name: "Release Deadline", intro: "x", objective: SHIP_IT, creepFromStart: true,
          phases: [{ id: "hotfix", atSpaceRemaining: 50, spawnAdds: 1 }] },
});

function activeBall(id: string): Ball {
  return {
    id, typeId: "red", state: "active", speed: 100, baseSpeed: 100, topSpeed: 100, radius: 12,
    position: { x: 300, y: 300 }, velocity: { x: 100, y: 0 }, regionId: "r", color: "#f00",
    rotation: 0, flashIntensity: 0, effects: createBallEffectState(), wonSpinSpeed: 0, wonTime: 0,
    assimScale: 1, assimColorFade: 0, ability: "none", lockMultiplier: 1, spawnTime: 0, minimumSpeed: 80,
  } as unknown as Ball;
}

describe("isBossGateSatisfied (#56 mandatory win gate)", () => {
  it("never gates a non-boss map", () => {
    const level: LevelConfig = { id: "l", level: 12, sizeThreshold: 10, expectedCuts: 5, points: 20, maxBalls: 2 };
    expect(isBossGateSatisfied(gameWith({ lockedBallsCount: 0 }), level)).toBe(true);
  });

  it("blocks the win until the boss objective is met, then allows it", () => {
    const level = bossLevel();
    // Clearing space with < 2 locks must NOT satisfy the gate.
    expect(isBossGateSatisfied(gameWith({ objective: SHIP_IT, lockedBallsCount: 0 }), level)).toBe(false);
    expect(isBossGateSatisfied(gameWith({ objective: SHIP_IT, lockedBallsCount: 1 }), level)).toBe(false);
    // Meeting the objective (2 locks) opens the gate.
    expect(isBossGateSatisfied(gameWith({ objective: SHIP_IT, lockedBallsCount: 2 }), level)).toBe(true);
    expect(isBossGateSatisfied(gameWith({ objective: SHIP_IT, lockedBallsCount: 3 }), level)).toBe(true);
  });

  it("fails open if a boss somehow has no objective wired (never soft-locks)", () => {
    const level = bossLevel();
    expect(isBossGateSatisfied(gameWith({ objective: null }), level)).toBe(true);
  });
});

describe("tickBossPhases (#56 phase controller)", () => {
  const level: LevelConfig = {
    id: "level-10", level: 10, sizeThreshold: 15, expectedCuts: 16, points: 20, maxBalls: 2,
    boss: { name: "B", intro: "x", objective: SHIP_IT, phases: [{ id: "p", atSeconds: 3, spawnAdds: 1 }] },
  };

  it("fires once at the threshold, spawns the add, and does not re-fire", () => {
    const game = gameWith({ activePlaySeconds: 5, balls: [activeBall("a")] });
    tickBossPhases(game, level, 10);
    expect(game.bossFiredPhases).toContain("p");
    expect(game.balls.length).toBe(2); // one add spawned

    tickBossPhases(game, level, 10); // same phase must not fire again
    expect(game.balls.length).toBe(2);
  });

  it("does not fire before the threshold", () => {
    const game = gameWith({ activePlaySeconds: 1, balls: [activeBall("a")] });
    tickBossPhases(game, level, 10);
    expect(game.bossFiredPhases).toEqual([]);
    expect(game.balls.length).toBe(1);
  });

  it("never deadlocks: with no active anchor it still fires but spawns nothing", () => {
    const won = { ...activeBall("a"), state: "won" } as Ball;
    const game = gameWith({ activePlaySeconds: 5, balls: [won] });
    tickBossPhases(game, level, 10);
    expect(game.bossFiredPhases).toContain("p"); // marked fired
    expect(game.balls.length).toBe(1);           // but nothing spawned
  });

  it("is a no-op on non-boss maps", () => {
    const plain: LevelConfig = { id: "l", level: 11, sizeThreshold: 10, expectedCuts: 5, points: 20, maxBalls: 2 };
    const game = gameWith({ activePlaySeconds: 99, balls: [activeBall("a")] });
    tickBossPhases(game, plain, 11);
    expect(game.balls.length).toBe(1);
  });
});

describe("boss ball fight (#56 the Release Candidate)", () => {
  function bossBall(hp: number): Ball {
    return { ...activeBall("boss"), isBoss: true, bossHp: hp, bossMaxHp: hp, radius: 24, speed: 120, baseSpeed: 120, minimumSpeed: 90 } as Ball;
  }

  it("a trap DAMAGES the boss while HP remains, DEFEATS it on the last", () => {
    expect(bossTrapIsDamage(bossBall(3))).toBe(true);  // 3 -> break out
    expect(bossTrapIsDamage(bossBall(2))).toBe(true);  // 2 -> break out
    expect(bossTrapIsDamage(bossBall(1))).toBe(false); // 1 -> the trap that defeats it
    expect(bossTrapIsDamage(activeBall("x"))).toBe(false); // a normal ball is never a boss
  });

  it("only spits red minions (the boss is not a rainbow ball)", () => {
    const level: LevelConfig = {
      id: "level-10", level: 10, sizeThreshold: 15, expectedCuts: 16, points: 20, maxBalls: 1,
      boss: {
        name: "B", intro: "x",
        objective: { id: "d", name: "D", description: "d", kind: "defeatBoss", reward: 12 },
        bossBall: { hp: 3, spitIntervalSeconds: 5, maxMinions: 4 },
      },
    };
    const boss = bossBall(3); // typeId "red"
    const game = gameWith({ balls: [boss], bossMinionCount: 0 });
    for (let s = 5; s <= 20; s += 5) { game.activePlaySeconds = s; tickBossSpit(game, level); }
    const minions = game.balls.filter((b) => b.id.includes("minion"));
    expect(minions.length).toBeGreaterThanOrEqual(3);
    expect(minions.every((m) => m.typeId === boss.typeId)).toBe(true); // red only, never random
    expect(new Set(minions.map((m) => m.typeId)).size).toBe(1);        // no variety
    // Each spawns as a tiny bud that will grow (mitosis), not full size.
    expect(minions.every((m) => m.bornAt !== undefined && (m.bornRadius ?? 0) > m.radius)).toBe(true);
  });

  it("escalates the boss on a hit: faster, smaller (never below the floor)", () => {
    const b = bossBall(3);
    const r0 = b.radius, s0 = b.speed;
    escalateBoss(b);
    expect(b.speed).toBeGreaterThan(s0);
    expect(b.radius).toBeLessThan(r0);
    expect(b.radius).toBeGreaterThanOrEqual(12); // floor
  });

  it("defeatBoss objective is met only once the boss is defeated", () => {
    const obj: MapObjective = { id: "d", name: "Defeat", description: "d", kind: "defeatBoss", reward: 12 };
    expect(evaluateObjective(obj, { lockedBalls: 0, superiorLocks: 0, cuts: 0, par: 16, activeSeconds: 0, bossDefeated: false }).met).toBe(false);
    expect(evaluateObjective(obj, { lockedBalls: 0, superiorLocks: 0, cuts: 0, par: 16, activeSeconds: 0, bossDefeated: true }).met).toBe(true);
  });

  it("a boss map with a defeatBoss objective gates the win on bossDefeated", () => {
    const obj: MapObjective = { id: "d", name: "Defeat", description: "d", kind: "defeatBoss", reward: 12 };
    const level: LevelConfig = {
      id: "level-10", level: 10, sizeThreshold: 15, expectedCuts: 16, points: 20, maxBalls: 1,
      boss: { name: "Release Deadline", intro: "x", objective: obj, bossBall: { hp: 3 } },
    };
    expect(isBossGateSatisfied(gameWith({ objective: obj, bossDefeated: false }), level)).toBe(false);
    expect(isBossGateSatisfied(gameWith({ objective: obj, bossDefeated: true }), level)).toBe(true);
  });
});

describe("boss minion mitosis grow-in (#56)", () => {
  const BOARD = createRectPolygon(0, 0, 600, 400);
  function minionGame(ball: Ball): CanvasGameState {
    return { boardPolygon: BOARD, obstaclePolygons: [], walls: [], movers: [], regions: [], creepFactor: 1, balls: [ball], mapMutator: null } as unknown as CanvasGameState;
  }
  function bud(bornAt: number): Ball {
    return { ...activeBall("m"), position: { x: 300, y: 200 }, velocity: { x: 100, y: 0 }, radius: 2, bornRadius: 12, bornAt } as Ball;
  }

  it("stays a small bud right after birth (still growing)", () => {
    const b = bud(performance.now());
    updateBall(b, 1 / 120, minionGame(b));
    expect(b.radius).toBeLessThan(12);
    expect(b.bornAt).toBeDefined();
  });

  it("reaches full size and clears the birth flag once grown", () => {
    const b = bud(performance.now() - 1200); // well past the ~1s birth duration
    updateBall(b, 1 / 120, minionGame(b));
    expect(b.radius).toBe(12);
    expect(b.bornAt).toBeUndefined();
  });

  it("a newborn minion moves slowly at first (the split beat)", () => {
    const now = performance.now();
    const slow = { ...bud(now), splitAnimAt: now, position: { x: 300, y: 200 }, velocity: { x: 120, y: 0 } } as Ball;
    const fast = { ...bud(now), splitAnimAt: undefined, position: { x: 300, y: 200 }, velocity: { x: 120, y: 0 } } as Ball;
    updateBall(slow, 1 / 120, minionGame(slow));
    updateBall(fast, 1 / 120, minionGame(fast));
    expect(slow.position.x - 300).toBeLessThan(fast.position.x - 300); // split beat slows it
    expect(slow.velocity.x).toBe(120); // stored velocity untouched (speeds back up on its own)
  });

  it("the boss decelerates mid-division, then recovers", () => {
    const dividing = { ...activeBall("boss"), isBoss: true, radius: 20, position: { x: 300, y: 200 }, velocity: { x: 120, y: 0 }, splitAnimAt: performance.now() - 500 } as Ball;
    const normal = { ...activeBall("boss2"), isBoss: true, radius: 20, position: { x: 300, y: 200 }, velocity: { x: 120, y: 0 } } as Ball;
    updateBall(dividing, 1 / 120, minionGame(dividing));
    updateBall(normal, 1 / 120, minionGame(normal));
    expect(dividing.position.x - 300).toBeLessThan(normal.position.x - 300); // slowed at the mid-point of the split
  });
});
