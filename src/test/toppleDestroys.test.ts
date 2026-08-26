/**
 * Toppling a breakable must destroy it the same way smashing it does.
 *
 * There are two ways a breakable leaves the board and only one of them is a
 * destruction. A ball that spends its hit budget queues the object on
 * `pendingDestroys`, and `processDestroysFn` does the whole job: detach the
 * polygon and its edge walls, reopen the carved footprint, REOPEN THE SEALED
 * AREA IT WAS GATING, pay the break bonus, and grant a chest's reward.
 *
 * The other way is gravity. Smash the thing a stack is resting on and
 * `toppleSupportedBy` brings everything above it down - but that path only
 * detached the obstacle and set `destroyed = true` by hand. It never ran the
 * destruction. So a GATE breakable that came down with its supporter took its
 * sealed area to the grave: those cells stay REMOVED, nothing is left on the
 * board that could ever reopen them, and the player is looking at a patch of
 * ground where the gate visibly broke and the space behind it never arrived.
 * Dead, uncuttable, permanent. A toppled CHEST lost its reward outright.
 *
 * These are constructed maps rather than shipped ones: no map in map.yml
 * currently stacks a gate or a chest on top of a breakable, so this is a trap
 * laid for the next map that does, not a live bug. That is exactly when it is
 * cheap to fix.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { processDestroysFn } from "@/lib/physics/destructibles";
import { CellState, createSpaceGrid } from "@/lib/spaceGrid";
import type { CanvasGameState } from "@/types/gameState";
import type { DestructibleState, StackObject } from "@/types/game";
import type { Polygon } from "@/lib/polygon";

const rect = (x: number, y: number, w: number, h: number): Polygon => ({
  vertices: [
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
  ],
});

/**
 * A supporter with a gate breakable resting on it, and a sealed pocket that
 * only the gate can open.
 */
function stackedGate() {
  const basePoly = rect(200, 400, 80, 60);
  const gatePoly = rect(200, 340, 80, 50);

  // A REAL grid over a real board, not a hand-rolled stub: the destroy path
  // runs region rebuilds and reachability over this, and a stub that satisfies
  // today's field reads is a harness waiting to lie about tomorrow's.
  const board = rect(0, 0, 600, 600);
  const grid = createSpaceGrid(board, [basePoly, gatePoly, rect(320, 340, 60, 50)], 15);
  // The pocket the gate holds shut: a block of cells sealed off, exactly as
  // initGame marks a `reveals` area.
  const pocket = rect(60, 60, 120, 120);
  const sealedCells: number[] = [];
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const i = row * grid.width + col;
      if (grid.cells[i] !== CellState.ACTIVE) continue;
      const wx = grid.originX + col * grid.cellSize + grid.cellSize / 2;
      const wy = grid.originY + row * grid.cellSize + grid.cellSize / 2;
      if (wx >= pocket.vertices[0].x && wx <= pocket.vertices[1].x
        && wy >= pocket.vertices[0].y && wy <= pocket.vertices[2].y) {
        grid.cells[i] = CellState.REMOVED;
        grid.activeCount--;
        sealedCells.push(i);
      }
    }
  }

  const base: DestructibleState = {
    id: "base", kind: "breakable", hits: 2, maxHits: 2,
    destroyed: false, obstaclePolygon: basePoly,
  } as DestructibleState;
  const gate: DestructibleState = {
    id: "gate", kind: "breakable", hits: 0, maxHits: 2,
    destroyed: false, obstaclePolygon: gatePoly, sealedCells,
  } as DestructibleState;
  const chest: DestructibleState = {
    id: "chest", kind: "breakable", hits: 0, maxHits: 2,
    destroyed: false, obstaclePolygon: rect(320, 340, 60, 50), chest: true,
  } as DestructibleState;

  const stack: StackObject[] = [
    { id: "base", polygon: basePoly, supporterId: null, toppled: false } as StackObject,
    { id: "gate", polygon: gatePoly, supporterId: "base", toppled: false } as StackObject,
    { id: "chest", polygon: chest.obstaclePolygon!, supporterId: "base", toppled: false } as StackObject,
  ];

  const game = {
    destructibles: [base, gate, chest],
    stackObjects: stack,
    obstaclePolygons: [basePoly, gatePoly, chest.obstaclePolygon!],
    mirrorPolygons: [],
    walls: [],
    movers: [],
    // A live ball, because captureUnreachableCells treats a board with no
    // active ball as finished and removes EVERYTHING - which would swallow the
    // reopened pocket and make this test fail for a reason that has nothing to
    // do with toppling.
    balls: [{
      id: "b1", position: { x: 400, y: 120 }, velocity: { x: 100, y: 0 },
      radius: 12, speed: 100, state: "active", minimumSpeed: 100,
    }],
    regions: [],
    gridRegions: [],
    objectDebris: [],
    fallingObjects: [],
    pendingDestroys: [],
    breakBonus: 0,
    breakMultiplier: 1,
    objectivesBroken: 0,
    spaceGrid: grid,
    initialSamplePoints: [],
    boardPolygon: board,
  } as unknown as CanvasGameState;

  return { game, base, gate, chest, sealedCells };
}

const CB = { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} };

afterEach(() => { vi.restoreAllMocks(); });

describe("a breakable that is toppled, not smashed", () => {
  it("still reopens the area it was gating", () => {
    const { game, base, gate, sealedCells } = stackedGate();

    // Smash the SUPPORTER only. The gate comes down with it.
    base.destroyed = true;
    game.pendingDestroys.push(base);
    processDestroysFn(game, CB, 12);

    expect(gate.destroyed, "the gate did not come down at all").toBe(true);

    const grid = game.spaceGrid!;
    const stillSealed = sealedCells.filter(i => grid.cells[i] === CellState.REMOVED);
    expect(
      stillSealed.length,
      `${stillSealed.length}/${sealedCells.length} cells of the gated area are still locked,`
      + " with nothing left on the board that could ever open them",
    ).toBe(0);
  });

  it("still pays out a chest that came down with its supporter", () => {
    const { game, base } = stackedGate();
    const rewards: string[] = [];

    base.destroyed = true;
    game.pendingDestroys.push(base);
    processDestroysFn(game, { ...CB, onChestReward: id => rewards.push(id) }, 12);

    expect(rewards.length, "the chest broke and paid nothing").toBeGreaterThan(0);
  });

  it("still detaches the toppled object, as it always did", () => {
    // The half that already worked. It must keep working: this is what stops a
    // toppled slab from staying solid.
    const { game, base, gate } = stackedGate();
    base.destroyed = true;
    game.pendingDestroys.push(base);
    processDestroysFn(game, CB, 12);

    expect(game.obstaclePolygons).not.toContain(gate.obstaclePolygon);
    expect(game.stackObjects.find(s => s.id === "gate")?.toppled).toBe(true);
  });
});
