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
    expect(src).toMatch(/if \(d\.bomb\) \{\n\s+game\.objectDebris\.push\(spawnDebris\(poly, BOMB_BLAST_COLOR/);
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
