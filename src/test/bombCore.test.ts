/**
 * The bomb inside a destructible box (lib/bombCore.ts): "every hit in the box
 * chip away more at the outer hull until the bomb starts showing. The first
 * time a ball hits the bomb, it is all destroyed."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { DestructibleState } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import { bombExposeAt, bombHitDamage, bombReveal, entityHasBomb } from "@/lib/bombCore";
import { registerObjectHit } from "@/lib/physics/destructibles";
import { bombHoleOutline, bombLook, bombRadius, bombSeed } from "@/lib/rendering/sleek/bombLook";
import { boardEntityAt } from "@/lib/boardEntityInfo";
import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import sv from "@/i18n/locales/sv.json";

const read = (p: string) => readFileSync(p, "utf8");

function box(maxHits = 3, over: Partial<DestructibleState> = {}): DestructibleState {
  return {
    id: "slab", kind: "breakable", hits: 0, maxHits, lastHitAt: 0, destroyed: false,
    bomb: true, bombExposeAt: bombExposeAt(maxHits), bombExposed: bombExposeAt(maxHits) <= 0, ...over,
  };
}

function game(): CanvasGameState {
  return { objectDebris: [], pendingDestroys: [] } as unknown as CanvasGameState;
}

describe("which boxes carry a bomb", () => {
  it("every breakable slab and chest, unless the map says no", () => {
    expect(entityHasBomb({ breakable: true })).toBe(true);
    expect(entityHasBomb({ chest: true })).toBe(true);
    expect(entityHasBomb({ breakable: true, bomb: false })).toBe(false);
  });

  it("never a one-touch shard, a fence-style curtain or a plain wall", () => {
    expect(entityHasBomb({ brittle: true })).toBe(false);
    expect(entityHasBomb({ breakable: true, fence: true })).toBe(false);
    expect(entityHasBomb({})).toBe(false);
  });

  it("is decided when the map is built, from the same rule", () => {
    const init = read("src/lib/initGame.ts");
    expect(init).toContain("const bomb = entityHasBomb(entity as WallEntity);");
    expect(init).toContain("bombExposeAt: bombExposeAt(maxHits)");
  });
});

describe("the hull", () => {
  it("opens at all but the last hit, so a box takes the hits it always did", () => {
    expect(bombExposeAt(3)).toBe(2);
    expect(bombExposeAt(2)).toBe(1);
    expect(bombExposeAt(1)).toBe(0);
  });

  it("shows more of the bomb with each hit", () => {
    const d = box(3);
    expect(bombReveal(d)).toBe(0);
    d.hits = 1;
    expect(bombReveal(d)).toBeCloseTo(0.5);
    d.hits = 2;
    expect(bombReveal(d)).toBe(1);
  });

  it("can only expose the bomb: no single blow, however hard, destroys the box", () => {
    const d = box(3);
    expect(bombHitDamage(d, 3, 100)).toBe(2);
    expect(d.bombExposed).toBe(true);
    expect(d.bombExposedAt).toBe(100);
    expect(d.hits + 2).toBeLessThan(d.maxHits + 1);
  });

  it("goes up on the next hit once the bomb shows, whatever that hit is worth", () => {
    const d = box(3, { hits: 2, bombExposed: true });
    expect(bombHitDamage(d, 0.15, 200)).toBe(1);
    expect(d.bombDetonated).toBe(true);
  });

  it("a box with no hull to chip shows its bomb from the start", () => {
    expect(box(1).bombExposed).toBe(true);
    expect(bombReveal(box(1))).toBe(1);
  });
});

describe("through registerObjectHit", () => {
  it("chips, chips, then the hit on the bomb destroys it", () => {
    const g = game(), d = box(3);
    registerObjectHit(g, d, "b1", 1000, 1);
    expect(d.destroyed).toBe(false);
    expect(d.bombExposed).toBe(false);
    registerObjectHit(g, d, "b1", 2000, 1);
    expect(d.destroyed).toBe(false);
    expect(d.bombExposed).toBe(true);
    registerObjectHit(g, d, "b1", 3000, 0.2);
    expect(d.destroyed).toBe(true);
    expect(d.destroyedBy).toBe("b1");
    expect(g.pendingDestroys).toContain(d);
  });

  it("a rocket opens the hull but does not take the box in one contact", () => {
    const g = game(), d = box(3);
    registerObjectHit(g, d, "b1", 1000, 3);
    expect(d.bombExposed).toBe(true);
    expect(d.destroyed).toBe(false);
  });

  it("the contact that opens the hull can never also set the bomb off", () => {
    const g = game(), d = box(3);
    registerObjectHit(g, d, "b1", 1000, 3);
    registerObjectHit(g, d, "b1", 1100, 3); // inside the debounce: the same contact
    expect(d.destroyed).toBe(false);
  });

  it("leaves a box without a bomb exactly as it was", () => {
    const g = game(), d = box(3, { bomb: false, bombExposeAt: undefined, bombExposed: undefined });
    registerObjectHit(g, d, "b1", 1000, 3);
    expect(d.destroyed).toBe(true);
  });
});

describe("going up", () => {
  it("throws a second, hotter burst and tells the game, which booms and jolts", () => {
    const src = read("src/lib/physics/destructibles.ts");
    expect(src).toMatch(/if \(d\.bomb \|\| d\.shardBomb\) \{\n\s+game\.objectDebris\.push\(spawnDebris\(poly, BOMB_BLAST_COLOR/);
    expect(src).toContain("callbacks.onBombDetonated?.(d);");
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas).toMatch(/onBombDetonated: \(\) => \{\n\s+playBossLandSound\(\);/);
  });
});

describe("how it looks", () => {
  it("shows nothing on an untouched box", () => {
    expect(bombLook(0, false, 40, 0, undefined).holeR).toBe(0);
  });

  it("opens a hole that widens with wear and runs past the casing at exposure", () => {
    const a = bombLook(0.3, false, 40, 0, undefined);
    const b = bombLook(0.9, false, 40, 0, undefined);
    const c = bombLook(1, true, 40, 0, undefined);
    expect(b.holeR).toBeGreaterThan(a.holeR);
    expect(c.holeR).toBeGreaterThan(bombRadius(40));
    expect(c.casingR).toBeCloseTo(bombRadius(40));
    expect(a.light).toBe(0);
  });

  it("blinks its fuse light once exposed, and flashes as it comes into view", () => {
    const on = bombLook(1, true, 40, 10, 0);
    const off = bombLook(1, true, 40, 300, 0);
    expect(on.light).toBeGreaterThan(off.light);
    expect(on.flash).toBeGreaterThan(0);
    expect(bombLook(1, true, 40, 5000, 0).flash).toBe(0);
  });

  it("keeps the same ragged hole every frame", () => {
    expect(bombHoleOutline(0, 0, 10, bombSeed("slab"))).toEqual(bombHoleOutline(0, 0, 10, bombSeed("slab")));
    expect(bombHoleOutline(0, 0, 10, bombSeed("slab"))).not.toEqual(bombHoleOutline(0, 0, 10, bombSeed("chest")));
  });

  it("is drawn on the box in 2D, and lights the floor in 3D", () => {
    expect(read("src/lib/rendering/sleek/objectLayer.ts")).toContain("if (d.bomb) this.drawBomb(d, pts, cx, cy, scale);");
    expect(read("src/lib/rendering/three/ThreeRenderer.ts")).toContain("bombLights(game, look.chargeTell, simNow())");
  });
});

describe("explained, and testable", () => {
  it("says so when held", () => {
    const poly = { vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
    const g = { balls: [], pickups: [], chestLoot: [], destructibles: [box(3, { obstaclePolygon: poly })], phasingObjects: [], movers: [], mirrorPolygons: [], obstaclePolygons: [] } as unknown as CanvasGameState;
    expect(boardEntityAt(g, 50, 50)?.kind).toBe("bombBox");
    g.destructibles[0].chest = true;
    expect(boardEntityAt(g, 50, 50)?.kind).toBe("bombChest");
  });

  it.each([["en", en], ["es", es], ["sv", sv]] as const)("in %s, with no em-dash", (_, l) => {
    const info = (l as unknown as { boardInfo: Record<string, { title: string; body: string }> }).boardInfo;
    for (const k of ["bombBox", "bombChest"]) {
      expect(info[k].title).toBeTruthy();
      expect(info[k].body).not.toContain("—");
    }
  });

  it("can be switched off per box in the map editor", () => {
    expect(read("src/components/admin/EntityPanel.tsx")).toContain("{ bomb: e.target.checked ? undefined : false }");
  });
});

// ── Shard bombs ─────────────────────────────────────────────────────────────
// "The explosion on small destructables must be much smaller, but I like the
// idea of some smaller destructables being bombs that can blow up other close
// destructables when destroyed. There can be a 10% chance that a small
// destructable becomes a bomb. These bombs can have the explosion that is
// currently assigned to them."

import yaml from "js-yaml";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { processDestroysFn } from "@/lib/physics/destructibles";
import {
  DEFAULT_SHARD_BOMB_CONFIG, SHARD_BREAK_BLAST, assignShardBombs, authoredShardBombs, shardBombTargets,
} from "@/lib/bombCore";
import type { LevelData, LevelConfig } from "@/types/level";
import { setRunSeedText } from "@/lib/runRng";

const LEVELS = (yaml.load(read("public/map.yml")) as LevelData).levels;
const NO_CB = { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} };

function buildLevel(n: number): CanvasGameState {
  const level = LEVELS.find(l => l.level === n) as LevelConfig;
  const game = createInitialGameData(level, level.level, DEFAULT_MODIFIERS) as unknown as CanvasGameState;
  const g = game as unknown as Record<string, unknown>;
  for (const k of [
    "activeWalls", "pickups", "objectDebris", "debris", "fallingObjects", "fallingSlabs", "lockFlashes",
    "wallImpacts", "ballPops", "abilityFx", "pickupLockMarkers", "pickupFeedback", "pendingDestroys",
    "pendingWallBreaks", "pendingBeats", "firedBeats", "warnedBeats", "bossFiredPhases",
  ]) g[k] ??= [];
  g.assimilations = new Map();
  g.activePlaySeconds = 0; g.ballSpeedScale = 1; g.creepFactor = 1;
  g.breakBonus ??= 0; g.breakMultiplier ??= 1; g.objectivesBroken ??= 0;
  game.shardBombBlast = { radius: DEFAULT_SHARD_BOMB_CONFIG.blastRadius, damage: DEFAULT_SHARD_BOMB_CONFIG.blastDamage };
  return game;
}

const smash = (g: CanvasGameState, d: DestructibleState) => {
  d.lastHitAt = 0;
  registerObjectHit(g, d, "b1", 10_000, 1, undefined);
};

describe("which shards are bombs", () => {
  const shards = (): DestructibleState[] => Array.from({ length: 200 }, (_, i) => ({
    id: `s${i}`, kind: "breakable", hits: 0, maxHits: 1, lastHitAt: 0, destroyed: false, brittle: true,
  }));

  it("about one in ten, from game-config.yml", () => {
    expect(DEFAULT_SHARD_BOMB_CONFIG.chance).toBe(0.1);
    expect(read("public/game-config.yml")).toMatch(/shard_bombs:\n(?:\s*#.*\n)*\s+chance: 0\.1\n/);
    const ds = shards();
    assignShardBombs(ds, 0.1, new Map());
    const n = ds.filter(d => d.shardBomb).length;
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(40);
  });

  it("the same shards every deal of a seeded run (so both phones of a pair agree)", () => {
    setRunSeedText("bomb-test");
    try {
      const a = shards(), b = shards();
      assignShardBombs(a, 0.1, new Map());
      assignShardBombs(b, 0.1, new Map());
      expect(a.map(d => !!d.shardBomb)).toEqual(b.map(d => !!d.shardBomb));
    } finally {
      setRunSeedText(null);
    }
  });

  it("every one at 100% (the Playground knob), none at 0", () => {
    const all = shards(), none = shards();
    assignShardBombs(all, 1, new Map());
    assignShardBombs(none, 0, new Map());
    expect(all.every(d => d.shardBomb)).toBe(true);
    expect(none.some(d => d.shardBomb)).toBe(false);
  });

  it("never a shard carrying a bug, a slab or a chest; a map's pins win both ways", () => {
    const ds = shards();
    ds[0].bug = "forcePush";
    ds[1].brittle = false;
    assignShardBombs(ds, 1, new Map([["s2", false]]));
    expect(ds[0].shardBomb).toBeUndefined();
    expect(ds[1].shardBomb).toBeUndefined();
    expect(ds[2].shardBomb).toBeUndefined();
    const pinned = shards();
    assignShardBombs(pinned, 0, new Map([["s5", true]]));
    expect(pinned.filter(d => d.shardBomb).map(d => d.id)).toEqual(["s5"]);
  });

  it("reads a map's pins off its brittle entities only", () => {
    const m = authoredShardBombs({ entities: [
      { id: "a", kind: "wall", brittle: true, bomb: true },
      { id: "b", kind: "wall", brittle: true, bomb: false },
      { id: "c", kind: "wall", breakable: true, bomb: false },
    ] } as unknown as LevelConfig);
    expect([...m.entries()]).toEqual([["a", true], ["b", false]]);
  });

  it("is rolled when a map is dealt, after the bugs, with the Admin knob on top", () => {
    const canvas = read("src/components/game/GameCanvas.tsx");
    expect(canvas.indexOf("assignShardBombs(game.destructibles")).toBeGreaterThan(canvas.indexOf("assignShardBugs("));
    expect(canvas).toContain("cfg.chance + (activeModifiers.shardBombChanceBonus ?? 0)");
    expect(read("src/components/admin/PlaygroundScreen.tsx")).toMatch(/shardBombChanceBonus:\s+\{ label: 'Shard Bomb Chance \+'/);
  });
});

describe("an ordinary shard breaks small", () => {
  it("a handful of light pieces and a small flash, not a slab's burst", () => {
    const g = buildLevel(17);
    const brick = g.destructibles.find(d => d.brittle)!;
    brick.shardBomb = false;
    smash(g, brick);
    processDestroysFn(g, NO_CB, 17);
    const burst = g.objectDebris[g.objectDebris.length - 1];
    expect(burst.blast).toBe(SHARD_BREAK_BLAST);
    expect(burst.particles.length).toBeLessThan(16);
    expect(read("src/lib/rendering/three/explosions3d.ts")).toContain("const power = d.blast ?? Math.min(1, d.particles.length / 28);");
  });
});

describe("a shard bomb going up", () => {
  it("takes the bricks close by, and only those", () => {
    const g = buildLevel(17);
    for (const d of g.destructibles) d.shardBomb = false;
    const bricks = g.destructibles.filter(d => d.brittle);
    const bomb = bricks[Math.floor(bricks.length / 2)];
    bomb.shardBomb = true;
    const near = shardBombTargets(g.destructibles, bomb, DEFAULT_SHARD_BOMB_CONFIG.blastRadius).map(t => t.d);
    expect(near.length).toBeGreaterThan(0);
    smash(g, bomb);
    processDestroysFn(g, NO_CB, 17);
    // The blast struck them; they go on the next pass, as anything struck does.
    processDestroysFn(g, NO_CB, 17);
    for (const d of near.filter(x => x.brittle)) expect(d.destroyed, d.id).toBe(true);
    const far = bricks.filter(d => d !== bomb && !near.includes(d));
    expect(far.length).toBeGreaterThan(0);
    for (const d of far) expect(d.destroyed, d.id).toBe(false);
  });

  it("sets off another bomb in its blast, which takes its own neighbours", () => {
    const g = buildLevel(17);
    for (const d of g.destructibles) d.shardBomb = false;
    const bricks = g.destructibles.filter(d => d.brittle);
    const bomb = bricks[Math.floor(bricks.length / 2)];
    bomb.shardBomb = true;
    const R = DEFAULT_SHARD_BOMB_CONFIG.blastRadius;
    const first = new Set(shardBombTargets(g.destructibles, bomb, R).map(t => t.d));
    // A neighbour that reaches bricks the first blast does not.
    const relay = [...first].find(n => n.brittle && shardBombTargets(g.destructibles, n, R).some(t => t.d !== bomb && !first.has(t.d)))!;
    expect(relay).toBeTruthy();
    relay.shardBomb = true;
    const second = shardBombTargets(g.destructibles, relay, R).map(t => t.d).filter(d => d !== bomb && !first.has(d) && d.brittle);
    smash(g, bomb);
    for (let i = 0; i < 4; i++) processDestroysFn(g, NO_CB, 17);
    for (const d of second) expect(d.destroyed, d.id).toBe(true);
  });

  it("gets the bomb's own blast: the hot burst, the boom and the jolt", () => {
    const g = buildLevel(17);
    const bomb = g.destructibles.find(d => d.brittle)!;
    bomb.shardBomb = true;
    let boom = 0;
    smash(g, bomb);
    processDestroysFn(g, { ...NO_CB, onBombDetonated: () => { boom++; } }, 17);
    expect(boom).toBe(1);
    expect(g.objectDebris.some(o => o.color === "#ff5a2a" && o.particles.length >= 40)).toBe(true);
  });

  it("strikes a slab in reach with a heavy blow, and leaves mirrors and movers alone", () => {
    const poly = (x: number) => ({ vertices: [{ x, y: 0 }, { x: x + 20, y: 0 }, { x: x + 20, y: 20 }, { x, y: 20 }] });
    const bomb: DestructibleState = { id: "b", kind: "breakable", hits: 0, maxHits: 1, lastHitAt: 0, destroyed: false, brittle: true, shardBomb: true, obstaclePolygon: poly(0) };
    const slab: DestructibleState = { id: "s", kind: "breakable", hits: 0, maxHits: 3, lastHitAt: 0, destroyed: false, obstaclePolygon: poly(40) };
    const mirror: DestructibleState = { id: "m", kind: "mirror", hits: 0, maxHits: 3, lastHitAt: 0, destroyed: false, mirrorPolygon: poly(-40) };
    const far: DestructibleState = { id: "f", kind: "breakable", hits: 0, maxHits: 1, lastHitAt: 0, destroyed: false, brittle: true, obstaclePolygon: poly(400) };
    expect(shardBombTargets([bomb, slab, mirror, far], bomb, 70).map(t => t.d.id)).toEqual(["s"]);
  });

  it("is drawn as a bomb from the start, and says so when held", () => {
    expect(read("src/lib/rendering/sleek/objectLayer.ts")).toContain("else if (d.shardBomb) this.drawBomb(d, pts, cx, cy, scale, true);");
    const poly = { vertices: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 22 }, { x: 0, y: 22 }] };
    const shard: DestructibleState = { id: "x", kind: "breakable", hits: 0, maxHits: 1, lastHitAt: 0, destroyed: false, brittle: true, shardBomb: true, obstaclePolygon: poly };
    const g = { balls: [], pickups: [], chestLoot: [], destructibles: [shard], phasingObjects: [], movers: [], mirrorPolygons: [], obstaclePolygons: [] } as unknown as CanvasGameState;
    expect(boardEntityAt(g, 30, 11)?.kind).toBe("bombShard");
    for (const l of [en, es, sv]) {
      const info = (l as unknown as { boardInfo: Record<string, { title: string; body: string }> }).boardInfo;
      expect(info.bombShard.title).toBeTruthy();
      expect(info.bombShard.body).not.toContain("—");
    }
    expect(read("src/components/admin/EntityPanel.tsx")).toContain('bomb: v === "always" ? true : v === "never" ? false : undefined');
  });
});
