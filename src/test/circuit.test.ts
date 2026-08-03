/**
 * "Wire the Integration" circuit (circuit.ts): terminals lit by routing fences
 * through them, and the bonus vault opened on completion. A wrong hit test would
 * light the wrong terminals or never complete, so this pins the routing rule,
 * both trigger modes, and that completion turns the vault into a lock pocket.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({ playCutClaimedSound: () => {}, playLevelCompleteSound: () => {} }));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { tickCircuitOnCut } from "@/lib/physics/circuit";
import { bonusLockMultiplierAt } from "@/lib/lockZones";
import { rotateCircuit } from "@/lib/mapRotation";
import type { CanvasGameState, CircuitRuntime } from "@/types/gameState";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { GrowingWall, Vector2 } from "@/types/game";
import type { LevelData } from "@/types/level";

// A fence whose ONE grown half is the polyline `pts` (the other half is empty).
function fence(...pts: Vector2[]): GrowingWall {
  return { startWaypoints: pts, endWaypoints: [pts[pts.length - 1]] } as unknown as GrowingWall;
}

const noopCallbacks = {
  repaintRegionCanvas: () => {},
  setRemainingPercent: () => {},
  onCircuitComplete: () => {},
} as unknown as GameCallbacks;

function makeCircuit(overrides: Partial<CircuitRuntime> = {}): CircuitRuntime {
  return {
    terminals: [
      { x: 100, y: 100, radius: 20, lit: false },
      { x: 300, y: 300, radius: 20, lit: false },
    ],
    singleCut: false,
    complete: false,
    revealCells: [], // empty so completion skips the grid reopen (tested live)
    bonusZone: { x: 600, y: 600, width: 200, height: 200, multiplier: 2 },
    ...overrides,
  };
}

// spaceGrid null -> completeCircuit skips the reopen/recapture (that path is
// exercised live on the pilot map); the lit/complete/lockZone logic still runs.
function makeGame(circuit: CircuitRuntime | null): CanvasGameState {
  return { circuit, lockZones: [], spaceGrid: null } as unknown as CanvasGameState;
}

describe("cumulative trigger (default)", () => {
  it("lights a terminal a fence routes within radius of, one per cut, then completes", () => {
    const c = makeCircuit();
    const game = makeGame(c);

    // Cut 1 runs vertically through (100,100): lights terminal A only.
    tickCircuitOnCut(game, fence({ x: 100, y: 0 }, { x: 100, y: 200 }), noopCallbacks);
    expect(c.terminals[0].lit).toBe(true);
    expect(c.terminals[1].lit).toBe(false);
    expect(c.complete).toBe(false);

    // Cut 2 through (300,300): lights terminal B -> all lit -> complete.
    tickCircuitOnCut(game, fence({ x: 300, y: 200 }, { x: 300, y: 400 }), noopCallbacks);
    expect(c.terminals[1].lit).toBe(true);
    expect(c.complete).toBe(true);
  });

  it("completing pushes the bonus zone so the vault pays its lock multiplier", () => {
    const c = makeCircuit();
    const game = makeGame(c);
    tickCircuitOnCut(game, fence({ x: 100, y: 0 }, { x: 100, y: 200 }), noopCallbacks);
    tickCircuitOnCut(game, fence({ x: 300, y: 200 }, { x: 300, y: 400 }), noopCallbacks);
    // The revealed pocket now multiplies locks (bonusLockMultiplierAt is what
    // checkBallWonState uses), so no scoring change was needed.
    expect(bonusLockMultiplierAt(700, 700, game.lockZones)).toBe(2);
  });

  it("a fence that misses every terminal changes nothing", () => {
    const c = makeCircuit();
    const game = makeGame(c);
    tickCircuitOnCut(game, fence({ x: 800, y: 0 }, { x: 800, y: 900 }), noopCallbacks);
    expect(c.terminals.some(t => t.lit)).toBe(false);
    expect(c.complete).toBe(false);
  });

  it("is a no-op with no circuit or once complete", () => {
    expect(() => tickCircuitOnCut(makeGame(null), fence({ x: 0, y: 0 }, { x: 100, y: 0 }), noopCallbacks)).not.toThrow();
    const c = makeCircuit({ complete: true });
    const game = makeGame(c);
    tickCircuitOnCut(game, fence({ x: 100, y: 0 }, { x: 100, y: 200 }), noopCallbacks);
    expect(c.terminals[0].lit).toBe(false); // untouched: already complete
  });
});

describe("singleCut hard mode", () => {
  it("completes only when ONE fence threads every terminal", () => {
    // Terminals on a line at y=150; one straight cut through both completes it.
    const c = makeCircuit({
      singleCut: true,
      terminals: [
        { x: 100, y: 150, radius: 20, lit: false },
        { x: 400, y: 150, radius: 20, lit: false },
      ],
    });
    const game = makeGame(c);
    tickCircuitOnCut(game, fence({ x: 0, y: 150 }, { x: 500, y: 150 }), noopCallbacks);
    expect(c.complete).toBe(true);
  });

  it("does NOT persist a single-cut partial (threading one terminal lights nothing)", () => {
    const c = makeCircuit({
      singleCut: true,
      terminals: [
        { x: 100, y: 150, radius: 20, lit: false },
        { x: 400, y: 600, radius: 20, lit: false }, // off the line
      ],
    });
    const game = makeGame(c);
    tickCircuitOnCut(game, fence({ x: 0, y: 150 }, { x: 500, y: 150 }), noopCallbacks); // hits only the first
    expect(c.complete).toBe(false);
    expect(c.terminals.some(t => t.lit)).toBe(false); // nothing persists
  });
});

describe("config + rotation", () => {
  it("the level-8 pilot ships a well-formed circuit", () => {
    const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData;
    const l8 = doc.levels.find(l => l.id === "level-8")!;
    expect(l8.circuit).toBeDefined();
    expect(l8.circuit!.terminals.length).toBeGreaterThanOrEqual(2);
    expect(l8.circuit!.radius).toBeGreaterThan(0);
    expect(l8.circuit!.reveals.width).toBeGreaterThan(0);
  });

  it("rotateCircuit turns terminals + the reveal rect into the orientation", () => {
    const base = { terminals: [{ x: 100, y: 0 }], radius: 20, reveals: { x: 500, y: 0, width: 300, height: 40 } };
    expect(rotateCircuit(base, 0)).toBe(base); // no-op at 0
    const r = rotateCircuit(base, 1); // 90 left
    expect(r.terminals[0]).not.toEqual(base.terminals[0]);
    expect(r.reveals.width).toBeCloseTo(40);
    expect(r.reveals.height).toBeCloseTo(300);
  });
});
