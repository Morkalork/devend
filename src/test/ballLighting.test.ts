/**
 * Balls as lights, and the geometry that blocks them.
 *
 * Raising the palette floor (boardBrightness.test.ts) made the board visible;
 * it did not make it lit, because one dim key light off the bottom-right corner
 * produces the same brightness everywhere no matter how far up you turn it. The
 * balls carrying their own light is what puts a moving, local source on the
 * board - and the reason it is a LIGHT rather than a glow is that the board's
 * geometry stops it.
 *
 * That distinction is the whole point and it is entirely in the arithmetic, so
 * it is entirely testable: a wall between a ball and a patch of floor must
 * leave that patch dark, and the quad that does it must be a shape that fills,
 * in reach, and stable as the ball crosses the line it is casting from.
 */
import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import {
  ballLight, shadowQuad, segmentDistance, REACH_RADII, BASE_INTENSITY,
} from "@/lib/rendering/sleek/ballLight";
import { BallLightPass } from "@/lib/rendering/sleek/ballLightPass";
import { PALETTE } from "@/lib/rendering/sleek/palette";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { Pt } from "@/lib/rendering/sleek/pixelGrid";

const AT: Pt = { x: 400, y: 300 };
const R = 18;
const WHITE = 0xffffff;

function ball(over: Partial<Ball> = {}): Ball {
  return {
    id: "red-0",
    position: { x: 400, y: 300 },
    velocity: { x: 250, y: 0 },
    speed: 250,
    radius: R,
    color: "#ff5b5b",
    state: "active",
    ...over,
  } as unknown as Ball;
}

/** Winding-number test: is `p` inside the quad? */
function inside(poly: Pt[], p: Pt): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

/**
 * Does the polygon cross itself?
 *
 * Every non-adjacent pair of edges, not one hand-picked pair: checking only the
 * two projected rays is what let a bow-tie ordering survive this test, because
 * a bow-tie's crossing pair is the OTHER two edges.
 */
