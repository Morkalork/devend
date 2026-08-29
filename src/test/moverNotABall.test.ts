/**
 * A mover must not read as a ball, and the drag must actually be wired up.
 *
 * Testers mistook round movers for balls, and they were right to: a lit disc
 * with a rim highlight is exactly what a ball is in this renderer, and the
 * lodestone ball is orange as well. Colour was never going to separate them.
 *
 * So the difference is structural, and that is what is asserted here rather
 * than any particular shade. A ball is round all the way through: its body is a
 * circle, its rim is an arc, its trail is a smear. A mover gets straight lines
 * INSIDE it and a rail underneath. No ball in the game draws a polygon on
 * itself, so "the mover layer emits polygons for a circular mover" is a real
 * statement about the read, and it survives any repaint.
 *
 * The second half is wiring. moverFriction.test.ts proves the arithmetic; this
 * proves updateMovers actually calls it, which is the half that can be quietly
 * correct and disconnected.
 */
import { describe, it, expect } from "vitest";
import { Graphics } from "pixi.js";
import { EntityLayer } from "@/lib/rendering/sleek/entityLayer";
import { lightScope } from "@/lib/rendering/sleek/light";
import { updateMoversFn } from "@/lib/physics/updateMovers";
import { buildMoverPolygon, type MoverState } from "@/lib/physics/moverState";
import type { CanvasGameState } from "@/types/gameState";
import type { Wall } from "@/lib/wallGeometry";

const W2S = (x: number, y: number) => ({ x, y });

const mover = (over: Partial<MoverState> = {}): MoverState => {
  const m = {
    id: "m1", shape: "circle", homeX: 300, homeY: 300, radius: 20,
    axis: "horizontal", range: 200, speed: 60, offset: 0, direction: 1,
    polygon: { vertices: [] },
    ...over,
  } as MoverState;
  m.polygon = buildMoverPolygon(m);
  return m;
};

const scene = (over: Partial<CanvasGameState> = {}): CanvasGameState => ({
  movers: [mover()], walls: [], obstaclePolygons: [], mirrorPolygons: [],
  destructibles: [], phasingObjects: [], lockedBallsCount: 0, mapMutator: null,
  ...over,
} as unknown as CanvasGameState);

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Every built shape type in a Graphics, e.g. ["circle", "polygon"]. */
function shapeTypes(g: any): string[] {
  const out: string[] = [];
  const paths: any[] = [];
  for (const ins of g.context?.instructions ?? []) if (ins.data?.path) paths.push(ins.data.path);
  if (g.context?._activePath) paths.push(g.context._activePath);
  for (const p of paths) {
    for (const prim of p.shapePath?.shapePrimitives ?? []) out.push(prim.shape.type);
  }
  return out;
}
/** Every point a Graphics built, flat, for extent and rotation comparisons. */
function points(g: any): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const paths: any[] = [];
  for (const ins of g.context?.instructions ?? []) if (ins.data?.path) paths.push(ins.data.path);
  if (g.context?._activePath) paths.push(g.context._activePath);
  for (const p of paths) {
    for (const prim of p.shapePath?.shapePrimitives ?? []) {
      const pts: number[] = (prim.shape as any).points ?? [];
      for (let i = 0; i + 1 < pts.length; i += 2) out.push([pts[i], pts[i + 1]]);
    }
  }
  return out;
}

/**
 * How far the drawn geometry reaches horizontally.
 *
 * Not "the longest single span": the rail is DASHED, so its longest segment is
 * one dash (or an end cap), and measuring that would report the same number for
 * a rail of any length. The extent is the thing the rail is claiming.
 */
function widthOf(g: any): number {
  const xs = points(g).map(p => p[0]);
  return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
}
const layerGraphics = (layer: EntityLayer, name: string) =>
  (layer as unknown as Record<string, unknown>)[name] as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const drawn = (game: CanvasGameState) => {
  const layer = new EntityLayer();
  const light = lightScope({ left: 0, top: 0, width: 900, height: 900, scale: 1 } as never, 0);
  layer.sync(game, light, new Graphics(), W2S, 1);
  return layer;
};

describe("a round mover does not read as a ball", () => {
  it("draws straight-edged marks on its body, which no ball does", () => {
    const layer = drawn(scene());
    expect(
      shapeTypes(layerGraphics(layer, "bodies")),
      "the mover body is circles only, exactly like a ball",
    ).toContain("polygon");
  });

  it("shows the track it is bolted to", () => {
    // The other half of the confusion: a mover appeared to roam the board, which
    // is what a ball does. The rail says it runs on a line, and how far.
    const layer = drawn(scene());
    const rails = layerGraphics(layer, "rails");
    expect(shapeTypes(rails).length, "no rail was drawn at all").toBeGreaterThan(0);
  });

  it("draws the rail the full length of the patrol", () => {
    // A rail that understates where the hazard reaches is worse than none.
    const wide = drawn(scene({ movers: [mover({ range: 400 })] }));
    const narrow = drawn(scene({ movers: [mover({ range: 100 })] }));
    expect(widthOf(layerGraphics(wide, "rails"))).toBeCloseTo(400, 0);
    expect(widthOf(layerGraphics(narrow, "rails"))).toBeCloseTo(100, 0);
  });

  it("turns as it travels, so it reads as a roller", () => {
    // The centre is PINNED (homeX cancels the offset) so the only thing that can
    // differ between these two frames is the rotation of the bars. Without that
    // the whole body just translates and the comparison proves nothing.
    const at = (offset: number) => points(layerGraphics(
      drawn(scene({ movers: [mover({ offset, homeX: 300 - offset })] })), "bodies",
    )).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

    expect(at(0), "the bars do not turn, so it slides rather than rolls")
      .not.toEqual(at(37));
  });
});

describe("the drag is actually wired into the step", () => {
  const STEP = 1 / 60;

  const advance = (walls: Wall[]) => {
    const m = mover({ offset: 0 });
    const game = scene({
      movers: [m], walls,
      moverFenceDragPerFence: 0.45, moverFenceDragFloor: 0.3,
    } as Partial<CanvasGameState>);
    updateMoversFn(STEP, game);
    return { moved: m.offset, game };
  };

  it("moves further in clear air than through a fence", () => {
    const free = advance([]);
    const blocked = advance([
      { id: "wall-1", start: { x: 300, y: 0 }, end: { x: 300, y: 600 }, thickness: 6 } as Wall,
    ]);
    expect(blocked.moved).toBeGreaterThan(0);
    expect(blocked.moved, "the fence made no difference to the patrol").toBeLessThan(free.moved);
  });

  it("publishes the contact so something can draw it", () => {
    const blocked = advance([
      { id: "wall-1", start: { x: 300, y: 0 }, end: { x: 300, y: 600 }, thickness: 6 } as Wall,
    ]);
    expect(blocked.game.moverFriction ?? []).toHaveLength(1);
  });

  it("clears the contacts once the mover is past", () => {
    // Stale sparks would hang in the air on a fence the mover has left behind.
    const free = advance([]);
    expect(free.game.moverFriction ?? []).toEqual([]);
  });
});
