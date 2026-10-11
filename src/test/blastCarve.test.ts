/**
 * A bomb blast taking a bite out of the board (physics/blastCarve.ts):
 * "make them able to blast holes in walls. Also, from now on, a locked off
 * area is considered one big wall, so blowing up part of it takes a chunk of
 * it." Walls means fences AND the map's own walls; a locked off area means any
 * captured ground.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { carveBlast, carvableObstacles } from "@/lib/physics/blastCarve";
import { CellState, getRemainingPercent, rasterizeCutToGrid, worldToGridIndex } from "@/lib/spaceGrid";
import { pointInPolygon, polygonCentroid, pointToSegmentDistance } from "@/lib/polygon";
import { resetMapIds } from "@/lib/gameUtils";
import { DEFAULT_SHARD_BOMB_CONFIG } from "@/lib/bombCore";
import { processDestroysFn, registerObjectHit } from "@/lib/physics/destructibles";
import { setRunSeedText } from "@/lib/runRng";
import type { LevelData, LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { Wall } from "@/lib/wallGeometry";

const read = (p: string) => readFileSync(p, "utf8");
const LEVELS = (yaml.load(read("public/map.yml")) as LevelData).levels;

function build(n: number): CanvasGameState {
  resetMapIds();
  const level = LEVELS.find(l => l.level === n) as LevelConfig;
  const game = createInitialGameData(level, level.level, DEFAULT_MODIFIERS) as unknown as CanvasGameState;
  const g = game as unknown as Record<string, unknown>;
  for (const k of ["objectDebris", "pendingDestroys", "deliveryBoxes", "launchers", "phasingObjects"]) g[k] ??= [];
  for (const b of game.balls) { b.state = "active"; b.speed = 200; }
  return game;
}

/** A fence the player drew, rasterized into the grid as a real cut is. */
function fence(game: CanvasGameState, x1: number, y1: number, x2: number, y2: number): Wall {
  const w: Wall = { id: `wall-test-${x1}-${y1}`, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 6, createdAt: 1, fenceTypeId: "standard" };
  w.rasterCells = rasterizeCutToGrid(game.spaceGrid!, w.start, w.end, 6);
  game.walls = [...game.walls, w];
  return w;
}

/** Claim every live cell right of `x`, as a capture would; put the balls left of it. */
function claimRightOf(game: CanvasGameState, x: number) {
  const grid = game.spaceGrid!;
  for (let i = 0; i < grid.cells.length; i++) {
    const col = i % grid.width;
    const cx = grid.originX + (col + 0.5) * grid.cellSize;
    if (cx > x && grid.cells[i] === CellState.ACTIVE) { grid.cells[i] = CellState.REMOVED; grid.activeCount--; }
  }
  game.balls.forEach((b, i) => { b.position = { x: 150, y: 200 + i * 60 }; });
}

const cellAt = (game: CanvasGameState, x: number, y: number) => game.spaceGrid!.cells[worldToGridIndex(game.spaceGrid!, x, y)];

describe("the blast reaches further", () => {
  it("is 100 now", () => {
    expect(DEFAULT_SHARD_BOMB_CONFIG.blastRadius).toBe(100);
    expect(read("public/game-config.yml")).toMatch(/\n\s+blast_radius: 100\n/);
  });

  it("and every shard bomb carves as it goes up", () => {
    expect(read("src/lib/physics/destructibles.ts")).toContain("opened += carveBlast(game, polygonCentroid(poly), game.shardBombBlast.radius).opened;");
  });
});

describe("a fence in the blast", () => {
  it("is cut in two, and nothing of it is left inside the hole", () => {
    const game = build(1);
    const f = fence(game, 200, 450, 700, 450);
    const r = carveBlast(game, { x: 450, y: 450 }, 100);
    expect(r.fencesCut).toBe(1);
    expect(game.walls.includes(f)).toBe(false);
    const pieces = game.walls.filter(w => w.start.y === 450 && w.end.y === 450 && !w.id.startsWith("obstacle-") && !w.id.startsWith("board-"));
    expect(pieces).toHaveLength(2);
    for (const p of pieces) {
      expect(pointToSegmentDistance({ x: 450, y: 450 }, p.start, p.end)).toBeGreaterThan(95);
      expect(p.id).not.toBe(f.id);
    }
  });

  it("gives back the fence's band inside the hole", () => {
    const game = build(1);
    fence(game, 200, 450, 700, 450);
    expect(cellAt(game, 450, 450)).toBe(CellState.REMOVED);
    carveBlast(game, { x: 450, y: 450 }, 100);
    expect(cellAt(game, 450, 450)).toBe(CellState.ACTIVE);
  });
});

