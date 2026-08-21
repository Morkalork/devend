/**
 * "Wire the Integration" (issue #73 rewrite): each terminal boots the DORMANT
 * ball linked to it when a fence routes through it. This pins the routing rule,
 * that lighting a terminal wakes exactly its ball (active, launched, its reserved
 * pocket released), independence between terminals, and config + rotation.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({ playBossChargeSound: () => {} }));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { tickCircuitOnCut } from "@/lib/physics/circuit";
import { rotateCircuit } from "@/lib/mapRotation";
import { createInitialGameData } from "@/lib/initGame";
import { isPositionActive } from "@/lib/spaceGrid";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { CanvasGameState, CircuitRuntime } from "@/types/gameState";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { GrowingWall, Vector2, Ball } from "@/types/game";
import type { LevelData, LevelConfig } from "@/types/level";

// Zeroed modifiers: enough to init a real map (see superiorLock.test.ts).
const MODS = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1, shopDiscountMultiplier: 1, pushBonusMultiplier: 1,
  instantFencesPerMap: 0, additionalConcurrentFences: 0, extraLives: 0, extraShopItems: 0, shopRestockCount: 0,
  extraContinues: 0, extraCertificateHours: 0, startingCapturePercent: 0,
  fenceDurabilityBonus: 0, microManagerPerLock: 0, ballPathPredictionBounces: 0,
  ballPathPredictionBalls: 0, disablePushYourLuck: 0, ballFreezeDuration: 0,
  freezeUsesPerMap: 0, slowOneBallFactor: 0, freezePickups: 0, ballFreezeCount: 0,
  autoFreezeDuration: 0, showHighscoreProgress: 0, overtimePerLock: 0,
  overtimePerSuperiorLock: 0, fenceSpeedPerLock: 0, frozenLockBonus: 0,
  simultaneousLockBonus: 0, freezeNoCooldown: 0, fenceSpeedPerFence: 0,
  fenceSpeedPerMapCleared: 0, underParInstantFence: 0, bankedSlowPer50h: 0,
  spaceBonusMultiplier: 1, overtimeCapBonus: 0, freeCheapestOffer: 0,
  wallShieldsPerMap: 0, fenceGraceMs: 0, shipEarlySecondsPerBall: 0,
  scopeCreepImmediate: 0, shipEarlyBonusMultiplier: 1, runwayInstantFenceAt: 0,
  runwayConcurrentFenceAt: 0, runwayFreezeAt: 0, spendInstantFencePerChunk: 0,
  spendFenceSpeedPerChunk: 0, spendCapturePerChunk: 0, spendChunkCapBonus: 0,
  lockThresholdBonus: 0, spawnFreezeSeconds: 0, pickupChanceBonus: 0, pickupPayoutLevel: 0,
} as unknown as GameModifiers;

// A fence whose ONE grown half is the polyline `pts` (the other half is empty).
function fence(...pts: Vector2[]): GrowingWall {
  return { startWaypoints: pts, endWaypoints: [pts[pts.length - 1]] } as unknown as GrowingWall;
}

const cbs = (onCircuitComplete?: GameCallbacks["onCircuitComplete"]) =>
  ({ onCircuitComplete }) as unknown as GameCallbacks;

function dormant(id: string, x: number, y: number): Ball {
  return {
    id, position: { x, y }, velocity: { x: 0, y: 0 }, radius: 12, speed: 0,
    baseSpeed: 200, topSpeed: 200, state: "dormant", regionId: "r",
  } as unknown as Ball;
}

function makeCircuit(): CircuitRuntime {
  return {
    terminals: [
      { x: 100, y: 100, radius: 20, lit: false, ballId: "d0" },
      { x: 300, y: 300, radius: 20, lit: false, ballId: "d1" },
    ],
  };
}

function makeGame(circuit: CircuitRuntime | null, balls: Ball[]): CanvasGameState {
  return {
    circuit, balls,
    regions: [{ id: "r", polygon: { vertices: [] }, samplePoints: [] }],
  } as unknown as CanvasGameState;
}

describe("booting dormant balls", () => {
  it("lighting a terminal wakes exactly its ball and launches it", () => {
    const c = makeCircuit();
    const d0 = dormant("d0", 100, 100);
    const d1 = dormant("d1", 300, 300);
    const game = makeGame(c, [d0, d1]);

    let bootFired = 0;
    // A cut through terminal 0 at (100,100).
    tickCircuitOnCut(game, fence({ x: 100, y: 0 }, { x: 100, y: 200 }), cbs(() => { bootFired++; }));

    expect(c.terminals[0].lit).toBe(true);
    expect(d0.state).toBe("active");
    expect(d0.speed).toBeGreaterThan(0);
    expect(Math.hypot(d0.velocity.x, d0.velocity.y)).toBeGreaterThan(0);
    expect(bootFired).toBe(1);

    // Terminal 1 / ball d1 untouched.
    expect(c.terminals[1].lit).toBe(false);
    expect(d1.state).toBe("dormant");
  });

  it("a fence that misses every terminal wakes nothing", () => {
    const c = makeCircuit();
    const d0 = dormant("d0", 100, 100);
    const game = makeGame(c, [d0]);
    tickCircuitOnCut(game, fence({ x: 800, y: 0 }, { x: 800, y: 900 }), cbs());
    expect(c.terminals.some(t => t.lit)).toBe(false);
    expect(d0.state).toBe("dormant");
  });

  it("one cut can boot BOTH balls if it routes through both terminals", () => {
    const c: CircuitRuntime = {
      terminals: [
        { x: 100, y: 150, radius: 20, lit: false, ballId: "d0" },
        { x: 400, y: 150, radius: 20, lit: false, ballId: "d1" },
      ],
    };
    const d0 = dormant("d0", 100, 150);
    const d1 = dormant("d1", 400, 150);
    const game = makeGame(c, [d0, d1]);
    tickCircuitOnCut(game, fence({ x: 0, y: 150 }, { x: 500, y: 150 }), cbs());
    expect(d0.state).toBe("active");
    expect(d1.state).toBe("active");
  });

  it("re-lighting a lit terminal, or a fully-lit circuit, is a no-op", () => {
    const c = makeCircuit();
    c.terminals[0].lit = true;
    const d0 = dormant("d0", 100, 100); d0.state = "active"; // already booted
    const d1 = dormant("d1", 300, 300);
    const game = makeGame(c, [d0, d1]);
    // A cut back through terminal 0 must not re-fire anything.
    let fired = 0;
    tickCircuitOnCut(game, fence({ x: 100, y: 0 }, { x: 100, y: 200 }), cbs(() => { fired++; }));
    expect(fired).toBe(0);
  });

  it("is a no-op with no circuit", () => {
    expect(() => tickCircuitOnCut(makeGame(null, []), fence({ x: 0, y: 0 }, { x: 100, y: 0 }), cbs())).not.toThrow();
  });
});

describe("config + rotation", () => {
  it("the level-8 pilot ships terminals that each boot a dormant ball", () => {
    const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData;
    const l8 = doc.levels.find(l => l.id === "level-8")!;
    expect(l8.circuit).toBeDefined();
    expect(l8.circuit!.terminals.length).toBeGreaterThanOrEqual(1);
    expect(l8.circuit!.radius).toBeGreaterThan(0);
    for (const t of l8.circuit!.terminals) {
      expect(t.ball, "every terminal must link a dormant ball").toBeDefined();
      expect(typeof t.ball.x).toBe("number");
      expect(typeof t.ball.y).toBe("number");
    }
  });

  it("rotateCircuit turns each terminal AND its linked ball into the orientation", () => {
    const base = { terminals: [{ x: 100, y: 0, ball: { x: 120, y: 40 } }], radius: 20 };
    expect(rotateCircuit(base, 0)).toBe(base); // no-op at 0
    const r = rotateCircuit(base, 1); // 90 left
    expect(r.terminals[0]).not.toEqual(base.terminals[0]);
    expect(r.terminals[0].ball).not.toEqual(base.terminals[0].ball);
  });

  it("every circuit map spawns its sleepers dormant, in OPEN space (not in a wall)", () => {
    const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData;
    const circuitLevels = doc.levels.filter(l => l.circuit) as LevelConfig[];
    expect(circuitLevels.length).toBeGreaterThan(0);
    for (const level of circuitLevels) {
      // A few inits to cover different random rotations / decorations.
      for (let trial = 0; trial < 4; trial++) {
        const data = createInitialGameData(level, level.level, MODS);
        const dormant = data.balls.filter(b => b.state === "dormant");
        expect(dormant.length, `${level.id} should spawn a dormant ball per terminal`)
          .toBe(level.circuit!.terminals.length);
        for (const b of dormant) {
          expect(b.speed).toBe(0);
          expect(
            isPositionActive(data.spaceGrid!, b.position),
            `${level.id}: dormant ball at (${b.position.x | 0},${b.position.y | 0}) must be in open space`,
          ).toBe(true);
        }
      }
    }
  });
});
