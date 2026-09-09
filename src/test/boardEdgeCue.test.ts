/**
 * Live outer walls, as the player sees them.
 *
 * Level 14 shipped with a floor that kicks, a lid that damps and two side walls
 * that fire a ball back across, and a perimeter drawn exactly like the other
 * thirteen maps: one green hairline. Reported as "the player must see that the
 * outer edges aren't normal, that they are bouncers".
 *
 * A cue that is merely present is not the thing worth pinning. What is worth
 * pinning is that it agrees with the physics: an edge that gives speed must not
 * read like one that takes it, an arrow must point the way the wall actually
 * throws, and a side that behaves like an ordinary wall must draw NOTHING -
 * advertising a rule the map does not have is worse than saying nothing at all.
 */
import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import { ChromeLayer } from "@/lib/rendering/sleek/chromeLayer";
import { lightScope } from "@/lib/rendering/sleek/light";
import {
  edgeGeometry, edgeLook, edgeWake, EDGE_WAKE_REACH,
} from "@/lib/rendering/sleek/edgeCue";
import { PALETTE } from "@/lib/rendering/sleek/palette";
import { BOARD_SIDES, type BoardEdgeSpecs } from "@/lib/physics/boardEdges";
import { createRectPolygon } from "@/lib/polygon";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import { LADDER } from "./fixtures/maps";

const BOUNDS = { minX: 45, minY: 45, maxX: 855, maxY: 855 };

describe("where a side is", () => {
  it("puts each side on its own bound, with the way in", () => {
    const top = edgeGeometry("top", BOUNDS);
    expect([top.start.y, top.end.y]).toEqual([45, 45]);
    expect(top.inward).toEqual({ x: 0, y: 1 });

    const bottom = edgeGeometry("bottom", BOUNDS);
    expect([bottom.start.y, bottom.end.y]).toEqual([855, 855]);
    expect(bottom.inward).toEqual({ x: 0, y: -1 });

    const left = edgeGeometry("left", BOUNDS);
    expect([left.start.x, left.end.x]).toEqual([45, 45]);
    expect(left.inward).toEqual({ x: 1, y: 0 });

    const right = edgeGeometry("right", BOUNDS);
    expect([right.start.x, right.end.x]).toEqual([855, 855]);
    expect(right.inward).toEqual({ x: -1, y: 0 });
  });

  it("spans the whole side, so the band cannot stop short of a corner", () => {
    for (const side of BOARD_SIDES) {
      const g = edgeGeometry(side, BOUNDS);
      expect(Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y), side)
        .toBeCloseTo(BOUNDS.maxX - BOUNDS.minX, 6);
    }
  });
});

describe("what a side is drawn as", () => {
  it("says nothing about a wall that behaves like a wall", () => {
    // The one that matters most. `kick: 1` and an empty spec are both legal
    // YAML and both mean "ordinary", and a band on either teaches a lie.
    expect(edgeLook("top", undefined)).toBeNull();
    expect(edgeLook("top", {})).toBeNull();
    expect(edgeLook("top", { kick: 1 })).toBeNull();
  });

  it("separates giving speed from taking it", () => {
    const fast = edgeLook("bottom", { kick: 1.15 })!;
    const slow = edgeLook("top", { kick: 0.85 })!;
    expect(fast.kind).toBe("faster");
    expect(slow.kind).toBe("slower");
    expect(fast.colour, "a trampoline and a cushion look the same")
      .not.toBe(slow.colour);
    // Warm sprung orange is already the game's word for "this made your ball
    // faster"; a live floor borrows the bumper's rather than inventing one.
    expect(fast.colour).toBe(PALETTE.bouncer);
  });

  it("marks a speed-up with two chevrons and everything else with one", () => {
    expect(edgeLook("bottom", { kick: 1.15 })!.arrows).toBe(2);
    expect(edgeLook("top", { kick: 0.85 })!.arrows).toBe(1);
    expect(edgeLook("left", { bearing: "right" })!.arrows).toBe(1);
  });

  it("points the arrow the way the wall actually throws", () => {
    // A cue that points the wrong way is worse than none: the player commits
    // cuts to it.
    expect(edgeLook("left", { bearing: "right" })!.direction).toEqual({ x: 1, y: 0 });
    expect(edgeLook("right", { bearing: "left" })!.direction).toEqual({ x: -1, y: 0 });
    // No bearing: a ball leaves straight off the wall, so the arrow points in.
    expect(edgeLook("bottom", { kick: 1.2 })!.direction).toEqual({ x: 0, y: -1 });
    expect(edgeLook("top", { kick: 0.8 })!.direction).toEqual({ x: 0, y: 1 });
  });

  it("takes colour from the speed and direction from the bearing when a side does both", () => {
    const both = edgeLook("left", { bearing: "right", kick: 1.3 })!;
    expect(both.kind).toBe("faster");
    expect(both.direction).toEqual({ x: 1, y: 0 });
  });

  it("draws a bigger kick louder, and never louder than full", () => {
    const gentle = edgeLook("bottom", { kick: 1.05 })!.strength;
    const hard = edgeLook("bottom", { kick: 1.4 })!.strength;
    expect(hard).toBeGreaterThan(gentle);
    expect(edgeLook("bottom", { kick: 4 })!.strength).toBeLessThanOrEqual(1);
    expect(gentle, "a live wall that is nearly invisible is not a cue").toBeGreaterThan(0.4);
  });
});

