/**
 * The launcher shell dematerializes once the last ball has left.
 *
 * Three things have to hold:
 *
 *   THE SHELL LEAVES THE MODEL THE FRAME THE BARREL ARMS. Its slabs are gone
 *     from obstaclePolygons, its walls from game.walls, and the ground it stood
 *     on is active space again. Otherwise every launcher map keeps a dead
 *     three-sided box for the rest of the level.
 *   IT LEAVES EXACTLY ONCE. `dematerialized` latches like `armed`; a barrel
 *     torn down twice would reopen cells that are already open and inflate the
 *     percentage baseline.
 *   THE PICTURE RUNS DOWN THE BARREL. Sections are released muzzle end first
 *     and the back wall last, on a fixed beat, and they sit on the slabs they
 *     stand in for, turned barrel included.
 */
import { describe, it, expect, vi } from "vitest";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { setRunSeedText } from "@/lib/runRng";
import { fireLauncher, updateLauncherArming, type LauncherState } from "@/lib/physics/launcher";
import {
  dematerializeArmedLaunchers, shellSections, shellShatter,
  SHELL_SECTION_STEP_MS, SHELL_TILE_FLIGHT_MS, shellShatterDurationMs,
} from "@/lib/physics/launcherShell";
import { BOX_WALL_THICKNESS } from "@/lib/gameConstants";
import { CellState, gridIndexToWorld } from "@/lib/spaceGrid";
import { pointInPolygon } from "@/lib/polygon";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { LaunchFacing } from "@/lib/launcher";

const CUP = { x: 300, y: 300, width: 120, height: 240 };

function build(facing: LaunchFacing = "up", angle?: number): CanvasGameState {
  setRunSeedText("launcher-shell-fixture");
  const level = {
    id: "launcher-shell-test", level: 1, name: "L", sizeThreshold: 30, expectedCuts: 4,
    points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 2,
    balls: [
      { id: "b1", type: "red", startX: 700, startY: 700 },
      { id: "b2", type: "red", startX: 720, startY: 700 },
    ],
    entities: [{ id: "cup", kind: "launcher", shape: "rect", ...CUP, facing, angle }],
  } as unknown as LevelConfig;
  const data = createInitialGameData(level, 1, DEFAULT_MODIFIERS);
  setRunSeedText(null);
  return data as unknown as CanvasGameState;
}

function callbacks() {
  return { repaintRegionCanvas: vi.fn(), setRemainingPercent: vi.fn() };
}

/** Fire the cup and carry every ball well clear of it, so the next arming pass latches. */
function emptyTheBarrel(game: CanvasGameState): LauncherState {
  const cup = game.launchers![0];
  const fired = fireLauncher(game, cup, { direction: { x: 0, y: -1 }, power: 1 });
  expect(fired).not.toBeNull();
  for (const b of game.balls) {
    b.position = { x: 750, y: 750 };
  }
  updateLauncherArming(game);
  expect(cup.armed).toBe(true);
  return cup;
}

const shellWalls = (game: CanvasGameState) => game.walls.filter(w => w.id.startsWith("launcher-cup-"));
const activeCells = (game: CanvasGameState) =>
  game.spaceGrid!.cells.reduce((n, c) => n + (c === CellState.ACTIVE ? 1 : 0), 0);

