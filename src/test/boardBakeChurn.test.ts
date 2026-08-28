/**
 * The board layer must not re-bake while the game is running.
 *
 * Reported: "this isn't even working on level 1, after just a few seconds it
 * starts lagging something awful." One ball, four walls, nothing on the board.
 *
 * The cause was not the lighting being expensive. It was that BoardLayer draws
 * two BAKED CANVASES - the ambient wash and the panel's drop shadow - and both
 * were keyed partly on the light's position, because when they were written the
 * light was a monitor bolted off the bottom-right corner that could never move.
 * The Lamp made the light a BALL. So every frame the key changed, and every
 * frame the layer allocated a board-sized canvas, filled a radial gradient or a
 * multi-pixel blur into it, uploaded it as a fresh GPU texture and destroyed the
 * last one. Sixty times a second. That is not a slow frame, it is a compounding
 * one, which is why it took a few seconds to become obvious.
 *
 * The fix is that the board layer takes the ROOM light and never the lamp: its
 * wash and its drop shadow are properties of the room the panel sits in, and a
 * lamp lying on the board does not relight the room.
 *
 * This test measures the thing that actually went wrong - how many canvases get
 * allocated - rather than which light was passed. A future refactor could hand
 * the board layer a moving light again for some good reason; what must never
 * happen is a bake per frame.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { BoardLayer } from "@/lib/rendering/sleek/boardLayer";
import { lightScope, lampScope } from "@/lib/rendering/sleek/light";
import type { CanvasGameState } from "@/types/gameState";

const RECT = { left: 0, top: 0, width: 900, height: 900, scale: 1 };
const w2s = (x: number, y: number) => ({ x: RECT.left + x, y: RECT.top + y });

function state(): CanvasGameState {
  return {
    boardRect: { ...RECT },
    spaceGrid: null,
    gridRegions: [],
    balls: [],
    walls: [],
    obstaclePolygons: [],
    mirrorPolygons: [],
    boardPolygon: null,
    assimilations: new Map(),
    coloredAreas: [],
  } as unknown as CanvasGameState;
}

/** Count canvases created, which is what a re-bake actually costs. */
function countCanvases(run: () => void): number {
  const real = document.createElement.bind(document);
  let n = 0;
  const spy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag === "canvas") n++;
    return real(tag);
  }) as typeof document.createElement);
  try { run(); } finally { spy.mockRestore(); }
  return n;
}

afterEach(() => vi.restoreAllMocks());

describe("the board layer's baked canvases", () => {
  it("bakes a bounded number of times across a whole run of frames", () => {
    // THE regression. Sixty frames of a moving light used to be sixty board-
    // sized canvas allocations plus sixty texture uploads. The board's size is
    // the only thing either bake legitimately depends on, and that does not
    // change while a map is being played.
    const layer = new BoardLayer();
    const game = state();

    const n = countCanvases(() => {
      for (let f = 0; f < 60; f++) {
        // A light travelling right across the board, which is what a lamp on a
        // moving ball does.
        const moving = lampScope(RECT, 100 + f * 12, 400 + f * 3, 1, 0xffffff);
        layer.sync(game, moving, w2s, false);
      }
    });

    // Two bakes exist (wash, drop). Anything near 60 means one per frame.
    expect(n, "the board layer is re-baking as the light moves").toBeLessThanOrEqual(4);
    layer.destroy();
  });

  it("still bakes at least once, so this is not passing on a dead layer", () => {
    // A layer that never bakes anything would sail through the test above.
    // jsdom has no 2D context, so the bakes bail after allocating - which is
    // exactly the allocation being counted, and enough to prove they ran.
    const layer = new BoardLayer();
    const n = countCanvases(() => layer.sync(state(), lightScope(RECT, 0), w2s, true));
    expect(n, "no bake happened at all").toBeGreaterThan(0);
    layer.destroy();
  });

  it("does not re-bake when only the light's brightness changes", () => {
    // The monitor flickers every frame. That rides the sprite's alpha and must
    // never reach the bake, or the flicker alone would rebuild both canvases
    // sixty times a second even with a stationary light.
    const layer = new BoardLayer();
    const game = state();
    layer.sync(game, lightScope(RECT, 0), w2s, true);

    const n = countCanvases(() => {
      for (let f = 0; f < 30; f++) layer.sync(game, lightScope(RECT, f * 17), w2s, false);
    });
    expect(n, "the flicker is reaching the bake").toBe(0);
    layer.destroy();
  });
});
