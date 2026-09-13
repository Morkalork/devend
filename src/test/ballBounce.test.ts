/**
 * Bounce light (ballBounce.ts, bounceLayer.ts): the surface answers the ball.
 *
 * The board has two lights that never acknowledged each other - the monitor
 * lights the furniture, the balls light the floor - so a fence's rim pointed at
 * the monitor with a blue ball a radius away from it. This is the first thing
 * that closes that loop.
 *
 * The geometry block is the model. The LAYER block is there because of how this
 * failed the first time: the band was 3.4 radii long, which put all of it
 * inside the ball's own corona, and it was invisible on screen while every
 * headless assertion passed. So the sizes are pinned against the corona, not
 * just against themselves.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Sprite } from "pixi.js";
import {
  collectBounces, closestOnSegment, BOUNCE_REACH_RADII, BOUNCE_LENGTH_RADII,
  BOUNCE_WHITEN, type Bounce,
} from "@/lib/rendering/sleek/ballBounce";
import { BounceLayer } from "@/lib/rendering/sleek/bounceLayer";
import { CORONA_RADII } from "@/lib/rendering/sleek/bulb";
import { WHITEN } from "@/lib/rendering/sleek/ballLight";
import { setLightLook, resetLightLookCache, DEFAULT_LIGHT_LOOK } from "@/lib/lightLook";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { Pt } from "@/lib/rendering/sleek/pixelGrid";

const R = 18;
const w2s = (x: number, y: number): Pt => ({ x, y });

function ball(over: Partial<Ball> = {}): Ball {
  return {
    id: "b1", position: { x: 400, y: 300 }, radius: R,
    color: "#ff4d5a", state: "active", assimScale: 1,
    ...over,
  } as unknown as Ball;
}

/** A horizontal wall at y = 500, thickness 6, so its top face is y = 497. */
const floor = (over = {}) =>
  ({ id: "fence", start: { x: 100, y: 500 }, end: { x: 700, y: 500 }, thickness: 6, ...over });

function state(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return { balls: [ball()], walls: [floor()], ...over } as unknown as CanvasGameState;
}

/** A ball whose SURFACE is `gap` above the wall's face. */
function atGap(gap: number, over: Partial<Ball> = {}): Ball {
  return ball({ position: { x: 400, y: 500 - 3 - R - gap }, ...over });
}

beforeEach(() => {
  resetLightLookCache();
  localStorage.clear();
});

describe("closestOnSegment", () => {
  it("clamps to the ends rather than running off the line", () => {
    expect(closestOnSegment(0, 0, 10, 0, 20, 0)).toMatchObject({ x: 10, y: 0 });
    expect(closestOnSegment(99, 0, 10, 0, 20, 0)).toMatchObject({ x: 20, y: 0 });
    const mid = closestOnSegment(15, 5, 10, 0, 20, 0);
    expect(mid.x).toBeCloseTo(15, 6);
    expect(mid.dist).toBeCloseTo(5, 6);
  });

  it("survives a degenerate segment", () => {
    expect(closestOnSegment(3, 4, 0, 0, 0, 0).dist).toBeCloseTo(5, 6);
  });
});

