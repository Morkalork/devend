/**
 * Legacy Systems, the bosses of the brick ladder (BOSS_PLAN.md), and the first
 * of them, The Monolith (map 5).
 *
 * The boss is the board: a Core to break (a slab, `level.boss.core`) inside a
 * Shell of bricks, defending itself with telegraphed incidents that are map
 * beats. A Patch rebuilds the Shell on a timer (`everySeconds` + `restore`); a
 * Rollback blasts fences and claimed ground away from the Core once it is
 * half broken (`atHitsOn` + `rollback`). The nameplate's health is the Core's
 * hits left (followCoreHealth).
 */
import { describe, it, expect, afterEach } from "vitest";
import { createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { setActiveRuleSet } from "@/lib/cardRules";
import { setActiveRoster } from "@/lib/roster";
import { restoreBrick, tickMapBeats, beatEffectLines } from "@/lib/physics/mapBeats";
import { followCoreHealth } from "@/lib/physics/bossPhases";
import { pipSize, PIP_ROW_MAX } from "@/ui/game/bossBannerModel";
import { CellState, worldToGridIndex } from "@/lib/spaceGrid";
import { polygonCentroid } from "@/lib/polygon";
import type { LevelConfig, MapBeat } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import { LADDER, byLevel } from "./fixtures/maps";

const MONOLITH = byLevel(LADDER, 5) as LevelConfig;

function deal(level: LevelConfig = MONOLITH) {
  setActiveRuleSet("tree");
  setActiveRoster([{ slot: 1, rungs: { weight: 1 } }]);
  installClock();
  setRunSeedText("legacy");
  const ctx = createBotGame(level, 5, plainModifiers({ spawnFreezeSeconds: 9999 }), { lives: 3 });
  // Hold the ball well clear of the fortress unless a test moves it.
  ctx.game.balls[0].position = { x: 120, y: 120 };
  return ctx;
}

afterEach(() => {
  releaseClock();
  setActiveRuleSet("classic");
});

const brick = (g: CanvasGameState, id: string) => g.destructibles.find(d => d.id === id)!;
const breakNow = (g: CanvasGameState, id: string) => {
  const d = brick(g, id);
  d.hits = d.maxHits;
  d.destroyed = true;
  g.pendingDestroys.push(d);
};
const liveCells = (g: CanvasGameState) => g.spaceGrid!.cells.filter(c => c === CellState.ACTIVE).length;

describe("The Monolith, as authored", () => {
  it("is a boss with no ball: a Core that is the map's only slab, and the win is breaking it", () => {
    expect(MONOLITH.level).toBe(5);
    expect(MONOLITH.boss?.bossBall).toBeUndefined();
    expect(MONOLITH.boss?.core).toBe("core");
    const slabs = (MONOLITH.entities ?? []).filter(e => (e as { breakable?: boolean }).breakable);
    expect(slabs.map(e => e.id)).toEqual(["core"]);
    expect(MONOLITH.win?.require).toEqual([{ kind: "smashed", count: 1, of: "monoliths" }]);
  });

  it("patches only its own Shell's bricks, and every incident is telegraphed", () => {
    const shell = (MONOLITH.entities ?? []).filter(e => e.id.startsWith("shell-"));
    expect(shell.length).toBeGreaterThanOrEqual(10);
    expect(shell.every(e => (e as { brittle?: boolean }).brittle === true)).toBe(true);
    const beats = MONOLITH.beats ?? [];
    const patch = beats.find(b => b.restore)!;
    expect(new Set(patch.restore)).toEqual(new Set(shell.map(e => e.id)));
    expect(patch.everySeconds).toBeGreaterThan(0);
    const rollback = beats.find(b => b.rollback)!;
    expect(rollback.atHitsOn?.id).toBe("core");
    expect(rollback.rollback?.at).toBe("core");
    for (const b of beats) {
      expect(b.announce, `${b.id} has no telegraph`).toBeTruthy();
    }
  });

  it("pays an extra 10h for breaking the Core inside 45 seconds", () => {
    expect(MONOLITH.boss?.objective).toMatchObject({ kind: "speedClear", params: { seconds: 45 }, reward: 10 });
  });
});

describe("the Patch", () => {
  it("rebuilds a broken brick: its body, its edges and its hits", () => {
    const ctx = deal();
    const game = ctx.game;
    breakNow(game, "shell-top-1");
    stepBot(ctx);
    const d = brick(game, "shell-top-1");
    expect(d.destroyed).toBe(true);
    expect(game.walls.some(w => w.id.startsWith("obstacle-shell-top-1-"))).toBe(false);
    expect(restoreBrick(game, "shell-top-1")).toBe(true);
    expect(d.destroyed).toBe(false);
    expect(d.hits).toBe(0);
    expect(game.obstaclePolygons).toContain(d.obstaclePolygon);
    const edges = game.walls.filter(w => w.id.startsWith("obstacle-shell-top-1-edge-"));
    expect(edges).toHaveLength(4);
    // Still a brick: a fence passes through its edges (BRICKS_PLAN.md rule 7).
    expect(edges.every(w => w.brittle === true)).toBe(true);
  });

  it("never rebuilds a brick on a ball", () => {
    const ctx = deal();
    const g = ctx.game;
    breakNow(g, "shell-top-2");
    stepBot(ctx);
    const c = polygonCentroid(brick(g, "shell-top-2").obstaclePolygon!);
    g.balls[0].position = { x: c.x, y: c.y };
    expect(restoreBrick(g, "shell-top-2")).toBe(false);
    g.balls[0].position = { x: 120, y: 120 };
    expect(restoreBrick(g, "shell-top-2")).toBe(true);
  });

  it("never rebuilds a buried brick, or one on claimed ground", () => {
    const ctx = deal();
    const g = ctx.game;
    breakNow(g, "shell-left-1");
    breakNow(g, "shell-left-2");
    stepBot(ctx);
    brick(g, "shell-left-1").buried = true;
    expect(restoreBrick(g, "shell-left-1")).toBe(false);
    const c = polygonCentroid(brick(g, "shell-left-2").obstaclePolygon!);
    g.spaceGrid!.cells[worldToGridIndex(g.spaceGrid!, c.x, c.y)] = CellState.REMOVED;
    expect(restoreBrick(g, "shell-left-2")).toBe(false);
  });

  it("fires on its interval, warning ahead of every firing", () => {
    const ctx = deal();
    const g = ctx.game;
    breakNow(g, "shell-bottom-1");
    stepBot(ctx);
    const level: LevelConfig = { ...MONOLITH, beats: [{ id: "p", everySeconds: 15, announce: "game.beatPatch", leadMs: 2000, restore: ["shell-bottom-1"] }] };
    const warned: number[] = [];
    const at = (s: number) => {
      g.activePlaySeconds = s;
      tickMapBeats(g, level, 5, () => warned.push(s));
    };
    at(12);
    expect(warned).toEqual([]);
    at(13.5);
    expect(warned).toEqual([13.5]);
    expect(brick(g, "shell-bottom-1").destroyed).toBe(true);
    at(15);
    expect(brick(g, "shell-bottom-1").destroyed).toBe(false);
    breakNow(g, "shell-bottom-1");
    stepBot(ctx);
    at(28.5);
    at(30);
    expect(warned).toEqual([13.5, 28.5]);
    expect(brick(g, "shell-bottom-1").destroyed).toBe(false);
  });

  it("tells the banner what it does", () => {
    const patch = (MONOLITH.beats ?? []).find(b => b.restore)!;
    const rollback = (MONOLITH.beats ?? []).find(b => b.rollback)!;
    expect(beatEffectLines(patch, 5).map(l => l.key)).toEqual(["game.beatEffectRestore"]);
    expect(beatEffectLines(rollback, 5).map(l => l.key)).toEqual(["game.beatEffectRollback"]);
  });
});

describe("the Rollback", () => {
  it("waits for the Core's damage, then its telegraph, then lands once", () => {
    const ctx = deal();
    const g = ctx.game;
    const beat: MapBeat = { id: "rb", atHitsOn: { id: "core", hits: 8 }, announce: "game.beatRollback", leadMs: 1600, rollback: { at: "core", radius: 160 } };
    const level: LevelConfig = { ...MONOLITH, beats: [beat] };
    let warns = 0;
    g.activePlaySeconds = 10;
    tickMapBeats(g, level, 5, () => { warns++; });
    expect(warns).toBe(0);
    brick(g, "core").hits = 8;
    tickMapBeats(g, level, 5, () => { warns++; });
    expect(warns).toBe(1);
    expect(g.pendingRollbacks ?? []).toHaveLength(0);
    g.activePlaySeconds = 11.7;
    tickMapBeats(g, level, 5, () => { warns++; });
    expect(g.pendingRollbacks).toHaveLength(1);
    g.activePlaySeconds = 30;
    tickMapBeats(g, level, 5, () => { warns++; });
    expect(warns).toBe(1);
    expect(g.pendingRollbacks).toHaveLength(1);
  });

  it("blasts the fences and claimed ground round the Core, and leaves the Core and Shell standing", () => {
    const ctx = deal();
    const g = ctx.game;
    // The ball on the Core's side; the fence, inside the Shell's left wall,
    // claims the board to its left, part of which is inside the blast. (The
    // other way round, the fence would wall the Core off and lose the map.)
    g.balls[0].position = { x: 700, y: 450 };
    expect(tryCut(ctx, { x: 365, y: 200 }, { x: 0, y: 1 })).toBe(true);
    for (let n = 0; g.activeWalls.length > 0 && n < 3000; n++) {
      stepBot(ctx);
    }
    const before = liveCells(g);
    const standing = g.destructibles.filter(d => !d.destroyed).length;
    g.pendingRollbacks = [{ centre: polygonCentroid(brick(g, "core").obstaclePolygon!), radius: 160 }];
    expect(g.failure ?? null).toBeNull();
    stepBot(ctx);
    // Reachable through the hole the blast opened in the fence: live again.
    expect(liveCells(g)).toBeGreaterThan(before);
    expect(g.destructibles.filter(d => !d.destroyed).length).toBe(standing);
    expect(g.pendingRollbacks).toEqual([]);
  });
});

describe("the nameplate", () => {
  it("shows the Core's hits left, and says so only when they change", () => {
    const { game } = deal();
    expect(game.bossActive).toBe(true);
    expect(game.bossHp).toBe(28);
    expect(game.bossMaxHp).toBe(28);
    expect(followCoreHealth(game, MONOLITH)).toBeNull();
    brick(game, "core").hits = 5.4;
    expect(followCoreHealth(game, MONOLITH)).toEqual({ hp: 23, maxHp: 28 });
    expect(followCoreHealth(game, MONOLITH)).toBeNull();
    brick(game, "core").destroyed = true;
    expect(followCoreHealth(game, MONOLITH)).toEqual({ hp: 0, maxHp: 28 });
    expect(game.bossDefeated).toBe(true);
  });

  it("is not a Core's on a map without one", () => {
    const { game } = deal(byLevel(LADDER, 4) as LevelConfig);
    expect(followCoreHealth(game, byLevel(LADDER, 4) as LevelConfig)).toBeNull();
  });

  it("fits the Core's pips in the row", () => {
    for (const n of [16, 28, 40]) {
      const p = pipSize(n);
      expect(n * p.width + (n - 1) * p.gap, `${n} pips`).toBeLessThanOrEqual(PIP_ROW_MAX);
      expect(p.width, `${n} pips`).toBeGreaterThanOrEqual(3);
    }
    expect(pipSize(5)).toEqual({ width: 16, gap: 4 });
  });
});

describe("the spawn", () => {
  it("never puts a ball inside the fortress, on any deal", () => {
    const xs: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      setActiveRuleSet("tree");
      setActiveRoster([{ slot: 1, rungs: {} }, { slot: 2, rungs: {} }]);
      installClock();
      setRunSeedText(`spawn-${seed}`);
      const { game } = createBotGame(MONOLITH, 5, plainModifiers(), { lives: 3, mutator: "roll" } as never);
      const boxes = game.destructibles.map(d => d.obstaclePolygon!.vertices);
      const minX = Math.min(...boxes.flat().map(v => v.x)), maxX = Math.max(...boxes.flat().map(v => v.x));
      const minY = Math.min(...boxes.flat().map(v => v.y)), maxY = Math.max(...boxes.flat().map(v => v.y));
      for (const b of game.balls) {
        const inside = b.position.x > minX && b.position.x < maxX && b.position.y > minY && b.position.y < maxY;
        expect(inside, `seed ${seed}: a ball started inside the fortress`).toBe(false);
        xs.push(b.position.x);
      }
      releaseClock();
    }
    expect(xs.length).toBe(80);
  });
});
