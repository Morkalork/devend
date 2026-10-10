/**
 * The maps in 3D: authored heights, the role rule behind the defaults, the
 * props as bodies and the floor zones as plates.
 *
 * Height is rendering only, so most of what can go wrong is disagreement:
 * the editor naming a default the board does not draw, an authored `rise` that
 * never reaches the board, a map whose heights stopped meaning what the rule
 * says they mean. Those are what these pin.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LADDER } from "./fixtures/maps";
import { createInitialGameData } from "@/lib/initGame";
import { plainModifiers } from "@/lib/bot/headlessGame";
import {
  BOUNCER_RISE, MOVER_RISE, RISE_MAX, RISE_MIN, ROLE_RISE, defaultRise, entityRise,
} from "@/lib/objectRise";
import { collectSolids, obstacleRiseOf, roleRises } from "@/lib/rendering/three/solids3d";
import { HEIGHTS } from "@/lib/rendering/three/heights3d";
import { LOOT_GEM, PICKUP_GEM, propPoses } from "@/lib/rendering/three/props3d";
import { PLATE_HEIGHT, collectPlates } from "@/lib/rendering/three/zones3d";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelEntity } from "@/types/level";
import type { Polygon } from "@/lib/polygon";
import type { DestructibleState } from "@/types/game";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const square = (x: number, y: number, s = 40): Polygon => ({
  vertices: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }],
});

function board(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    obstaclePolygons: [], destructibles: [], phasingObjects: [], movers: [],
    pickups: [], activePlaySeconds: 10,
    ...over,
  } as unknown as CanvasGameState;
}

const breakable = (poly: Polygon, extra: Partial<DestructibleState> = {}): DestructibleState => ({
  id: "d", kind: "breakable", hits: 0, maxHits: 3, lastHitAt: 0, destroyed: false,
  obstaclePolygon: poly, ...extra,
});

describe("the height rule", () => {
  it("clamps an authored rise and ignores nonsense", () => {
    expect(entityRise({ rise: 1.5 })).toBe(1.5);
    expect(entityRise({ rise: 9 })).toBe(RISE_MAX);
    expect(entityRise({ rise: 0.01 })).toBe(RISE_MIN);
    expect(entityRise({ rise: 0 })).toBeUndefined();
    expect(entityRise({ rise: Number.NaN })).toBeUndefined();
    expect(entityRise({})).toBeUndefined();
  });

  it("names each role's default the way the board draws it", () => {
    const wall = (extra: Partial<LevelEntity>) =>
      ({ id: "w", kind: "wall", shape: "rect", x: 0, y: 0, width: 40, height: 40, ...extra }) as LevelEntity;
    expect(defaultRise(wall({ brittle: true } as Partial<LevelEntity>)).rise).toBe(ROLE_RISE.shard);
    expect(defaultRise(wall({ breakable: true } as Partial<LevelEntity>)).rise).toBe(ROLE_RISE.monolith);
    expect(defaultRise(wall({ breakable: true, chest: true } as Partial<LevelEntity>)).rise).toBe(ROLE_RISE.chest);
    expect(defaultRise(wall({ oneWay: "up" } as Partial<LevelEntity>)).rise).toBe(ROLE_RISE.membrane);
    expect(defaultRise(wall({ bouncer: true } as Partial<LevelEntity>)).rise).toBe(BOUNCER_RISE);
    expect(defaultRise(wall({})).rise).toBe(1);

    // The live board agrees, polygon by polygon.
    const shard = square(0, 0), mono = square(100, 0), chest = square(200, 0), gate = square(300, 0);
    const game = board({
      obstaclePolygons: [shard, mono, chest, gate],
      destructibles: [breakable(shard, { brittle: true }), breakable(mono), breakable(chest, { chest: true })],
      obstacleRules: new Map([[gate, { oneWay: "up" }]]),
    });
    const roles = roleRises(game);
    expect(obstacleRiseOf(game, shard, roles)).toBe(ROLE_RISE.shard);
    expect(obstacleRiseOf(game, mono, roles)).toBe(ROLE_RISE.monolith);
    expect(obstacleRiseOf(game, chest, roles)).toBe(ROLE_RISE.chest);
    expect(obstacleRiseOf(game, gate, roles)).toBe(ROLE_RISE.membrane);
  });

  it("orders the roles the way the promise reads", () => {
    // A membrane must never stand like a wall a ball goes through, a shard
    // sits under a monolith, and a monolith stands over a plain wall.
    expect(ROLE_RISE.membrane).toBeLessThan(ROLE_RISE.shard);
    expect(ROLE_RISE.shard).toBeLessThan(ROLE_RISE.chest);
    expect(ROLE_RISE.chest).toBeLessThan(1);
    expect(ROLE_RISE.monolith).toBeGreaterThan(1);
    expect(HEIGHTS.mover).toBeCloseTo(HEIGHTS.slab * MOVER_RISE);
  });

  it("lets an authored rise beat the role, and draws it", () => {
    const poly = square(0, 0);
    const game = board({
      obstaclePolygons: [poly],
      destructibles: [breakable(poly, { brittle: true })],
      obstacleRise: new Map([[poly, 2]]),
    });
    const [solid] = collectSolids(game, 1);
    expect(solid.height).toBeCloseTo(HEIGHTS.slab * 2);
  });

  it("stands a broken shard's neighbours at the shard height, and a smashed one not at all", () => {
    const a = square(0, 0), b = square(50, 0);
    const game = board({
      obstaclePolygons: [a, b],
      destructibles: [breakable(a, { brittle: true }), breakable(b, { brittle: true, destroyed: true })],
    });
    const [sa] = collectSolids(game, 1);
    expect(sa.height).toBeCloseTo(HEIGHTS.slab * ROLE_RISE.shard);
  });
});

describe("authored heights reach the board", () => {
  it("carries a map's rise from map.yml to the obstacle it was written on", () => {
    const l1 = LADDER.find(l => l.level === 1)!;
    const data = createInitialGameData(l1, 1, plainModifiers());
    const rises = [...data.obstacleRise.values()].sort();
    expect(rises).toEqual([0.75, 1.5, 1.5]);
    // Keyed by the very polygons the board stands up.
    for (const poly of data.obstacleRise.keys()) expect(data.obstaclePolygons).toContain(poly);
  });

  it("carries a mover's rise onto its state", () => {
    const l8 = LADDER.find(l => l.level === 8)!;
    const data = createInitialGameData(l8, 8, plainModifiers());
    expect(data.movers.find(m => m.id === "door")?.rise).toBe(1.5);
  });

  it("keeps every authored rise in range, on something that stands", () => {
    for (const level of LADDER) {
      for (const e of level.entities ?? []) {
        if (e.rise === undefined) continue;
        expect(["wall", "mover", "launcher", "cage", "box"], `${level.id}/${e.id}`).toContain(e.kind);
        expect(e.rise, `${level.id}/${e.id}`).toBeGreaterThanOrEqual(RISE_MIN);
        expect(e.rise, `${level.id}/${e.id}`).toBeLessThanOrEqual(RISE_MAX);
      }
    }
  });

  it("states every ladder map's height story in map.yml", () => {
    const yml = read("public/map.yml");
    const notes = yml.match(/^\s+# Heights \(3D board, objectRise\.ts\): .+$/gm) ?? [];
    expect(notes.length).toBeGreaterThanOrEqual(LADDER.length);
  });

  it("gives the editor a height control", () => {
    const panel = read("src/components/admin/EntityPanel.tsx");
    expect(panel).toMatch(/<RiseEditor/);
    expect(panel).toMatch(/rise:/);
  });
});

describe("props as bodies", () => {
  it("poses one body per prop, standing where the simulation has it", () => {
    const game = board({
      pickups: [{ id: "p", effect: "overtime", value: 1, position: { x: 100, y: 200 }, spawnedAtSeconds: 0, expiresAtSeconds: 100 }],
      chestLoot: [{ id: "l", reward: "r", x: 300, y: 310, vx: 0, vy: 0, bornActiveSeconds: 0, settled: true }],
      bugs: [{ id: "b", effect: "bigBang", position: { x: 50, y: 60 }, velocity: { x: 0, y: 5 }, wander: 0, wanderSeed: 0, spawnedAtSeconds: 0, expiresAtSeconds: 100 }],
      charges: [
        { fuse: { x: 400, y: 410 }, radius: 24, targetId: "t", blastRadius: 90, delaySeconds: 3, armedAt: null, blown: false },
        { fuse: { x: 1, y: 1 }, radius: 24, targetId: "t", blastRadius: 90, delaySeconds: 3, armedAt: null, blown: true },
      ],
      circuit: { terminals: [{ id: "t1", x: 500, y: 510, radius: 16, lit: true, ballId: "z" }] },
    } as unknown as Partial<CanvasGameState>);
    const poses = propPoses(game, 1000);
    expect(poses.map(p => p.kind).sort()).toEqual(["bug", "charge", "loot", "pickup", "terminal"]);
    const pickup = poses.find(p => p.kind === "pickup")!;
    expect([pickup.x, pickup.z]).toEqual([100, 200]);
    // Hovering clear of the floor at the bottom of its bob.
    expect(pickup.y - PICKUP_GEM.radius * 1.3).toBeGreaterThan(0);
    const loot = poses.find(p => p.kind === "loot")!;
    expect(loot.y - LOOT_GEM * 1.3).toBeGreaterThanOrEqual(-LOOT_GEM * 0.11);
    // A bug faces where it is going (straight down the board here).
    expect(poses.find(p => p.kind === "bug")!.yaw).toBeCloseTo(Math.PI / 2);
  });

  it("fades an expiring token the way the 2D one did, and never a frozen one", () => {
    const token = { id: "p", effect: "overtime", value: 1, position: { x: 0, y: 0 }, spawnedAtSeconds: 0, expiresAtSeconds: 10 };
    const late = board({ activePlaySeconds: 9.5, pickups: [token] } as unknown as Partial<CanvasGameState>);
    expect(propPoses(late, 0)[0].opacity).toBeLessThan(1);
    const frozen = board({ activePlaySeconds: 9.5, freezePickups: true, pickups: [token] } as unknown as Partial<CanvasGameState>);
    expect(propPoses(frozen, 0)[0].opacity).toBe(1);
  });

  it("drops the flat bodies under the 3D board but keeps what lies on the floor", () => {
    const src = read("src/lib/rendering/sleek/propLayer.ts");
    expect(src).toMatch(/hybrid = false/);
    expect(read("src/lib/rendering/sleek/SleekRenderer.ts")).toMatch(/this\.props\.hybrid = true/);
  });
});

describe("floor zones as plates", () => {
  it("lays one low plate per zone, exactly over it", () => {
    const game = board({
      coloredAreas: [{ x: 10, y: 20, width: 100, height: 50, kind: "const" }],
      gravityWells: [{ x: 200, y: 200, width: 80, height: 80 }],
      slowAreas: [{ x: 400, y: 400, width: 60, height: 60 }],
      fenceZones: [{ x: 600, y: 600, width: 90, height: 40, speed: 0.5 }],
    } as unknown as Partial<CanvasGameState>);
    const plates = collectPlates(game);
    expect(plates).toHaveLength(4);
    expect(plates[0].vertices).toEqual([{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 70 }, { x: 10, y: 70 }]);
    for (const p of plates) expect(p.height).toBe(PLATE_HEIGHT);
    // Ground, not furniture: far under a ball and under the lowest role.
    expect(PLATE_HEIGHT).toBeLessThan(HEIGHTS.slab * ROLE_RISE.membrane);
  });
});