describe("which walls catch a ball's light", () => {
  it("measures the gap from the ball's SURFACE and the wall's FACE", () => {
    // Touching: the strongest it gets.
    expect(collectBounces(state({ balls: [atGap(0)] }))[0].strength).toBeCloseTo(1, 3);
    // Just inside the reach: present, but nearly nothing.
    const far = collectBounces(state({ balls: [atGap(R * BOUNCE_REACH_RADII - 0.5)] }));
    expect(far).toHaveLength(1);
    expect(far[0].strength).toBeLessThan(0.01);
    // Past it: gone.
    expect(collectBounces(state({ balls: [atGap(R * BOUNCE_REACH_RADII + 1)] }))).toHaveLength(0);
  });

  it("grows a boss's reach with the boss, and still measures from its surface", () => {
    // A grown ball is a bigger emitter, so it answers a wall from further out
    // in absolute terms - but the gap is still measured from its SURFACE, so
    // being large is not on its own enough to light a fence it is nowhere near.
    const boss = (y: number) => ball({ radius: R, assimScale: 2, position: { x: 400, y } });
    // A CENTRE position that is out of reach for a small ball...
    const out = 500 - 3 - R - R * BOUNCE_REACH_RADII - 5;
    expect(collectBounces(state({ balls: [ball({ position: { x: 400, y: out } })] })))
      .toHaveLength(0);
    // ... is inside a boss's, because the boss's SURFACE is that much closer.
    expect(collectBounces(state({ balls: [boss(out)] }))).toHaveLength(1);
    // And past the boss's own reach, measured from its own surface, it stops.
    expect(collectBounces(state({
      balls: [boss(500 - 3 - R * 2 - R * 2 * BOUNCE_REACH_RADII - 5)],
    }))).toHaveLength(0);
  });

  it("points the normal from the wall toward the ball", () => {
    const b = collectBounces(state({ balls: [atGap(2)] }))[0];
    expect(b.nx).toBeCloseTo(0, 6);
    expect(b.ny).toBeCloseTo(-1, 6);   // the ball is above the floor
    expect(Math.abs(b.ax)).toBeCloseTo(1, 6); // and the wall runs along x
    expect(b.x).toBeCloseTo(400, 6);
    expect(b.y).toBeCloseTo(500, 6);   // on the CENTRELINE; the layer offsets to the face
  });

  it("skips a portal, because the ball is going through it", () => {
    expect(collectBounces(state({
      balls: [atGap(1)], walls: [floor({ portal: {} })],
    }))).toHaveLength(0);
  });

  it("gives a sleeper nothing and a draining lock nothing at the end", () => {
    expect(collectBounces(state({ balls: [atGap(1, { state: "dormant" })] }))).toHaveLength(0);
    expect(collectBounces(state({
      balls: [atGap(1, { state: "won", assimColorFade: 0.2 })],
    })).length).toBe(1);
    expect(collectBounces(state({
      balls: [atGap(1, { state: "won", assimColorFade: 0.95 })],
    }))).toHaveLength(0);
  });

  it("keeps more of the ball's hue than its pool does", () => {
    // Additive over a fence that already carries a bright accent, a whitened
    // bounce reads as "the fence got brighter" instead of "the red ball is
    // against it", which is the one thing it is there to say.
    expect(BOUNCE_WHITEN).toBeLessThan(WHITEN);
    const b = collectBounces(state({ balls: [atGap(1)] }))[0];
    expect((b.color >> 16) & 255).toBeGreaterThan(b.color & 255); // still red
  });

  it("gives a ball wedged in a corner one bounce per wall", () => {
    const bounces = collectBounces(state({
      balls: [ball({ position: { x: 121, y: 479 } })],
      walls: [floor(), { id: "w", start: { x: 100, y: 100 }, end: { x: 100, y: 500 }, thickness: 6 }],
    }));
    expect(bounces).toHaveLength(2);
    for (const b of bounces) expect(b.strength).toBeCloseTo(1, 3);
  });

  it("reuses the array it is handed, so a frame allocates nothing", () => {
    const out: Bounce[] = [];
    expect(collectBounces(state({ balls: [atGap(1)] }), out)).toBe(out);
    collectBounces(state({ balls: [atGap(999)] }), out);
    expect(out).toHaveLength(0);
  });
});

describe("the band is a shape the corona cannot make", () => {
  it("runs further along the wall than the ball's own corona reaches", () => {
    // THE bug from the first version. The corona is a disc of CORONA_RADII; a
    // band shorter than that is drawn entirely inside it, and two soft glows in
    // the same place are one soft glow. Only the part that runs PAST the corona
    // is visible as a new thing, so the band has to be substantially longer.
    // 0.35 of the width is roughly where the along-Gaussian dies.
    const halfExtent = BOUNCE_LENGTH_RADII * 0.35;
    expect(halfExtent).toBeGreaterThan(CORONA_RADII * 1.5);
  });

  it("is shorter-ranged than the pool, so it means contact and not proximity", () => {
    expect(BOUNCE_REACH_RADII).toBeLessThan(3);
  });
});