describe("the shell leaves the model the frame the barrel arms", () => {
  it("starts as three slabs and twelve walls, all recorded on the barrel", () => {
    const game = build();
    const cup = game.launchers![0];
    expect(cup.shell).toHaveLength(3);
    expect(cup.dematerialized).toBe(false);
    for (const poly of cup.shell!) {
      expect(game.obstaclePolygons).toContain(poly);
    }
    expect(shellWalls(game)).toHaveLength(12);
  });

  it("removes the slabs, the walls and reopens the footprint once armed", () => {
    const game = build();
    const before = activeCells(game);
    const cup = emptyTheBarrel(game);
    const cb = callbacks();

    dematerializeArmedLaunchers(game, cb, 1000);

    expect(cup.dematerialized).toBe(true);
    for (const poly of cup.shell!) {
      expect(game.obstaclePolygons).not.toContain(poly);
    }
    expect(shellWalls(game)).toHaveLength(0);
    // Every cell the slabs stood on is playable again. Asserted as a PROPERTY
    // rather than a cell count: the count used to be calibrated against the fat
    // seal ring createSpaceGrid drew around each obstacle, so tightening that
    // seal moved a number that was never about the shell.
    for (const poly of cup.shell!) {
      for (let i = 0; i < game.spaceGrid!.cells.length; i++) {
        if (!pointInPolygon(gridIndexToWorld(game.spaceGrid!, i), poly)) continue;
        expect(game.spaceGrid!.cells[i]).toBe(CellState.ACTIVE);
      }
    }
    // And it is real ground, not a rounding: three slabs 18 thick, two of them
    // 240 long and one 120, is dozens of 15-unit cells however it is sealed.
    expect(activeCells(game)).toBeGreaterThan(before + 80);
    expect(cb.repaintRegionCanvas).toHaveBeenCalled();
    expect(cb.setRemainingPercent).toHaveBeenCalled();
    // The picture is queued for the renderer.
    expect(game.shellShatters).toHaveLength(1);
  });

  it("keeps the remaining percentage at or under 100 after the ground comes back", () => {
    const game = build();
    emptyTheBarrel(game);
    const cb = callbacks();
    dematerializeArmedLaunchers(game, cb, 1000);
    const percent = cb.setRemainingPercent.mock.calls.at(-1)![0] as number;
    expect(percent).toBeLessThanOrEqual(100);
  });

  it("leaves an unfired barrel, and a fired one still draining, alone", () => {
    const game = build();
    const cup = game.launchers![0];
    const cb = callbacks();
    dematerializeArmedLaunchers(game, cb, 1000);
    expect(cup.dematerialized).toBe(false);
    expect(shellWalls(game)).toHaveLength(12);

    fireLauncher(game, cup, { direction: { x: 0, y: -1 }, power: 1 });
    updateLauncherArming(game);   // the balls have not moved: still inside
    expect(cup.armed).toBe(false);
    dematerializeArmedLaunchers(game, cb, 1000);
    expect(cup.dematerialized).toBe(false);
    expect(shellWalls(game)).toHaveLength(12);
    expect(cb.repaintRegionCanvas).not.toHaveBeenCalled();
  });
});

describe("it leaves exactly once", () => {
  it("does nothing on the second pass", () => {
    const game = build();
    emptyTheBarrel(game);
    const cb = callbacks();
    dematerializeArmedLaunchers(game, cb, 1000);
    const baseline = game.spaceGrid!.initialActiveCount;
    const active = activeCells(game);

    dematerializeArmedLaunchers(game, cb, 1016);

    expect(game.spaceGrid!.initialActiveCount).toBe(baseline);
    expect(activeCells(game)).toBe(active);
    expect(game.shellShatters).toHaveLength(1);
    expect(cb.repaintRegionCanvas).toHaveBeenCalledTimes(1);
  });

  it("culls the picture once its last tile has faded", () => {
    const game = build();
    emptyTheBarrel(game);
    const cb = callbacks();
    dematerializeArmedLaunchers(game, cb, 1000);
    const total = shellShatterDurationMs(game.shellShatters[0]);
    dematerializeArmedLaunchers(game, cb, 1000 + total - 1);
    expect(game.shellShatters).toHaveLength(1);
    dematerializeArmedLaunchers(game, cb, 1000 + total);
    expect(game.shellShatters).toHaveLength(0);
  });

  it("latches a hand-built barrel with no shell recorded, removing nothing", () => {
    const cup: LauncherState = {
      id: "bare", inner: { x: 100, y: 100, width: 100, height: 100 },
      facing: "up", ballIds: [], fired: true, armed: true,
    };
    const game = { launchers: [cup], obstaclePolygons: [], walls: [], shellShatters: [] } as unknown as CanvasGameState;
    const cb = callbacks();
    dematerializeArmedLaunchers(game, cb, 0);
    expect(cup.dematerialized).toBe(true);
    expect(game.shellShatters).toHaveLength(0);
    expect(cb.repaintRegionCanvas).not.toHaveBeenCalled();
  });
});

