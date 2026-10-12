/**
 * Every bomb's blast, the slab and chest bomb's included, and what it does to
 * the balls: "the bomb in larger destructables should also have the same
 * effect, but with a bigger explosion. Explosions should also effect the balls
 * around it, such as increasing their speed."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelData, LevelConfig } from "@/types/level";
import { DEFAULT_SHARD_BOMB_CONFIG, blastBalls, blastEaseSpeed, blastKick, type BombBlast } from "@/lib/bombCore";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { processDestroysFn, registerObjectHit } from "@/lib/physics/destructibles";
import { polygonCentroid, pointToSegmentDistance } from "@/lib/polygon";
import { resetMapIds } from "@/lib/gameUtils";
import { createRng } from "@/lib/runRng";

const read = (p: string) => readFileSync(p, "utf8");
const LEVELS = (yaml.load(read("public/map.yml")) as LevelData).levels;
const CB = { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} };
const BLAST: BombBlast = { radius: 100, damage: 1.5, ballBoost: 1.5 };

const ball = (x: number, y: number, vx = 200, vy = 0): Ball =>
  ({ id: `b${x}`, state: "active", position: { x, y }, velocity: { x: vx, y: vy }, speed: Math.hypot(vx, vy), baseSpeed: 200, radius: 12 } as unknown as Ball);

function build(n: number): CanvasGameState {
  resetMapIds();
  const level = LEVELS.find(l => l.level === n) as LevelConfig;
  const game = createInitialGameData(level, level.level, DEFAULT_MODIFIERS) as unknown as CanvasGameState;
  const g = game as unknown as Record<string, unknown>;
  for (const k of ["objectDebris", "pendingDestroys", "deliveryBoxes", "launchers", "phasingObjects", "fallingObjects"]) g[k] ??= [];
  g.assimilations = new Map(); g.breakBonus = 0; g.breakMultiplier = 1; g.objectivesBroken = 0;
  for (const b of game.balls) { b.state = "active"; b.speed = 200; }
  const cfg = DEFAULT_SHARD_BOMB_CONFIG;
  game.shardBombBlast = { radius: cfg.blastRadius, damage: cfg.blastDamage, ballBoost: cfg.ballBoost };
  game.boxBombBlast = { ...cfg.box };
  game.bombBoostSeconds = cfg.boostSeconds;
  return game;
}

describe("the tuning", () => {
  it("is in game-config.yml, the slab and chest bomb's bigger", () => {
    const yml = read("public/game-config.yml");
    expect(yml).toMatch(/box_bombs:\n(?:\s+#.*\n)*\s+start_level: 11\n\s+blast_radius: 150\n\s+blast_damage: 2\n\s+ball_boost: 1\.8\n/);
    expect(yml).toMatch(/\n\s+ball_boost: 1\.5\n/);
    expect(yml).toMatch(/\n\s+boost_seconds: 2\.5\n/);
    const c = DEFAULT_SHARD_BOMB_CONFIG;
    expect(c.box.radius).toBeGreaterThan(c.blastRadius);
    expect(c.box.ballBoost).toBeGreaterThan(c.ballBoost);
  });
});

describe("a slab or chest bomb going up", () => {
  it("has the same effect as a shard bomb, over its bigger reach", () => {
    const game = build(19);
    const chest = game.destructibles.find(d => d.id === "chest-w")!;
    expect(chest.bomb).toBe(true);
    const c = polygonCentroid(chest.obstaclePolygon!);
    // A fence within the box bomb's reach but out of a shard bomb's.
    const w = { id: "wall-t", start: { x: c.x + 125, y: c.y - 300 }, end: { x: c.x + 125, y: c.y + 300 }, thickness: 6, createdAt: 1, fenceTypeId: "standard" };
    game.walls = [...game.walls, w as never];
    chest.hits = chest.bombExposeAt!; chest.bombExposed = true;
    registerObjectHit(game, chest, "b1", 10_000, 1);
    processDestroysFn(game, CB, 19);
    expect(game.walls.includes(w as never)).toBe(false);
    for (const p of game.walls.filter(x => x.start.x === c.x + 125 && x.end.x === c.x + 125)) {
      expect(pointToSegmentDistance(c, p.start, p.end)).toBeGreaterThan(120);
    }
  });

  it("throws a bigger fire, whose light reaches as far as the blast", () => {
    const game = build(19);
    const chest = game.destructibles.find(d => d.id === "chest-w")!;
    chest.hits = chest.bombExposeAt!; chest.bombExposed = true;
    registerObjectHit(game, chest, "b1", 10_000, 1);
    processDestroysFn(game, CB, 19);
    const fire = game.objectDebris.find(o => o.color === "#ff5a2a")!;
    expect(fire.particles.length).toBeGreaterThan(50);
    expect(fire.reach).toBe(150 * 2.4);
    expect(read("src/lib/rendering/three/explosions3d.ts")).toContain("if (d.reach != null) this.blast(cx, cy, now, d.reach, 1, color);");
  });
});

describe("the balls in the blast", () => {
  it("are thrown outward from it, faster", () => {
    const b = ball(150, 100, 0, 200);
    expect(blastBalls([b], { x: 100, y: 100 }, BLAST, 0, 2.5, createRng("t"))).toBe(1);
    expect(b.velocity.x).toBeGreaterThan(0);
    expect(Math.abs(b.velocity.y)).toBeLessThan(1e-6);
    expect(Math.hypot(b.velocity.x, b.velocity.y)).toBeGreaterThan(200);
  });

  it("harder the closer they were, and not at all out of reach", () => {
    expect(blastKick(0, 100, 1.5)).toBeCloseTo(1.5);
    expect(blastKick(100, 100, 1.5)).toBeCloseTo(1.25);
    expect(blastKick(101, 100, 1.5)).toBe(1);
    const far = ball(400, 100);
    expect(blastBalls([far], { x: 100, y: 100 }, BLAST, 0, 2.5, createRng("t"))).toBe(0);
    expect(far.velocity).toEqual({ x: 200, y: 0 });
  });

  it("ease back to their own speed, and a second blast kicks again rather than winding up", () => {
    const b = ball(120, 100);
    blastBalls([b], { x: 100, y: 100 }, BLAST, 0, 2.5, createRng("t"));
    const kicked = b.speed;
    expect(blastEaseSpeed(b, 1000)!).toBeLessThan(kicked);
    expect(blastEaseSpeed(b, 1000)!).toBeGreaterThan(200);
    blastBalls([b], { x: 100, y: 100 }, BLAST, 1200, 2.5, createRng("t"));
    expect(b.speed).toBeCloseTo(kicked, 0);
    expect(blastEaseSpeed(b, 1200 + 2500)).toBe(200);
    expect(b.blastBoostUntil).toBeUndefined();
    expect(blastEaseSpeed(b, 9999)).toBeNull();
  });

  it("leave a sleeping or locked ball alone, and invent a direction both phones agree on", () => {
    const won = { ...ball(110, 100), state: "won" } as Ball;
    expect(blastBalls([won], { x: 100, y: 100 }, BLAST, 0, 2.5, createRng("t"))).toBe(0);
    const a = ball(100, 100), b = ball(100, 100);
    blastBalls([a], { x: 100, y: 100 }, BLAST, 0, 2.5, createRng("same"));
    blastBalls([b], { x: 100, y: 100 }, BLAST, 0, 2.5, createRng("same"));
    expect(a.velocity).toEqual(b.velocity);
  });

  it("are thrown by every bomb as it goes up, and eased in the physics step", () => {
    expect(read("src/lib/physics/destructibles.ts")).toContain('blastBalls(game.balls, c, blast, now, game.bombBoostSeconds ?? 2.5, runStream("bombBlast"));');
    expect(read("src/lib/physics/updateBall.ts")).toContain("const eased = blastEaseSpeed(ball, now);");
  });

  it("through a real blast on a real map", () => {
    const game = build(6);
    const bomb = game.destructibles.find(d => d.id === "tooth-r2b")!;
    bomb.shardBomb = true;
    const c = polygonCentroid(bomb.obstaclePolygon!);
    const b = game.balls[0];
    b.position = { x: c.x, y: c.y + 60 }; b.velocity = { x: 200, y: 0 }; b.speed = 200;
    registerObjectHit(game, bomb, "b1", 10_000, 1);
    processDestroysFn(game, CB, 6);
    expect(b.velocity.y).toBeGreaterThan(0);
    expect(Math.hypot(b.velocity.x, b.velocity.y)).toBeGreaterThan(200);
    expect(b.blastRestSpeed).toBeCloseTo(200);
  });
});
