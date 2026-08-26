/**
 * A turning board must not leave its cached geometry behind.
 *
 * On a gravity map the whole board rotates (boardTilt.ts), and the rotation is
 * applied in ONE place: the world-to-screen every layer is handed. That is the
 * design, and it works - for the layers that redraw every frame.
 *
 * It does not work for the layers that CACHE. Two of them bake geometry through
 * that transform and then guard the bake behind a key that says nothing about
 * the angle:
 *
 *   - boardLayer.syncGeometry keys on the board RECT alone, and its bake is the
 *     captured/live split and the lock tints. The rect does not change when the
 *     board turns, so the split and the tints stay frozen at whatever angle
 *     they were last traced at while the walls, balls and areas swing round.
 *     Reported from a real session as a lock that "didn't fill its entire
 *     area": the tint is the right shape, at the wrong rotation.
 *
 *   - wallLayer.syncMask keys on the rect, the scale and two counts, and its
 *     bake is the board polygon minus the obstacle footprints - the mask every
 *     fence is drawn through. Stale, it clips fences against an outline and a
 *     set of holes that have since rotated away, which reads on screen as an
 *     invisible object breaking fence generation.
 *
 * areaLayer already gets this right (`|${Math.round(tilt * 2000)}` in its key,
 * with a comment saying exactly why), which is what makes these two omissions
 * rather than an open design question.
 *
 * The rule these tests pin: if a bake goes through w2s, the angle is part of
 * its identity.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { Container, Graphics } from "pixi.js";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { lightScope } from "@/lib/rendering/sleek/light";
import { BoardLayer } from "@/lib/rendering/sleek/boardLayer";
import { WallLayer } from "@/lib/rendering/sleek/wallLayer";
import { tiltWorldPoint } from "@/lib/boardConstants";
import { traceActiveContours } from "@/lib/rendering/regionContour";
import type { LevelData, LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

/**
 * The real contour tracer, wrapped so the bake can be COUNTED.
 *
 * Putting the transform in the cache key fixes staleness, but it would also
 * "fix" it by never caching at all, and every assertion above would still be
 * green while the board re-traced its whole contour set sixty times a second.
 * So the cache is tested as a cache too.
 */
vi.mock("@/lib/rendering/regionContour", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rendering/regionContour")>();
  return { ...actual, traceActiveContours: vi.fn(actual.traceActiveContours) };
});

const levels = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels;

const BOARD_RECT = { left: 0, top: 0, width: 900, height: 900, scale: 1 };

/** The renderer's own transform, at a given board angle. */
const w2sAt = (angle: number) => (x: number, y: number) => {
  const p = tiltWorldPoint(x, y, angle);
  return { x: p.x, y: p.y };
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function graphicsIn(node: Container, found: Graphics[] = []): Graphics[] {
  if (node instanceof Graphics) found.push(node);
  for (const child of node.children ?? []) graphicsIn(child as Container, found);
  return found;
}

/** Every point every Graphics under `node` currently holds, as one signature. */
function drawnPoints(...nodes: Array<Container | Graphics>): number[] {
  const out: number[] = [];
  for (const node of nodes) {
    for (const g of graphicsIn(node as Container)) {
      const paths: any[] = [];
      for (const ins of (g as any).context?.instructions ?? []) {
        if (ins.data?.path) paths.push(ins.data.path);
      }
      if ((g as any).context?._activePath) paths.push((g as any).context._activePath);
      for (const path of paths) {
        for (const prim of path.shapePath?.shapePrimitives ?? []) {
          for (const n of ((prim.shape as any).points ?? []) as number[]) out.push(n);
        }
      }
    }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** How far the drawn geometry moved between two bakes. */
function biggestShift(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;  // shape changed outright
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

function state(level: LevelConfig): CanvasGameState {
  const game = createInitialGameData(level, level.level, DEFAULT_MODIFIERS) as unknown as CanvasGameState;
  const g = game as unknown as Record<string, unknown>;
  g.boardRect = { ...BOARD_RECT };
  g.activePlaySeconds = 0;
  for (const k of ["activeWalls", "wallImpacts", "phasingObjects", "chains"]) g[k] ??= [];
  return game;
}

/**
 * A quarter of a turn in. Big enough that a stale bake is unmistakable, and a
 * real angle the ease actually passes through rather than a contrived one.
 */
const TURNED = Math.PI / 8;

describe("cached geometry follows the board round", () => {
  const level = levels.find(l => l.id === "level-19")!;
  const light = lightScope(BOARD_RECT, 0);

  beforeEach(() => { vi.mocked(traceActiveContours).mockClear(); });

  it("re-traces the captured/live split when the board turns", () => {
    const game = state(level);
    const board = new BoardLayer();

    board.sync(game, light, w2sAt(0), true);
    const flat = drawnPoints(board.container, board.shadowMask);
    expect(flat.length, "the board layer drew nothing to compare").toBeGreaterThan(20);

    // Exactly what the renderer does on the next frame of a turn: same board
    // rect, nothing cut, a new angle.
    board.sync(game, light, w2sAt(TURNED), false);
    const turned = drawnPoints(board.container, board.shadowMask);

    expect(
      biggestShift(flat, turned),
      "the live-space split and lock tints stayed at the old angle",
    ).toBeGreaterThan(1);
  });

  it("re-cuts the fence mask when the board turns", () => {
    const game = state(level);
    const walls = new WallLayer();
    const plane = new Graphics();

    // The MASK alone, found by its role in the display list rather than by
    // name. Measuring the whole layer would pass for the wrong reason: the
    // fence bodies are redrawn from scratch every frame, so they move with the
    // board whatever the mask does, and their movement would drown out a mask
    // that never turned.
    const maskOf = (layer: WallLayer): Graphics => {
      for (const child of layer.container.children) {
        const m = (child as Container).mask;
        if (m instanceof Graphics) return m;
      }
      throw new Error("the fence scope is not masked at all");
    };

    walls.sync(game, light, plane, w2sAt(0), 1);
    const mask = maskOf(walls);
    const flat = drawnPoints(mask);
    // The board polygon is four points; the obstacle cut-outs ride the same
    // path. Anything less means the mask was never built.
    expect(flat.length, "the fence mask is empty").toBeGreaterThanOrEqual(8);

    walls.sync(game, light, plane, w2sAt(TURNED), 1);
    const turned = drawnPoints(maskOf(walls));

    expect(
      biggestShift(flat, turned),
      "fences are still being clipped against the old board outline",
    ).toBeGreaterThan(1);
  });

  it("still caches: a settled board re-traces nothing", () => {
    // Between turns the angle holds for seconds at a time, and the whole point
    // of the key is to skip the trace then. A key that changed every frame
    // would pass every test above and quietly re-trace the board forever.
    const game = state(level);
    const board = new BoardLayer();
    const w2s = w2sAt(TURNED);

    board.sync(game, light, w2s, true);
    const afterFirst = vi.mocked(traceActiveContours).mock.calls.length;
    expect(afterFirst, "the first sync never traced").toBeGreaterThan(0);

    for (let i = 0; i < 10; i++) board.sync(game, light, w2s, false);
    expect(
      vi.mocked(traceActiveContours).mock.calls.length,
      "re-traced a board that had not moved",
    ).toBe(afterFirst);

    // ...and it still notices when it DOES move.
    board.sync(game, light, w2sAt(TURNED + 0.2), false);
    expect(
      vi.mocked(traceActiveContours).mock.calls.length,
      "a real turn did not invalidate the bake",
    ).toBeGreaterThan(afterFirst);
  });
});