function selfIntersects(poly: Pt[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

describe("a ball as a light source", () => {
  it("gives a dormant ball none, because a sleeper is not in the scene yet", () => {
    // It casts no shadow either (ballLayer skips that too). A ball that lights
    // the board is a ball that is playing, and a sleeper is exactly the ball
    // the player cannot interact with yet.
    expect(ballLight(ball({ state: "dormant" }), AT, R, WHITE)).toBeNull();
  });

  it("dims a locked ball rather than switching it off", () => {
    // The body drains toward the accent over ~2s after a lock. Cutting the
    // light at the instant of the catch would punch a hole in the board at the
    // exact moment the player is being congratulated for making one.
    const active = ballLight(ball(), AT, R, WHITE)!;
    const justLocked = ballLight(ball({ state: "won", assimColorFade: 0 }), AT, R, WHITE)!;
    const nearlyGone = ballLight(ball({ state: "won", assimColorFade: 1 }), AT, R, WHITE)!;

    expect(justLocked.intensity).toBeLessThan(active.intensity);
    expect(justLocked.intensity, "a lock puts the light out instantly").toBeGreaterThan(0);
    expect(nearlyGone.intensity).toBeLessThan(justLocked.intensity);
  });

  it("scales its reach with the ball, so a grown ball lights more board", () => {
    const small = ballLight(ball(), AT, 10, WHITE)!;
    const big = ballLight(ball(), AT, 20, WHITE)!;
    expect(big.reach).toBeCloseTo(small.reach * 2, 5);
    expect(small.reach).toBeCloseTo(10 * REACH_RADII, 5);
  });

  it("keeps the ball's hue while pulling it toward white", () => {
    // A pure hue pool of five colours turns the board into a disco; a white one
    // throws away the most useful thing the light could tell you, which is
    // WHICH ball is round that corner. So: pulled, not washed out.
    const red = ballLight(ball({ color: "#ff0000" }), AT, R, 0xff0000)!;
    const g = (red.color >> 8) & 255;
    expect(g, "the pool lost the ball's hue entirely").toBeLessThan(160);
    expect(g, "the pool is raw saturated hue").toBeGreaterThan(0);
    expect(red.color & 255).toBe(g); // whitening lifts both channels equally
  });
});

describe("a wall between the ball and the floor", () => {
  const light = ballLight(ball(), AT, R, WHITE)!;
  // A vertical wall to the right of the ball, well inside the pool.
  const WX = AT.x + 30;
  const quad = shadowQuad(light, WX, AT.y - 40, WX, AT.y + 40)!;

  it("leaves the floor behind it dark", () => {
    expect(quad).toBeTruthy();
    // Straight through the middle of the wall, further out than the wall is.
    expect(inside(quad, { x: WX + 25, y: AT.y }), "the pool shines through the wall").toBe(true);
  });

  it("leaves the floor beside it lit", () => {
    // Level with the ball but on the far side: nothing is between them.
    expect(inside(quad, { x: AT.x - 25, y: AT.y }), "the shadow wraps back around the ball")
      .toBe(false);
    // Past the end of the wall, where the wall does not reach.
    expect(inside(quad, { x: WX + 25, y: AT.y - 90 }), "the wall shadows past its own end")
      .toBe(false);
  });

  it("reaches the edge of the pool, so no lit crescent survives behind it", () => {
    // A shadow that stops short of the pool's edge leaves a lit rim behind the
    // wall, which reads as the wall glowing at its back. Just inside the pool,
    // straight through the wall, must still be dark.
    const edge = { x: AT.x + light.reach * 0.98, y: AT.y };
    expect(inside(quad, edge), "the shadow ends before the light does").toBe(true);
  });

  it("still reaches it for a wall the ball is right up against", () => {
    // THE case the far-corner maths exists for. The quad's far side is a
    // straight chord, and a chord cuts inside the rays it joins; the closer the
    // wall, the wider it looms in the ball's view and the deeper that chord
    // cuts. Thrown a fixed distance it falls short exactly here - against the
    // wall the ball is touching, which is the one whose shadow matters most.
    const near = ballLight(ball(), AT, R, WHITE)!;
    const nx = AT.x + 6;
    const wide = shadowQuad(near, nx, AT.y - 120, nx, AT.y + 120)!;
    expect(wide).toBeTruthy();
    for (const dy of [-30, 0, 30]) {
      const edge = { x: AT.x + near.reach * 0.95, y: AT.y + dy };
      expect(inside(wide, edge), `lit crescent survives at dy=${dy}`).toBe(true);
    }
  });

  it("is a quad that fills, not a bow-tie", () => {
    // Taking the corners in endpoint order (a, b, aFar, bFar) rather than walk
    // order gives a self-crossing shape that fills as two triangles with a gap
    // between them - a wall with a lit bow-tie behind it.
    expect(selfIntersects(quad), "the shadow quad crosses itself").toBe(false);
  });

  it("casts nothing from a wall the light cannot reach", () => {
    const outOfReach = AT.x + light.reach + 10;
    expect(shadowQuad(light, outOfReach, AT.y - 40, outOfReach, AT.y + 40)).toBeNull();
  });

  it("casts nothing from a wall the ball is sitting ON", () => {
    // There is no coherent "away" from a light on the line: the two rays are
    // exactly opposite and the quad collapses. The ball is in the MIDDLE of
    // this wall, so both endpoints are far away - an endpoint-distance guard
    // alone sails straight past this, which is what the first version did.
    expect(shadowQuad(light, AT.x, AT.y - 40, AT.x, AT.y + 40)).toBeNull();
  });

  it("casts again the moment the ball is clear of the line", () => {
    // The guard is a hair, not a moat. A ball a couple of pixels off a wall is
    // legitimately casting, and swallowing that would make fences flicker.
    expect(shadowQuad(light, AT.x + 3, AT.y - 40, AT.x + 3, AT.y + 40)).toBeTruthy();
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function fillCount(g: Graphics): number {
  let n = 0;
  for (const ins of (g as any).context?.instructions ?? []) {
    for (const prim of ins.data?.path?.shapePath?.shapePrimitives ?? []) {
      if (prim) n++;
    }
  }
  return n;
}
function shadeGraphics(pass: BallLightPass): Graphics[] {
  const stage = (pass as any).stage as Container;
  return stage.children.filter((c): c is Graphics => c instanceof Graphics);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function state(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    balls: [],
    walls: [],
    ...over,
  } as unknown as CanvasGameState;
}
const w2s = (x: number, y: number) => ({ x, y });

describe("the light pass", () => {
  it("shadows the walls inside a pool and ignores the ones outside it", () => {
    const reach = R * REACH_RADII;
    const pass = new BallLightPass();
    pass.build(state({
      balls: [ball({ position: { x: 400, y: 300 } })],
      walls: [
        // Two inside the pool...
        { id: "a", start: { x: 430, y: 260 }, end: { x: 430, y: 340 }, thickness: 6 },
        { id: "b", start: { x: 360, y: 260 }, end: { x: 360, y: 340 }, thickness: 6 },
        // ...and one well beyond it.
        {
          id: "c",
          start: { x: 400 + reach + 50, y: 260 },
          end: { x: 400 + reach + 50, y: 340 },
          thickness: 6,
        },
      ],
    } as unknown as Partial<CanvasGameState>), w2s, 1);

    const shades = shadeGraphics(pass);
    expect(shades.length).toBeGreaterThan(0);
    expect(fillCount(shades[0]), "the pass shadowed the wrong number of walls").toBe(2);
    pass.destroy();
  });

  it("emits nothing at all for a board of sleepers", () => {
    // Not "emits a dark pool" - the composite is skipped entirely, so a level
    // that opens with every ball dormant costs no render pass.
    const pass = new BallLightPass();
    pass.build(state({ balls: [ball({ state: "dormant" }), ball({ state: "dormant" })] }), w2s, 1);
    expect(pass.sprite.visible).toBe(false);
    pass.destroy();
  });

  it("interleaves each ball's shadows with its own pool, not after everyone's", () => {
    // Additive light cannot be taken back off, so the pass composes on its own
    // surface where a shadow is just black paint. That makes DRAW ORDER the
    // whole correctness story: a ball's shadows must sit directly after its own
    // pool, so the next ball's light paints back over them. Batched at the end
    // instead, every ball's shadow would eat every other ball's light.
    const pass = new BallLightPass();
    pass.build(state({ balls: [ball({ id: "a" }), ball({ id: "b", position: { x: 200, y: 300 } })] }),
      w2s, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kinds = ((pass as any).stage as Container).children
      .map(c => (c instanceof Graphics ? "shade" : "glow"));
    expect(kinds.slice(0, 4)).toEqual(["glow", "shade", "glow", "shade"]);
    pass.destroy();
  });
});

describe("the pool does not undo the board's readability", () => {
  it("leaves cut space distinguishable from live space underneath it", () => {
    // The pool is ADDITIVE, so it adds the same amount to both surfaces and
    // therefore COMPRESSES the ratio between them. That ratio is the read the
    // whole game runs on (boardBrightness.test.ts pins it at > 1.4 unlit), so
    // the brightest the pool is ever allowed to be is bounded by how much
    // compression is survivable - not by taste.
    const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
    const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const over = (fg: number, bg: number, a: number) => {
      const f = rgb(fg), b = rgb(bg);
      return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a));
    };

    // Peak of the baked falloff (0.60 at 18% out) times the emitter intensity,
    // on a fully whitened pool: the brightest light any pixel of board can get.
    const add = 255 * 0.60 * BASE_INTENSITY;
    const live = over(PALETTE.active, PALETTE.boardVoid, 0.9);
    const cut = over(PALETTE.captured, PALETTE.boardVoid, 0.9);
    const lit = (c: number[]) => c.map(v => Math.min(255, v + add));

    expect(luma(lit(cut)) / luma(lit(live)), "the pool washes out the cut/live read")
      .toBeGreaterThan(1.15);
    // And it has to be actually visible, or none of this was worth a pass.
    expect(add, "the pool is too faint to see").toBeGreaterThan(30);
  });
});
