/**
 * The wall layer keeps its finished fences (sleek/wallLayer.ts): drawn once
 * and kept while nothing they depend on changes, a fence bending under a hit
 * drawn live, and the 2D board relit the moment its light moves.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Graphics } from "pixi.js";
import { WallLayer } from "@/lib/rendering/sleek/wallLayer";
import { clearWallImpacts, registerWallImpact } from "@/lib/wallImpactEffects";
import type { CanvasGameState } from "@/types/gameState";
import type { LightScope } from "@/lib/rendering/sleek/light";

const square = { vertices: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 900 }, { x: 0, y: 900 }] };
const fence = (id: string, y: number) => ({ id, start: { x: 100, y }, end: { x: 800, y }, thickness: 6 });

function gameWith(walls: ReturnType<typeof fence>[]): CanvasGameState {
  return {
    walls, activeWalls: [], obstaclePolygons: [], phasingObjects: [],
    boardPolygon: square, boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
  } as unknown as CanvasGameState;
}

const w2s = (x: number, y: number) => ({ x, y });
const light = (x = 1000, y = 1000): LightScope => ({ x, y, level: 1, reach: 1e7, color: 0xffffff });

/** Counts the fence segments drawn into the KEPT drawing, frame by frame. */
function spy(layer: WallLayer) {
  const l = layer as unknown as { drawFence: (...a: unknown[]) => void; bodies: Graphics; growBodies: Graphics };
  const o = l.drawFence.bind(layer);
  const counts = { kept: 0, live: 0 };
  l.drawFence = (...a: unknown[]) => { if (l.bodies === l.growBodies) counts.live++; else counts.kept++; o(...a); };
  return counts;
}

beforeEach(() => clearWallImpacts());

describe("the kept fences", () => {
  it("are drawn once and not again while nothing changes", () => {
    const layer = new WallLayer();
    const counts = spy(layer);
    const game = gameWith([fence("a", 300), fence("b", 600)]);
    layer.sync(game, light(), new Graphics(), w2s, 1);
    expect(counts.kept).toBe(2);
    for (let f = 0; f < 10; f++) layer.sync(game, light(), new Graphics(), w2s, 1);
    expect(counts.kept).toBe(2);
  });

  it("are redrawn when a fence is added", () => {
    const layer = new WallLayer();
    const counts = spy(layer);
    const walls = [fence("a", 300)];
    const game = gameWith(walls);
    layer.sync(game, light(), new Graphics(), w2s, 1);
    walls.push(fence("b", 600));
    layer.sync(game, light(), new Graphics(), w2s, 1);
    expect(counts.kept).toBe(3);
  });

  it("draw a fence that is bending live, and keep the rest", () => {
    const layer = new WallLayer();
    const counts = spy(layer);
    const a = fence("a", 300), b = fence("b", 600);
    const game = gameWith([a, b]);
    layer.sync(game, light(), new Graphics(), w2s, 1);
    registerWallImpact(a.start, a.end, { x: 450, y: 300 }, 1);
    counts.kept = 0;
    layer.sync(game, light(), new Graphics(), w2s, 1);
    expect(counts.live).toBe(1);   // a, bending
    expect(counts.kept).toBe(1);   // b, redrawn once without a
    layer.sync(game, light(), new Graphics(), w2s, 1);
    expect(counts.kept).toBe(1);   // and kept while a bends
    expect(counts.live).toBe(2);
  });

  it("relight on any move of the light on the 2D board, but only past the step under the 3D one", () => {
    const flat = new WallLayer();
    const c2 = spy(flat);
    const game = gameWith([fence("a", 300)]);
    flat.sync(game, light(500, 500), new Graphics(), w2s, 1);
    flat.sync(game, light(505, 500), new Graphics(), w2s, 1);
    expect(c2.kept).toBe(2);

    const hybrid = new WallLayer();
    const c3 = spy(hybrid);
    hybrid.sync(game, light(500, 500), new Graphics(), w2s, 1, 32);
    hybrid.sync(game, light(505, 500), new Graphics(), w2s, 1, 32);
    expect(c3.kept).toBe(1);
    hybrid.sync(game, light(560, 500), new Graphics(), w2s, 1, 32);
    expect(c3.kept).toBe(2);
  });

  it("put the kept shadows back on the floor every frame", () => {
    const layer = new WallLayer();
    const game = gameWith([fence("a", 300)]);
    const first = new Graphics();
    layer.sync(game, light(500, 0), first, w2s, 1);
    const again = new Graphics();
    layer.sync(game, light(500, 0), again, w2s, 1);
    expect(again.bounds.width).toBeGreaterThan(0);
    expect(again.bounds.width).toBeCloseTo(first.bounds.width, 3);
  });
});