describe("a map wall in the blast", () => {
  it("loses the part inside the circle, and keeps the rest as solids with walls of their own", () => {
    const game = build(10);
    const pillar = carvableObstacles(game).find(o => o.id === "pillar")!;
    expect(pillar).toBeTruthy();
    const c = polygonCentroid(pillar.polygon);
    // Blast centred off the pillar's middle, so a piece of it survives.
    const at = { x: c.x + 60, y: c.y };
    const r = carveBlast(game, at, 60);
    expect(r.wallsCarved).toBe(1);
    expect(game.obstaclePolygons.includes(pillar.polygon)).toBe(false);
    expect(game.walls.some(w => w.id.startsWith("obstacle-pillar-edge-"))).toBe(false);
    const pieces = game.stackObjects.filter(s => s.id.startsWith("pillar~b"));
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) {
      expect(game.obstaclePolygons).toContain(p.polygon);
      expect(game.walls.some(w => w.id === `obstacle-${p.id}-edge-0`)).toBe(true);
      // Nothing of a piece stands inside the blast.
      for (const v of p.polygon.vertices) expect(Math.hypot(v.x - at.x, v.y - at.y)).toBeGreaterThan(59);
    }
    // The renderers' obstacle caches are told.
    expect(game.obstacleVersion).toBe(1);
  });

  it("never touches the board's edge, a destructible or a mirror", () => {
    const game = build(13);
    const before = { mirrors: game.mirrorPolygons.length, board: game.walls.filter(w => w.id.startsWith("board-")).length };
    const m = game.mirrorPolygons[0];
    carveBlast(game, polygonCentroid(m), 120);
    expect(game.mirrorPolygons).toHaveLength(before.mirrors);
    expect(game.mirrorPolygons[0]).toBe(m);
    expect(game.walls.filter(w => w.id.startsWith("board-")).length).toBe(before.board);
    const ids = carvableObstacles(build(7)).map(o => o.id);
    expect(ids.some(id => id.startsWith("chest") || id.startsWith("partition"))).toBe(false);
  });
});

describe("claimed ground is one big wall", () => {
  it("a blast through the fence opens a chunk of it, which counts against the cleared %", () => {
    const game = build(1);
    fence(game, 450, 45, 450, 855);
    claimRightOf(game, 452);
    const before = getRemainingPercent(game.spaceGrid!);
    expect(cellAt(game, 500, 450)).toBe(CellState.REMOVED);
    const r = carveBlast(game, { x: 450, y: 450 }, 100);
    expect(r.opened).toBeGreaterThan(0);
    expect(cellAt(game, 500, 450)).toBe(CellState.ACTIVE);
    // Cleared ground handed back: the remaining % went UP.
    expect(getRemainingPercent(game.spaceGrid!)).toBeGreaterThan(before);
  });

  it("and the hole in it has sides: the crater's edge is walled where claimed ground goes on", () => {
    const game = build(1);
    fence(game, 450, 45, 450, 855);
    claimRightOf(game, 452);
    const r = carveBlast(game, { x: 450, y: 450 }, 100);
    expect(r.rimWalls).toBeGreaterThan(0);
    const rims = game.walls.slice(-r.rimWalls);
    for (const w of rims) {
      const mx = (w.start.x + w.end.x) / 2, my = (w.start.y + w.end.y) / 2;
      // On the circle, and only on the claimed side of the old fence.
      expect(Math.hypot(mx - 450, my - 450)).toBeGreaterThan(95);
      expect(mx).toBeGreaterThan(450);
    }
  });

  it("a chunk blown out with no way in closes straight back up", () => {
    const game = build(1);
    fence(game, 450, 45, 450, 855);
    claimRightOf(game, 452);
    const before = game.spaceGrid!.activeCount;
    const r = carveBlast(game, { x: 700, y: 450 }, 100);
    expect(cellAt(game, 700, 450)).toBe(CellState.REMOVED);
    expect(game.spaceGrid!.activeCount).toBe(before);
    expect(r.rimWalls).toBe(0);
  });

  it("a map wall's footprint is new ground, not ground the player lost", () => {
    const game = build(10);
    const pillar = carvableObstacles(game).find(o => o.id === "pillar")!;
    const initial = game.spaceGrid!.initialActiveCount;
    carveBlast(game, polygonCentroid(pillar.polygon), 80);
    expect(game.spaceGrid!.initialActiveCount).toBeGreaterThan(initial);
  });

  it("never hands back a gate's sealed ground", () => {
    const game = build(8);
    const gate = game.destructibles.find(d => (d.sealedCells?.length ?? 0) > 0)!;
    expect(gate).toBeTruthy();
    const i = gate.sealedCells![Math.floor(gate.sealedCells!.length / 2)];
    const grid = game.spaceGrid!;
    const col = i % grid.width, row = (i - col) / grid.width;
    const p = { x: grid.originX + (col + 0.5) * grid.cellSize, y: grid.originY + (row + 0.5) * grid.cellSize };
    carveBlast(game, p, 100);
    for (const s of gate.sealedCells!) expect(grid.cells[s]).toBe(CellState.REMOVED);
  });

  it("solids next to the hole keep their seal in the grid", () => {
    const game = build(13);
    const m = game.mirrorPolygons[0];
    carveBlast(game, polygonCentroid(m), 120);
    const grid = game.spaceGrid!;
    for (const v of m.vertices) {
      const i = worldToGridIndex(grid, v.x, v.y);
      if (i >= 0 && pointInPolygon(v, game.boardPolygon!)) expect(grid.cells[i]).toBe(CellState.REMOVED);
    }
  });
});

