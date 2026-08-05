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
import type { CanvasGameState, CircuitRuntime } from "@/types/gameState";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { GrowingWall, Vector2, Ball } from "@/types/game";
import type { LevelData } from "@/types/level";

// A fence whose ONE grown half is the polyline `pts` (the other half is empty).
function fence(...pts: Vector2[]): GrowingWall {
  return { startWaypoints: pts, endWaypoints: [pts[pts.length - 1]] } as unknown as GrowingWall;
}

const cbs = (onCircuitComplete?: GameCallbacks["onCircuitComplete"]) =>
  ({ onCircuitComplete }) as unknown as GameCallbacks;

function dormant(id: string, x: number, y: number, reserve: number[]): Ball {
  return {
    id, position: { x, y }, velocity: { x: 0, y: 0 }, radius: 12, speed: 0,
    baseSpeed: 200, topSpeed: 200, state: "dormant", dormantReserveCells: reserve, regionId: "r",
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
    spaceGrid: { keepActive: new Uint8Array(16) },
  } as unknown as CanvasGameState;
}

describe("booting dormant balls", () => {
  it("lighting a terminal wakes exactly its ball and releases its reserved pocket", () => {
    const c = makeCircuit();
    const d0 = dormant("d0", 100, 100, [1, 2]);
    const d1 = dormant("d1", 300, 300, [3, 4]);
    const game = makeGame(c, [d0, d1]);
    const keep = game.spaceGrid!.keepActive!;
    keep[1] = keep[2] = keep[3] = keep[4] = 1;

    let bootFired = 0;
    // A cut through terminal 0 at (100,100).
    tickCircuitOnCut(game, fence({ x: 100, y: 0 }, { x: 100, y: 200 }), cbs(() => { bootFired++; }));

    expect(c.terminals[0].lit).toBe(true);
    expect(d0.state).toBe("active");
    expect(d0.speed).toBeGreaterThan(0);
    expect(Math.hypot(d0.velocity.x, d0.velocity.y)).toBeGreaterThan(0);
    expect(keep[1]).toBe(0); // d0's reserve released
    expect(keep[2]).toBe(0);
    expect(bootFired).toBe(1);

    // Terminal 1 / ball d1 untouched.
    expect(c.terminals[1].lit).toBe(false);
    expect(d1.state).toBe("dormant");
    expect(keep[3]).toBe(1); // d1 still reserves its pocket
  });

  it("a fence that misses every terminal wakes nothing", () => {
    const c = makeCircuit();
    const d0 = dormant("d0", 100, 100, [1]);
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
    const d0 = dormant("d0", 100, 150, [1]);
    const d1 = dormant("d1", 400, 150, [2]);
    const game = makeGame(c, [d0, d1]);
    tickCircuitOnCut(game, fence({ x: 0, y: 150 }, { x: 500, y: 150 }), cbs());
    expect(d0.state).toBe("active");
    expect(d1.state).toBe("active");
  });

  it("re-lighting a lit terminal, or a fully-lit circuit, is a no-op", () => {
    const c = makeCircuit();
    c.terminals[0].lit = true;
    const d0 = dormant("d0", 100, 100, [1]); d0.state = "active"; // already booted
    const d1 = dormant("d1", 300, 300, [2]);
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
});
