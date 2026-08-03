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
import { createSpaceGrid, captureUnreachableCells, isPositionActive, worldToGridIndex, CellState } from "@/lib/spaceGrid";
import { createRectPolygon } from "@/lib/polygon";
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

describe("opened vault stays cuttable even when unreachable (keep-active)", () => {
  // Isolate one 'vault' cell far from the ball so it's unreachable; the fix must
  // keep it ACTIVE (cuttable) so the player can fence into the bonus pocket.
  function isolatedVaultGrid() {
    const grid = createSpaceGrid(createRectPolygon(0, 0, 300, 300), [], 15);
    for (let i = 0; i < grid.cells.length; i++) grid.cells[i] = CellState.REMOVED;
    grid.activeCount = 0;
    const on = (x: number, y: number) => { const idx = worldToGridIndex(grid, x, y); grid.cells[idx] = CellState.ACTIVE; grid.activeCount++; return idx; };
    on(45, 45); // the ball's cell (reachable)
    const vaultIdx = on(255, 255); // an isolated cell (unreachable from the ball)
    return { grid, vaultIdx };
  }
  const ball = { position: { x: 45, y: 45 }, radius: 10, state: "active", speed: 60 };

  it("WITHOUT keep-active, an unreachable cell is recaptured (the reported bug)", () => {
    const { grid, vaultIdx } = isolatedVaultGrid();
    captureUnreachableCells(grid, [ball], []);
    expect(grid.cells[vaultIdx]).toBe(CellState.REMOVED); // sealed -> uncuttable
  });

  it("WITH keep-active, the vault cell stays ACTIVE and cuttable", () => {
    const { grid, vaultIdx } = isolatedVaultGrid();
    grid.keepActive = new Uint8Array(grid.cells.length);
    grid.keepActive[vaultIdx] = 1;
    captureUnreachableCells(grid, [ball], []);
    expect(grid.cells[vaultIdx]).toBe(CellState.ACTIVE);
    expect(isPositionActive(grid, { x: 255, y: 255 })).toBe(true); // a cut may start here
  });

  it("completing the circuit reopens its vault and marks it keep-active", () => {
    const grid = createSpaceGrid(createRectPolygon(0, 0, 300, 300), [], 15);
    const vaultIdx = worldToGridIndex(grid, 255, 255);
    grid.cells[vaultIdx] = CellState.REMOVED; grid.activeCount--; // sealed vault cell
    const c = makeCircuit({ revealCells: [vaultIdx] });
    const game = {
      circuit: c, lockZones: [], spaceGrid: grid, balls: [], regions: [], walls: [], initialSamplePoints: [],
    } as unknown as CanvasGameState;
    tickCircuitOnCut(game, fence({ x: 100, y: 0 }, { x: 100, y: 200 }), noopCallbacks);
    tickCircuitOnCut(game, fence({ x: 300, y: 200 }, { x: 300, y: 400 }), noopCallbacks);
    expect(c.complete).toBe(true);
    expect(grid.keepActive?.[vaultIdx]).toBe(1);     // protected on completion
    expect(grid.cells[vaultIdx]).toBe(CellState.ACTIVE); // reopened + kept (even with no ball)
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
