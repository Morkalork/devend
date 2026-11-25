/**
 * A crack too thin for a ball is live ground, not claimed (spaceGrid.ts
 * captureUnreachableCells).
 *
 * Reported from play on map 3 as a lock artifact: a fence drawn under a slab
 * left a strip 33 units high, a ball is 36, and the capture claimed the strip's
 * middle, a stub of claimed colour sticking up out of the fence into the ball's
 * pocket. Ground no ball can reach is still claimed when it is a ROOM (it has
 * somewhere a ball fits); a CRACK that opens onto live ground stays live.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { setActiveRuleSet } from "@/lib/cardRules";
import { setActiveRoster } from "@/lib/roster";
import { CellState, worldToGridIndex, captureUnreachableCells, type SpaceGrid } from "@/lib/spaceGrid";
import type { LevelConfig } from "@/types/level";
import { LADDER, byLevel } from "./fixtures/maps";

afterEach(() => {
  releaseClock();
  setActiveRuleSet("classic");
});

describe("the strip between a fence and a slab", () => {
  it("stays live when it is too thin for a ball (map 3, as reported)", () => {
    setActiveRuleSet("tree");
    setActiveRoster([{ slot: 1, rungs: { weight: 1 } }]);
    installClock();
    setRunSeedText("crack");
    const level = { ...(byLevel(LADDER, 3) as LevelConfig), timeLimit: 300 } as LevelConfig;
    const ctx = createBotGame(level, 3, plainModifiers({ spawnFreezeSeconds: 9999 }), { lives: 3 });
    const g = ctx.game;
    g.balls[0].position = { x: 220, y: 110 };
    // The screenshot's fences: a slant down the board, then one across just
    // under the top-left slab (its underside is at y 310; the fence at 346).
    const d = { x: -185, y: 790 };
    const n = Math.hypot(d.x, d.y);
    expect(tryCut(ctx, { x: 380, y: 444 }, { x: d.x / n, y: d.y / n })).toBe(true);
    for (let k = 0; g.activeWalls.length > 0 && k < 3000; k++) {
      stepBot(ctx);
    }
    expect(tryCut(ctx, { x: 120, y: 346 }, { x: 1, y: 0 })).toBe(true);
    for (let k = 0; g.activeWalls.length > 0 && k < 3000; k++) {
      stepBot(ctx);
    }
    const grid = g.spaceGrid!;
    for (const x of [195, 225, 255]) {
      expect(grid.cells[worldToGridIndex(grid, x, 322)], `the strip under the slab at x ${x}`).toBe(CellState.ACTIVE);
    }
    // Below the fence is the player's: claimed as ever.
    expect(grid.cells[worldToGridIndex(grid, 225, 400)]).toBe(CellState.REMOVED);
  });
});

describe("a room behind a doorway too narrow for a ball", () => {
  it("is still claimed", () => {
    // A bare grid: a 10x10-cell room walled off from a 10x10-cell field but
    // for a doorway one cell wide. The ball is in the field and cannot fit the
    // doorway; the room has space for a ball inside it.
    const cell = 15;
    const width = 23, height = 10;
    const cells = new Uint8Array(width * height).fill(CellState.ACTIVE);
    for (let row = 0; row < height; row++) {
      if (row !== 5) {
        cells[row * width + 11] = CellState.REMOVED;
      }
    }
    const grid = {
      width, height, cellSize: cell, originX: 0, originY: 0, cells,
      activeCount: cells.filter(c => c === CellState.ACTIVE).length,
      cellRegionIds: new Array(width * height).fill(""),
    } as unknown as SpaceGrid;
    captureUnreachableCells(grid, [{ position: { x: 5 * cell, y: 5 * cell }, radius: 18, state: "active", speed: 100 }]);
    // The room, every cell of it past the doorway's mouth (which the ball's
    // own reach, one radius past where its centre can go, already covers).
    for (let row = 0; row < height; row++) {
      for (let col = 14; col < width; col++) {
        expect(cells[row * width + col], `room cell ${row},${col}`).toBe(CellState.REMOVED);
      }
    }
    expect(cells[5 * width + 4]).toBe(CellState.ACTIVE);
  });
});
