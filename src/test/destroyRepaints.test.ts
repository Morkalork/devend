/**
 * Taking an obstacle out of the model has to tell the renderer.
 *
 * The obstacles are drawn on the STATIC layer, which only redraws when
 * something marks it dirty. `processDestroysFn` did that inside its
 * `if (opened > 0)` block - the branch that runs when a destroy reopened
 * ground - so a destroy that reopened NOTHING removed the polygon and its edge
 * walls from the model and left the last render of the wall on screen.
 *
 * Two ways to reopen nothing, both real: ground that was already captured
 * (breaking a wall inside territory you have sealed), and a sliver too thin for
 * any cell centre to land inside it. Level 16's chest cover is 22 units tall
 * against a 15-unit grid, which is one row of cell centres if it is lucky.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { processDestroysFn } from "@/lib/physics/destructibles";
import type { CanvasGameState } from "@/types/gameState";
import type { DestructibleState } from "@/types/game";

const poly = (x: number, y: number, w: number, h: number) => ({
  vertices: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
});

function board(over: Partial<CanvasGameState> = {}) {
  const slab: DestructibleState = {
    id: "slab", kind: "breakable", hits: 3, maxHits: 3, lastHitAt: 0,
    destroyed: true, obstaclePolygon: poly(100, 100, 40, 200),
  };
  return {
    destructibles: [slab], pendingDestroys: [slab],
    obstaclePolygons: [slab.obstaclePolygon!], mirrorPolygons: [],
    walls: [{ id: "obstacle-slab-edge-0", start: { x: 100, y: 100 }, end: { x: 140, y: 100 } }],
    objectDebris: [], stackObjects: [], balls: [], movers: [],
    // No grid: nothing can reopen, so `opened` stays 0 - the exact case that
    // used to skip the repaint.
    spaceGrid: null,
    ...over,
  } as unknown as CanvasGameState;
}

describe("a destroy always marks the static layer dirty", () => {
  it("repaints even when the destroy reopened no ground", () => {
    let repaints = 0;
    const game = board();
    processDestroysFn(game, {
      repaintRegionCanvas: () => { repaints++; },
      setRemainingPercent: () => {},
    }, 7);

    expect(repaints, "the wall was removed from the model but not from the screen")
      .toBeGreaterThan(0);
  });

  it("still takes the obstacle out of the model", () => {
    // The other half: a repaint of a model that still holds the polygon would
    // redraw the wall, so both have to happen.
    const game = board();
    processDestroysFn(game, {
      repaintRegionCanvas: () => {}, setRemainingPercent: () => {},
    }, 7);

    expect(game.obstaclePolygons, "still solid to the fence clipper").toEqual([]);
    expect(game.walls.some(w => w.id.startsWith("obstacle-slab-edge-")),
      "its edge walls survive, so cuts near it are refused").toBe(false);
  });

  it("does not repaint when nothing was queued", () => {
    // The pass returns early on an empty queue, and marking the static layer
    // dirty every frame would throw away the point of having one.
    let repaints = 0;
    const game = board({ pendingDestroys: [] } as Partial<CanvasGameState>);
    processDestroysFn(game, {
      repaintRegionCanvas: () => { repaints++; }, setRemainingPercent: () => {},
    }, 7);
    expect(repaints).toBe(0);
  });
});

/**
 * The bot harness runs the same end-of-frame passes the real loop runs.
 *
 * headlessGame's contract is that it is the subset of useGameLoop that moves
 * the world, "the same functions in the same order", and it was missing three:
 * charges, wall breaks and destroys. The gap was invisible because everything
 * they do is a CONSEQUENCE - a destructible reached zero hits, got queued, and
 * nothing ever emptied the queue. So `destroyed` flipped and the world did not
 * change: no space reopened, no stack toppled, no chest paid, no gated area
 * unsealed. Every bot run in the repo's history was played on a board where
 * breaking something did nothing, while reporting that it had broken something.
 *
 * Source-level because the failure is structural: two lists that have to agree
 * and nothing in the type system makes them.
 */
describe("the headless loop keeps up with the real one", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it.each(["tickCharges", "processWallBreaksFn", "processDestroysFn"])(
    "runs %s, like useGameLoop does", (fn) => {
      expect(read("src/lib/bot/headlessGame.ts"), `the bot never runs ${fn}`)
        .toContain(`${fn}(`);
    });

  it("re-checks the win after a destroy, as the loop does", () => {
    // A destroy can capture pocket cells and take the remaining space past the
    // goal with no fence involved. Without this the map shows CLEAR and never
    // ends - which a bot would report as an unwinnable map.
    expect(read("src/lib/bot/headlessGame.ts")).toContain("checkSpaceWin(");
  });

  it("keeps every pass useGameLoop calls at the end of a frame", () => {
    // Reads the real loop rather than a hand-written list, so a pass added
    // there shows up here as a failure instead of being silently un-simulated.
    const loop = read("src/hooks/useGameLoop.ts");
    const bot = read("src/lib/bot/headlessGame.ts");
    const passes = [...loop.matchAll(/callbacks\.(process\w+)\?\.\(\)/g)].map(m => m[1]);
    expect(passes.length, "no end-of-frame passes found: has the loop been renamed?")
      .toBeGreaterThan(0);
    for (const pass of passes) {
      // useGameLoop calls `processDestroys`; the harness calls the underlying
      // `processDestroysFn` directly, having no React callback layer.
      expect(bot, `useGameLoop runs ${pass} and the bot does not`)
        .toContain(`${pass}Fn(`);
    }
  });
});