describe("both phones carve the same board", () => {
  it("the same blast on the same board gives the same walls and the same ground", () => {
    const once = () => {
      const game = build(10);
      fence(game, 200, 300, 700, 300);
      carveBlast(game, { x: 430, y: 330 }, 100);
      return {
        walls: game.walls.map(w => `${w.id}:${w.start.x.toFixed(3)},${w.start.y.toFixed(3)}-${w.end.x.toFixed(3)},${w.end.y.toFixed(3)}`),
        cells: Array.from(game.spaceGrid!.cells).join(""),
      };
    };
    expect(once()).toEqual(once());
  });
});

describe("the claimed area stays claimed when the hole does not open", () => {
  // Found in a real build: a bomb beside the player's fence, its crater on the
  // claimed side too narrow to reach, so the crater closed back up - but the
  // fence stayed cut, and the bricks the blast broke a frame later handed back
  // their "shadow" through the gap: the WHOLE claimed side came back live.
  it.each(["s1", "s2", "s3"])("the bomb, then its neighbours a frame later (seed %s)", (seed) => {
    setRunSeedText(seed);
    try {
      const game = build(6);
      const g = game as unknown as Record<string, unknown>;
      for (const k of ["fallingObjects"]) g[k] ??= [];
      g.assimilations = new Map(); g.breakBonus = 0; g.breakMultiplier = 1; g.objectivesBroken = 0;
      game.shardBombBlast = { radius: 100, damage: 1.5 };
      for (const b of game.balls) b.position = { x: 120, y: 820 };
      const bomb = game.destructibles.find(d => d.id === "tooth-r2b")!;
      bomb.shardBomb = true;
      const X = polygonCentroid(bomb.obstaclePolygon!).x + 40;
      fence(game, X, 45, X, 855);
      const grid = game.spaceGrid!;
      let claimed = 0;
      for (let i = 0; i < grid.cells.length; i++) {
        const x = grid.originX + ((i % grid.width) + 0.5) * grid.cellSize;
        if (x > X && grid.cells[i] === CellState.ACTIVE) { grid.cells[i] = CellState.REMOVED; grid.activeCount--; claimed++; }
      }
      registerObjectHit(game, bomb, "b1", 10_000, 1);
      for (let f = 0; f < 4; f++) processDestroysFn(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} }, 6);
      let live = 0;
      for (let i = 0; i < grid.cells.length; i++) {
        const x = grid.originX + ((i % grid.width) + 0.5) * grid.cellSize;
        if (x > X + 8 && grid.cells[i] === CellState.ACTIVE) live++;
      }
      // At most the crater's own chunk comes back; never the claimed side.
      expect(live).toBeLessThan(claimed * 0.05);
    } finally {
      setRunSeedText(null);
    }
  });
});

describe("a brick straddling the crater's edge", () => {
  it("does not leave a gap in the rim for the claimed ground to flood through when it breaks", () => {
    const game = build(1);
    const g = game as unknown as Record<string, unknown>;
    g.fallingObjects ??= []; g.assimilations = new Map(); g.breakBonus = 0; g.breakMultiplier = 1; g.objectivesBroken = 0;
    fence(game, 450, 45, 450, 855);
    claimRightOf(game, 452);
    // A one-touch brick sitting across the crater's edge on the claimed side.
    const brick = { vertices: [{ x: 546, y: 425 }, { x: 562, y: 425 }, { x: 562, y: 475 }, { x: 546, y: 475 }] };
    game.obstaclePolygons = [...game.obstaclePolygons, brick];
    game.destructibles = [...game.destructibles, { id: "brick-x", kind: "breakable", hits: 0, maxHits: 1, lastHitAt: 0, destroyed: false, brittle: true, obstaclePolygon: brick }];
    const grid = game.spaceGrid!;
    const claimedBefore = grid.cells.length - grid.activeCount;
    carveBlast(game, { x: 450, y: 450 }, 100);
    registerObjectHit(game, game.destructibles.find(d => d.id === "brick-x")!, "b1", 10_000, 1);
    processDestroysFn(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} }, 1);
    let live = 0;
    for (let i = 0; i < grid.cells.length; i++) {
      const col = i % grid.width, row = (i - col) / grid.width;
      const x = grid.originX + (col + 0.5) * grid.cellSize, y = grid.originY + (row + 0.5) * grid.cellSize;
      if (x > 452 && Math.hypot(x - 450, y - 450) > 130 && grid.cells[i] === CellState.ACTIVE) live++;
    }
    // Beyond the crater and the brick, the claimed side is still claimed.
    expect(live).toBeLessThan(claimedBefore * 0.02);
  });
});
