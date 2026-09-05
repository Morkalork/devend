/**
 * Breaking a wall gives back what the wall was holding shut, not just the
 * ground it stood on.
 *
 * Reported from a real session on level 7: one fence, and the space beyond the
 * breakable read as locked. Breaking the breakable did not give it back, and
 * the remaining-% went UP - because its own footprint reopened while the pocket
 * behind it stayed shut. Measured on the shipped map: 480 cells sealed off, 0
 * of them reopened by the break, remaining 81.6% -> 82.4%.
 *
 * The footprint reopening was only ever half the job. A wall that cuts a pocket
 * off is holding that whole pocket, and it stops holding it when it comes down.
 *
 * ── Why this cannot hand back earned captures ──────────────────────────────
 *
 * Two guards, and the second is the one that makes it safe. The flood stops at
 * anything genuinely holding ground shut - a player's fence (its grid band IS
 * the wall), the board edge, another solid - so it cannot cross INTO a pocket
 * the player sealed. And processDestroysFn runs captureUnreachableCells
 * immediately afterwards, which takes back every reopened cell no ball can
 * actually reach. So the only ground that stays open is ground that has
 * genuinely become playable again.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { processDestroysFn, floodSealedShadow } from "@/lib/physics/destructibles";
import { CellState } from "@/lib/spaceGrid";
import type { LevelConfig, LevelData } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { DestructibleState } from "@/types/game";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];

const CB = { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} };

afterEach(() => vi.restoreAllMocks());

function board(levelNumber: number) {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const level = LEVELS.find(l => l.level === levelNumber)!;
  const data = createInitialGameData(level, levelNumber, DEFAULT_MODIFIERS);
  return {
    ...data, activeWalls: [], objectDebris: [], pendingDestroys: [],
    chestLoot: [], pickups: [], pickupFeedback: [], coloredAreas: [],
  } as unknown as CanvasGameState;
}

const bounds = (d: DestructibleState) => {
  const vs = d.obstaclePolygon!.vertices;
  return {
    minX: Math.min(...vs.map(v => v.x)), maxX: Math.max(...vs.map(v => v.x)),
    minY: Math.min(...vs.map(v => v.y)), maxY: Math.max(...vs.map(v => v.y)),
  };
};

/** Mark a block of ACTIVE cells captured, standing in for a seal. */
function capture(game: CanvasGameState, pick: (x: number, y: number) => boolean): number[] {
  const grid = game.spaceGrid!;
  const taken: number[] = [];
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const i = row * grid.width + col;
      if (grid.cells[i] !== CellState.ACTIVE) continue;
      const x = grid.originX + col * grid.cellSize + grid.cellSize / 2;
      const y = grid.originY + row * grid.cellSize + grid.cellSize / 2;
      if (!pick(x, y)) continue;
      grid.cells[i] = CellState.REMOVED;
      grid.activeCount--;
      taken.push(i);
    }
  }
  return taken;
}

describe("the pocket a breakable was holding shut", () => {
  it("comes back when the breakable does down", () => {
    const game = board(7);
    const part = game.destructibles.find(d => d.id === "partition")!;
    const b = bounds(part);
    const grid = game.spaceGrid!;
    const shadow = capture(game, (x, y) =>
      x > b.maxX + grid.cellSize && y >= b.minY && y <= b.maxY);
    expect(shadow.length, "the fixture sealed nothing: has level 7 been re-cut?")
      .toBeGreaterThan(100);

    part.destroyed = true;
    game.pendingDestroys.push(part);
    processDestroysFn(game, CB, 7, DEFAULT_MODIFIERS);

    const back = shadow.filter(i => grid.cells[i] === CellState.ACTIVE).length;
    // Not all of it: the vault walls and the board edge hold some of that
    // ground on their own, and those are supposed to keep holding it.
    expect(back, "the ground behind the wall is still locked after breaking it")
      .toBeGreaterThan(shadow.length / 2);
  });

  it("does not cross a fence to reopen ground the player sealed", () => {
    // Asserted on the FLOOD, not on the board afterwards. Afterwards is no test
    // at all: captureUnreachableCells re-takes an unreachable pocket whether or
    // not the flood respected the fence, so the end state is identical either
    // way. A first version of this test asserted the board and passed with the
    // fence check deleted.
    //
    // It also has to detach the obstacle the way detachObstacle does before
    // seeding, or every seed cell reads as inside a solid and the flood goes
    // nowhere - which is the OTHER way this passes for the wrong reason.
    const game = board(7);
    const grid = game.spaceGrid!;
    const part = game.destructibles.find(d => d.id === "partition")!;
    const b = bounds(part);

    // Everything beyond the wall, captured.
    capture(game, x => x > b.maxX + grid.cellSize);
    const fenceX = b.maxX + grid.cellSize * 3;
    game.walls.push({
      id: "player-fence", start: { x: fenceX, y: 0 }, end: { x: fenceX, y: 900 },
      thickness: 6,
    } as never);

    // What detachObstacle does before it asks which cells to reopen.
    game.obstaclePolygons = game.obstaclePolygons.filter(p => p !== part.obstaclePolygon);
    game.walls = game.walls.filter(w => !w.id.startsWith("obstacle-partition-edge-"));

    const seed: number[] = [];
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== CellState.REMOVED) continue;
      const col = i % grid.width, row = (i - col) / grid.width;
      const x = grid.originX + col * grid.cellSize + grid.cellSize / 2;
      const y = grid.originY + row * grid.cellSize + grid.cellSize / 2;
      if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) seed.push(i);
    }
    expect(seed.length, "no footprint to flood from").toBeGreaterThan(10);

    const beyond = (i: number) => {
      const col = i % grid.width;
      return grid.originX + col * grid.cellSize + grid.cellSize / 2 > fenceX + grid.cellSize;
    };
    const reached = floodSealedShadow(game, grid, seed);
    expect(reached.filter(beyond).length,
      "the flood walked through a fence into ground the player had sealed").toBe(0);

    // And the flood is not simply inert: without the fence it reaches that same
    // ground, which is what makes the zero above mean something.
    const open = board(7);
    const openGrid = open.spaceGrid!;
    const openPart = open.destructibles.find(d => d.id === "partition")!;
    capture(open, x => x > b.maxX + openGrid.cellSize);
    open.obstaclePolygons = open.obstaclePolygons.filter(p => p !== openPart.obstaclePolygon);
    open.walls = open.walls.filter(w => !w.id.startsWith("obstacle-partition-edge-"));
    expect(floodSealedShadow(open, openGrid, seed).filter(beyond).length,
      "the flood reaches nothing even unfenced, so the test proves nothing").toBeGreaterThan(100);
  });

  it("still reopens the footprint itself", () => {
    // The half that already worked has to keep working: this change adds to
    // the reopen, it does not replace it.
    const game = board(7);
    const part = game.destructibles.find(d => d.id === "partition")!;
    const b = bounds(part);
    const grid = game.spaceGrid!;
    const centre = {
      x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2,
    };

    part.destroyed = true;
    game.pendingDestroys.push(part);
    processDestroysFn(game, CB, 7, DEFAULT_MODIFIERS);

    const col = Math.floor((centre.x - grid.originX) / grid.cellSize);
    const row = Math.floor((centre.y - grid.originY) / grid.cellSize);
    expect(grid.cells[row * grid.width + col], "the ground it stood on is still solid")
      .toBe(CellState.ACTIVE);
  });
});
