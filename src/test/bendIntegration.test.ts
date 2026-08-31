/**
 * The bend has to reach the game, not just the library.
 *
 * bend.ts can be perfect and still do nothing: it is a parameter on a level
 * entity, and something has to read it while the board is being built. That
 * wiring is the part with no natural place to fail loudly - a `bend` nobody
 * looks at produces a straight wall and no error at all - so it gets its own
 * test through createInitialGameData, the real one the game calls.
 *
 * Earlier this session a pricing test recomputed the arithmetic alongside the
 * hook and stayed green when the multiplier was deleted from the code. This is
 * the same trap, and the answer is the same: assert on what the ENGINE built,
 * never on a number this file worked out for itself.
 */
import { describe, it, expect } from "vitest";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { setRunSeedText } from "@/lib/runRng";
import type { LevelConfig, WallRectEntity, WallPolygonEntity } from "@/types/level";
import type { Polygon } from "@/lib/polygon";

/**
 * A minimal level with one obstacle. variety 0 and no random shapes, so the
 * only thing that can change the obstacle's outline is the bend under test.
 */
function levelWith(entity: WallRectEntity | WallPolygonEntity): LevelConfig {
  return {
    id: "bend-test", level: 1, name: "Bend", sizeThreshold: 30, expectedCuts: 4,
    points: 100, variety: 0, randomShapes: 0,
    balls: [{ id: "b1", type: "red", startX: 700, startY: 700 }],
    entities: [entity],
  } as unknown as LevelConfig;
}

const BAR = {
  id: "bar", kind: "wall", shape: "rect", x: 200, y: 400, width: 400, height: 24,
} as WallRectEntity;

function buildObstacle(entity: WallRectEntity | WallPolygonEntity): Polygon {
  setRunSeedText("bend-fixture");
  const data = createInitialGameData(levelWith(entity), 1, DEFAULT_MODIFIERS);
  setRunSeedText(null);
  const found = data.obstaclePolygons.find(p => p.vertices.length > 0);
  expect(found, "the level built no obstacle at all").toBeDefined();
  return found!;
}

/** Largest gap between an outline's vertices and the straight rect it came from. */
function bowHeight(poly: Polygon): number {
  const ys = poly.vertices.map(v => v.y);
  return Math.max(...ys) - Math.min(...ys);
}

describe("a bend authored in the level reaches the board", () => {
  it("builds a straight wall as four corners when nothing is bent", () => {
    const poly = buildObstacle(BAR);
    // The baseline. If this ever stops being a plain rect, the comparisons
    // below stop meaning what they say.
    expect(poly.vertices.length).toBe(4);
    expect(bowHeight(poly)).toBeCloseTo(24, 0);
  });

  it("builds a bent wall as an arc", () => {
    const poly = buildObstacle({ ...BAR, bend: 0.5 });
    // Many vertices, and standing far taller than its own 24-unit thickness.
    expect(poly.vertices.length).toBeGreaterThan(40);
    expect(bowHeight(poly)).toBeGreaterThan(60);
  });

  it("bows the other way for the opposite sign", () => {
    const up = buildObstacle({ ...BAR, bend: 0.5 });
    const down = buildObstacle({ ...BAR, bend: -0.5 });
    const meanY = (p: Polygon) => p.vertices.reduce((n, v) => n + v.y, 0) / p.vertices.length;
    expect(meanY(up)).toBeGreaterThan(412);
    expect(meanY(down)).toBeLessThan(412);
  });

  it("keeps the wall's thickness, which is the whole point of the arc warp", () => {
    const poly = buildObstacle({ ...BAR, bend: 0.6 });
    // Every vertex must sit on one of the two offset curves, so the outline's
    // area stays close to the original 400 x 24 = 9600. A shear would lose
    // area at the ends where it pinches.
    let area = 0;
    const v = poly.vertices;
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length];
      area += a.x * b.y - b.x * a.y;
    }
    expect(Math.abs(area) / 2).toBeGreaterThan(9200);
    expect(Math.abs(area) / 2).toBeLessThan(10000);
  });

  it("honours per-edge curves on a polygon, in the direction of their sign", () => {
    const POINTS = [[200, 400], [600, 400], [600, 424], [200, 424]] as [number, number][];
    const poly = (curves?: number[]) => buildObstacle({
      id: "p", kind: "wall", shape: "polygon", points: POINTS, curves,
    } as WallPolygonEntity);

    const straight = poly();
    const out = poly([-0.2, 0, 0, 0]);
    const into = poly([0.2, 0, 0, 0]);

    expect(out.vertices.length).toBeGreaterThan(straight.vertices.length);
    // Edge 0 runs left to right, so its left normal points at +y - which is
    // DOWN the screen, into the bar. A positive curve therefore dishes the top
    // edge inward and a negative one bulges it out. Asserted both ways round
    // rather than guessing which one is "outward": the contract is that the
    // sign controls the direction, not that either sign is the outside.
    const top = (p: Polygon) => Math.min(...p.vertices.map(v => v.y));
    expect(top(out)).toBeLessThan(top(straight) - 40);
    expect(top(into)).toBe(top(straight));
    const meanY = (p: Polygon) => p.vertices.reduce((n, v) => n + v.y, 0) / p.vertices.length;
    expect(meanY(into)).toBeGreaterThan(meanY(out));
  });

  it("carves the bent shape out of the space grid, not the straight one", () => {
    // The obstacle polygon feeding the renderer is only half of it: the grid is
    // what decides where a fence may be started and what counts as captured. If
    // the bend reached one and not the other, a wall would look bent and play
    // straight.
    setRunSeedText("bend-fixture");
    const bentData = createInitialGameData(levelWith({ ...BAR, bend: 0.6 }), 1, DEFAULT_MODIFIERS);
    setRunSeedText("bend-fixture");
    const flatData = createInitialGameData(levelWith(BAR), 1, DEFAULT_MODIFIERS);
    setRunSeedText(null);

    // A point clear of the straight bar but inside the bow of the bent one.
    const cells = (d: typeof bentData) => d.spaceGrid.cells.filter(c => !c).length;
    expect(cells(bentData), "the bend never reached the grid").not.toBe(cells(flatData));
  });
});