describe("the layer", () => {
  function layerFor(over: Partial<CanvasGameState> = {}) {
    const layer = new BounceLayer();
    layer.sync(state(over), w2s, 1);
    return layer;
  }
  const shown = (c: { children: unknown[] }) =>
    (c.children as Sprite[]).filter(s => s instanceof Sprite && s.visible);

  it("puts the band on the lit FACE and turns its inward axis into the wall", () => {
    const layer = layerFor({ balls: [atGap(1)] });
    const [band] = shown(layer.onFrame).length ? shown(layer.onFrame) : shown(layer.onWalls);
    expect(band.position.y).toBeCloseTo(497, 6); // the face, not the 500 centreline
    expect(band.position.x).toBeCloseTo(400, 6);
    // Local +y is (-sin, cos); into this wall is world +y (downward).
    expect(-Math.sin(band.rotation)).toBeCloseTo(0, 6);
    expect(Math.cos(band.rotation)).toBeCloseTo(1, 6);
    layer.destroy();
  });

  it("sends a board edge to the frame, which is not clipped by the board mask", () => {
    // The most common contact in the game is a ball off the wall, and the
    // frame is drawn OUTSIDE the board mask - so a band composed inside it
    // would be cut off at exactly the edge it is lighting.
    const layer = layerFor({
      balls: [atGap(1)], walls: [floor({ id: "board-edge-2", isBoardEdge: true })],
    });
    expect(shown(layer.onFrame)).toHaveLength(1);
    expect(shown(layer.onWalls)).toHaveLength(0);
    layer.destroy();
  });

  it("puts the return light on the ball's own rim, facing the wall", () => {
    const layer = layerFor({ balls: [atGap(4)] });
    const [kiss] = shown(layer.onBalls);
    const centre = 500 - 3 - R - 4;
    expect(kiss.position.x).toBeCloseTo(400, 6);
    expect(kiss.position.y).toBeGreaterThan(centre);        // toward the wall
    expect(kiss.position.y).toBeLessThan(centre + R);       // still on the ball
    layer.destroy();
  });

  it("draws nothing at all when the dial is off", () => {
    setLightLook({ bounce: 0 });
    const layer = layerFor({ balls: [atGap(0)] });
    expect(shown(layer.onWalls)).toHaveLength(0);
    expect(shown(layer.onFrame)).toHaveLength(0);
    expect(shown(layer.onBalls)).toHaveLength(0);
    layer.destroy();
  });

  it("hides the sprites of a bounce that has ended", () => {
    const layer = new BounceLayer();
    layer.sync(state({ balls: [atGap(1)] }), w2s, 1);
    expect(shown(layer.onWalls)).toHaveLength(1);
    layer.sync(state({ balls: [atGap(999)] }), w2s, 1);
    expect(shown(layer.onWalls)).toHaveLength(0);
    expect(shown(layer.onBalls)).toHaveLength(0);
    layer.destroy();
  });

  it("does not leave a stale band behind when a bounce changes surface", () => {
    // The two pools share an index, so slot 0 can be a fence one frame and the
    // frame the next; the one it left has to go dark.
    const layer = new BounceLayer();
    layer.sync(state({ balls: [atGap(1)] }), w2s, 1);
    expect(shown(layer.onWalls)).toHaveLength(1);
    layer.sync(state({
      balls: [atGap(1)], walls: [floor({ id: "board-edge-2", isBoardEdge: true })],
    }), w2s, 1);
    expect(shown(layer.onWalls)).toHaveLength(0);
    expect(shown(layer.onFrame)).toHaveLength(1);
    layer.destroy();
  });

  it("survives a hole in a band pool, which is a crash and not a glitch", () => {
    // The two pools share an index and only one of them gets a sprite per
    // bounce, so they are SPARSE. A frame of [board edge, fence] leaves slot 0
    // of `bands` empty while pushing its length to 2; the next frame with
    // fewer bounces then swept over the hole. Found by a bench run on a mixed
    // board, because every test before this one used bounces of one kind.
    const layer = new BounceLayer();
    const both = {
      balls: [atGap(1), atGap(1, { id: "b2" })],
      walls: [floor({ id: "board-edge-2", isBoardEdge: true }), floor({ id: "fence" })],
    };
    layer.sync(state(both), w2s, 1);
    expect(shown(layer.onFrame).length + shown(layer.onWalls).length).toBeGreaterThan(1);
    expect(() => layer.sync(state({ balls: [atGap(999)] }), w2s, 1)).not.toThrow();
    expect(shown(layer.onWalls)).toHaveLength(0);
    expect(shown(layer.onFrame)).toHaveLength(0);
    layer.destroy();
  });

  it("scales the band's brightness by the dial", () => {
    const full = layerFor({ balls: [atGap(0)] });
    const a = shown(full.onWalls)[0].alpha;
    full.destroy();
    setLightLook({ bounce: 0.25 });
    const dim = layerFor({ balls: [atGap(0)] });
    expect(shown(dim.onWalls)[0].alpha).toBeCloseTo(a * 0.25 / DEFAULT_LIGHT_LOOK.bounce, 5);
    dim.destroy();
  });
});