describe("the picture runs down the barrel", () => {
  const inner = { x: CUP.x + BOX_WALL_THICKNESS, y: CUP.y + BOX_WALL_THICKNESS,
    width: CUP.width - 2 * BOX_WALL_THICKNESS, height: CUP.height - 2 * BOX_WALL_THICKNESS };

  it("releases the muzzle end first and the back wall last", () => {
    const sections = shellSections({ inner, facing: "up" });
    // Two long sides in six pieces each, and the back wall in three.
    expect(sections).toHaveLength(15);
    const first = sections[0];
    const last = sections[sections.length - 1];
    expect(first.beat).toBe(0);
    expect(first.rect.y).toBe(CUP.y);                  // top of a barrel facing up: the muzzle end
    expect(last.rect.y).toBe(CUP.y + CUP.height - BOX_WALL_THICKNESS); // the back wall
    // The back wall's pieces all share the final beat.
    const backBeats = sections.filter(s => s.rect.height === BOX_WALL_THICKNESS).map(s => s.beat);
    expect(new Set(backBeats).size).toBe(1);
    expect(backBeats[0]).toBe(6);
    // Mirrored pieces of the two long sides share a beat, so the run-down is
    // symmetric rather than alternating left, right, left.
    const beats = sections.filter(s => s.rect.width === BOX_WALL_THICKNESS).map(s => s.beat);
    expect(beats).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("points every section's outward vector away from the barrel's axis", () => {
    for (const s of shellSections({ inner, facing: "right" })) {
      const cx = s.rect.x + s.rect.width / 2 - (CUP.x + CUP.width / 2);
      const cy = s.rect.y + s.rect.height / 2 - (CUP.y + CUP.height / 2);
      expect(cx * s.outward.x + cy * s.outward.y).toBeGreaterThan(0);
    }
  });

  it("spaces the beats by the step and sits each section on its slab", () => {
    const cup: LauncherState = { id: "cup", inner, facing: "up", ballIds: [], fired: true, armed: true };
    const s = shellShatter(cup, 500);
    expect(s.startTime).toBe(500);
    expect(s.flightMs).toBe(SHELL_TILE_FLIGHT_MS);
    const delays = [...new Set(s.sections.map(x => x.delay))].sort((a, b) => a - b);
    expect(delays).toEqual([0, 1, 2, 3, 4, 5, 6].map(b => b * SHELL_SECTION_STEP_MS));
    // Every section is a rect inside the barrel's outer bounds, and every tile
    // sits inside its section.
    for (const sec of s.sections) {
      expect(sec.vertices).toHaveLength(4);
      for (const v of sec.vertices) {
        expect(v.x).toBeGreaterThanOrEqual(CUP.x - 1e-6);
        expect(v.x).toBeLessThanOrEqual(CUP.x + CUP.width + 1e-6);
        expect(v.y).toBeGreaterThanOrEqual(CUP.y - 1e-6);
        expect(v.y).toBeLessThanOrEqual(CUP.y + CUP.height + 1e-6);
      }
      expect(sec.tiles.length).toBeGreaterThan(0);
      const xs = sec.vertices.map(v => v.x);
      const ys = sec.vertices.map(v => v.y);
      for (const t of sec.tiles) {
        expect(t.x).toBeGreaterThan(Math.min(...xs));
        expect(t.x).toBeLessThan(Math.max(...xs));
        expect(t.y).toBeGreaterThan(Math.min(...ys));
        expect(t.y).toBeLessThan(Math.max(...ys));
      }
    }
  });

  it("turns with the barrel", () => {
    // A quarter turn about the centre: the 120 x 240 barrel now spans 240 x 120.
    const cup: LauncherState = { id: "cup", inner, facing: "up", angle: 90, ballIds: [], fired: true, armed: true };
    const s = shellShatter(cup, 0);
    const xs = s.sections.flatMap(sec => sec.vertices.map(v => v.x));
    const ys = s.sections.flatMap(sec => sec.vertices.map(v => v.y));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(CUP.height, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(CUP.width, 6);
    // And the picture sits exactly on the slabs the model built for it: the
    // turned barrel's real footprint is the same box.
    const game = build("up", 90);
    const sx = game.launchers![0].shell!.flatMap(p => p.vertices.map(v => v.x));
    expect(Math.min(...sx)).toBeCloseTo(Math.min(...xs), 6);
    expect(Math.max(...sx)).toBeCloseTo(Math.max(...xs), 6);
  });

  it("is deterministic for a given barrel", () => {
    const cup: LauncherState = { id: "cup", inner, facing: "left", ballIds: [], fired: true, armed: true };
    expect(shellShatter(cup, 0)).toEqual(shellShatter(cup, 0));
  });
});

/**
 * The helpers above are inert unless the game actually calls them. Source-level
 * pins, the same way launcherLock.test.ts holds the arming call in place.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("the teardown is wired in, not just defined", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("runs right after arming in the game loop", () => {
    const loop = read("src/hooks/useGameLoop.ts");
    const at = loop.indexOf("updateLauncherArming(game);");
    expect(at).toBeGreaterThan(-1);
    expect(loop.slice(at, at + 400)).toContain("callbacks.settleLaunchers?.()");
  });

  it("is what the canvas hands the loop for that call", () => {
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toMatch(/settleLaunchers: \(\) =>\s*dematerializeArmedLaunchers\(game, \{ repaintRegionCanvas, setRemainingPercent \}/);
  });

  it("runs right after arming in the headless harness too", () => {
    const harness = read("src/lib/bot/headlessGame.ts");
    const at = harness.indexOf("updateLauncherArming(game);");
    expect(at).toBeGreaterThan(-1);
    expect(harness.slice(at, at + 600)).toContain("dematerializeArmedLaunchers(game, callbacks");
  });
});