describe("a wall waking up as a ball arrives", () => {
  const ball = (x: number, y: number) => ({ position: { x, y } } as Ball);

  it("is nothing with the board empty", () => {
    for (const side of BOARD_SIDES) expect(edgeWake(side, BOUNDS, []), side).toBe(0);
  });

  it("peaks at contact and fades with distance", () => {
    const near = edgeWake("bottom", BOUNDS, [ball(400, 850)]);
    const mid = edgeWake("bottom", BOUNDS, [ball(400, 855 - EDGE_WAKE_REACH / 2)]);
    const far = edgeWake("bottom", BOUNDS, [ball(400, 400)]);
    expect(near).toBeGreaterThan(0.9);
    expect(mid).toBeCloseTo(0.5, 1);
    expect(far).toBe(0);
  });

  it("lights only the side the ball is at", () => {
    const balls = [ball(400, 850)];
    expect(edgeWake("bottom", BOUNDS, balls)).toBeGreaterThan(0.9);
    expect(edgeWake("top", BOUNDS, balls)).toBe(0);
  });

  it("takes the nearest of several balls", () => {
    expect(edgeWake("left", BOUNDS, [ball(600, 400), ball(50, 400)]))
      .toBeGreaterThan(0.9);
  });

  it("never runs past 1, however far a ball is resolved into the wall", () => {
    // A ball mid-resolution sits slightly OUTSIDE the bound, which would push
    // an unclamped wake over 1 and take every alpha it multiplies with it.
    expect(edgeWake("bottom", BOUNDS, [ball(400, 900)])).toBe(1);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function graphicsIn(node: Container, found: Graphics[] = []): Graphics[] {
  if (node instanceof Graphics) found.push(node);
  for (const child of node.children ?? []) graphicsIn(child as Container, found);
  return found;
}

/** How many fills and strokes a subtree issued. */
function drawnOps(node: Container): number {
  let n = 0;
  for (const g of graphicsIn(node)) n += ((g as any).context?.instructions ?? []).length;
  return n;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("the cue reaches the screen", () => {
  const BOARD = { left: 100, top: 200, width: 900, height: 900, scale: 1 };
  const W2S = (x: number, y: number) => ({ x: BOARD.left + x, y: BOARD.top + y });
  const light = lightScope(BOARD, 0);

  const state = (edges: BoardEdgeSpecs | undefined, balls: Ball[] = []): CanvasGameState => ({
    boardRect: { ...BOARD },
    boardPolygon: createRectPolygon(BOUNDS.minX, BOUNDS.minY, BOUNDS.maxX, BOUNDS.maxY),
    boardEdges: edges,
    balls,
    spaceGrid: null,
    activePlaySeconds: 3,
    gravityConfig: null,
    boardTilt: null,
    levelComplete: false,
  } as unknown as CanvasGameState);

  const ops = (edges: BoardEdgeSpecs | undefined, balls: Ball[] = []): number => {
    const layer = new ChromeLayer();
    layer.sync(state(edges, balls), light, W2S, 1, 1000, 20);
    return drawnOps(layer.container);
  };

  it("costs a map without live walls nothing", () => {
    expect(ops({ bottom: { kick: 1.2 } })).toBeGreaterThan(ops(undefined));
  });

  it("draws nothing extra for sides that do nothing", () => {
    expect(ops({ top: {}, bottom: { kick: 1 } })).toBe(ops(undefined));
  });

  it("draws more the more sides a map makes live", () => {
    const one = ops({ bottom: { kick: 1.2 } });
    const all = ops({
      bottom: { kick: 1.2 }, top: { kick: 0.8 },
      left: { bearing: "right" }, right: { bearing: "left" },
    });
    expect(all).toBeGreaterThan(one);
  });

  it("never opens a path at the canvas origin", () => {
    // The chevrons are a moveTo/lineTo run, and a shape that forgets to open
    // its own subpath draws a beam from (0,0) across the whole board. That has
    // happened in this renderer before.
    const layer = new ChromeLayer();
    layer.sync(state({ bottom: { kick: 1.2 }, left: { bearing: "right" } }), light, W2S, 1, 1000, 20);
    /* eslint-disable @typescript-eslint/no-explicit-any */
    for (const g of graphicsIn(layer.container)) {
      const ctx = (g as any).context;
      const paths: any[] = [];
      for (const ins of ctx?.instructions ?? []) if (ins.data?.path) paths.push(ins.data.path);
      if (ctx?._activePath) paths.push(ctx._activePath);
      for (const path of paths) {
        for (const prim of path.shapePath?.shapePrimitives ?? []) {
          const pts = ((prim.shape as any).points ?? []) as number[];
          for (let i = 0; i + 1 < pts.length; i += 2) {
            expect(
              Math.hypot(pts[i], pts[i + 1]) > 0.5,
              `a path point sits on the origin; the board starts at (${BOARD.left},${BOARD.top})`,
            ).toBe(true);
          }
        }
      }
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });
});

describe("level 14 is legible", () => {
  const l14 = LADDER.find(l => l.level === 14)!;

  it("gives every side it authors something to see", () => {
    // The map's whole premise is that the outer walls behave. A side that
    // behaves and does not show it is the bug this was written for.
    for (const [side, spec] of Object.entries(l14.boardEdges!)) {
      expect(edgeLook(side as never, spec), `${side} is live and invisible`).toBeTruthy();
    }
  });

  it("reads as trampoline, cushion and two walls that aim", () => {
    const look = (side: keyof NonNullable<typeof l14.boardEdges>) =>
      edgeLook(side, l14.boardEdges![side])!;
    expect(look("bottom").kind).toBe("faster");
    expect(look("top").kind).toBe("slower");
    expect(look("left").kind).toBe("aim");
    expect(look("right").kind).toBe("aim");
    expect(look("left").direction).toEqual({ x: 1, y: 0 });
    expect(look("right").direction).toEqual({ x: -1, y: 0 });
  });
});
