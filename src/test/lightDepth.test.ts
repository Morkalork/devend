/**
 * Four things that were unlit, and one that never blocked light.
 *
 * FENCES WERE NEVER SEATED. Balls, obstacles, props and stack objects have all
 * called contactFor since the light model was built; the wall layer only ever
 * called shadowFor. A cast shadow is DISPLACED from its caster, so a fence had
 * a shadow beside it and nothing at its base, which is what makes an object
 * read as painted on rather than standing up.
 *
 * BALLS NEVER BLOCKED EACH OTHER. ballLight.ts says plainly that a glowing
 * ball is still opaque - that is why its own shadow survives at all - but only
 * walls were in the occluder loop, so one ball's pool shone straight through
 * another.
 *
 * A BOUNCE MADE NO LIGHT. The most frequent event in the game: the fence
 * bulged, the ball squished, a sound played, and the room did not notice.
 *
 * THE PLAYER'S OWN CUT MADE NO LIGHT either, which left the one thing they are
 * actually doing as the darkest thing on the board.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Graphics, Container } from "pixi.js";
import { BallLightPass, BALL_SHADOW_ALPHA, TIP_REACH } from "@/lib/rendering/sleek/ballLightPass";
import { WallLayer } from "@/lib/rendering/sleek/wallLayer";
import { lightScope, contactFor, shadowFor } from "@/lib/rendering/sleek/light";
import { impactEnvelope, IMPACT_FLASH_MS } from "@/lib/rendering/sleek/flashLight";
import { speedStretch, SPEED_STRETCH, SPEED_STRETCH_REF } from "@/lib/rendering/ballTell";
import { registerWallImpact, updateWallImpacts, clearWallImpacts, activeWallImpacts } from "@/lib/wallImpactEffects";
import { setLightLook, resetLightLookCache } from "@/lib/lightLook";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";

const RECT = { left: 0, top: 0, width: 900, height: 900, scale: 1 } as never;
const R = 18;
const w2s = (x: number, y: number) => ({ x, y });

function ball(over: Partial<Ball> = {}): Ball {
  return {
    id: "b1", position: { x: 300, y: 300 }, radius: R, color: "#ff4d5a",
    state: "active", assimScale: 1, rotation: 0, velocity: { x: 0, y: 0 },
    spawnTime: -99999, ...over,
  } as unknown as Ball;
}

function state(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    balls: [ball()], walls: [], activeWalls: [], activePlaySeconds: 8,
    obstaclePolygons: [], phasingObjects: [], movers: [], chains: [],
    assimilations: new Map(), ...over,
  } as unknown as CanvasGameState;
}

/** How many fills a given emitter's shade Graphics laid down. */
function shadeFills(pass: BallLightPass, i: number): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = (pass as unknown as any).emitters[i];
  return (e.shade.context.instructions as { action: string }[])
    .filter(x => x.action === "fill").length;
}

beforeEach(() => {
  resetLightLookCache();
  localStorage.clear();
  clearWallImpacts();
});

describe("a fence is seated on the floor", () => {
  it("darkens both sides of the fence, not just the side away from the monitor", () => {
    // The crease where a wall meets a floor occludes the sky from BOTH sides
    // equally. Offsetting it away from the light, the way a cast shadow is
    // offset, was the first version - and it hid inside the cast shadow it was
    // drawn next to, 1.5 world units wide, which is to say invisible.
    const layer = new WallLayer();
    const shadows = new Graphics();
    const game = state({
      walls: [{ id: "f1", start: { x: 200, y: 400 }, end: { x: 700, y: 400 }, thickness: 6 }],
      boardPolygon: { vertices: [{ x: 45, y: 45 }, { x: 855, y: 45 }, { x: 855, y: 855 }, { x: 45, y: 855 }] },
      boardRect: RECT,
    });
    layer.sync(game, lightScope(RECT, 0), shadows, w2s, 1);

    // The monitor sits past the bottom-right, so a cast shadow is thrown up
    // and LEFT: on its own it would put no geometry below the fence at all.
    // Anything down there is the crease band, which is the whole point.
    const bounds = shadows.getLocalBounds();
    expect(bounds.maxY, "nothing is drawn below the fence").toBeGreaterThan(400 + 4);
    expect(bounds.minY, "nothing is drawn above it either").toBeLessThan(400 - 4);
    layer.destroy();
  });

  it("uses the contact throw, which is shorter than the cast throw", () => {
    // Pinning the distinction the first version collapsed: a cast shadow is
    // thrown, a crease is not.
    const light = lightScope(RECT, 0);
    expect(contactFor(light, 400, 400, 6).length)
      .toBeLessThan(shadowFor(light, 400, 400, 6).length);
  });
});

describe("balls block each other's light", () => {
  const wallless = (balls: Ball[]) => state({ balls, walls: [] });

  it("adds a shadow for another ball inside the pool", () => {
    const pass = new BallLightPass();
    pass.build(wallless([ball({ id: "a" }), ball({ id: "b", position: { x: 350, y: 300 } })]),
      w2s, 1, 0, lightScope(RECT, 0));
    // With no walls at all, any fill on a shade can only be a ball.
    expect(shadeFills(pass, 0)).toBeGreaterThan(0);
    pass.destroy();
  });

  it("never lets a ball eclipse itself, or the caustic it focused", () => {
    // A caustic is BY DEFINITION the light that went through that ball, so the
    // ball blocking it would be the effect cancelling itself out.
    const pass = new BallLightPass();
    pass.build(wallless([ball({ id: "solo" })]), w2s, 1, 0, lightScope(RECT, 0));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (let i = 0; i < (pass as any).live; i++) expect(shadeFills(pass, i)).toBe(0);
    pass.destroy();
  });

  it("is softer than a wall's, because a ball is the translucent one", () => {
    expect(BALL_SHADOW_ALPHA).toBeLessThan(1);
    expect(BALL_SHADOW_ALPHA).toBeGreaterThan(0.3);
  });

  it("skips a locked ball, which is draining rather than standing in the way", () => {
    const pass = new BallLightPass();
    pass.build(wallless([ball({ id: "a" }), ball({ id: "b", position: { x: 350, y: 300 }, state: "won" })]),
      w2s, 1, 0, lightScope(RECT, 0));
    expect(shadeFills(pass, 0)).toBe(0);
    pass.destroy();
  });

  it("goes away entirely when the dial is off", () => {
    setLightLook({ ballShadows: 0 });
    const pass = new BallLightPass();
    pass.build(wallless([ball({ id: "a" }), ball({ id: "b", position: { x: 350, y: 300 } })]),
      w2s, 1, 0, lightScope(RECT, 0));
    expect(shadeFills(pass, 0)).toBe(0);
    pass.destroy();
  });
});

describe("a bounce makes light", () => {
  it("is all attack and no sustain, because that is what a hit is", () => {
    expect(impactEnvelope(0)).toBe(1);
    expect(impactEnvelope(0.5)).toBeLessThan(0.3);
    expect(impactEnvelope(1)).toBe(0);
    expect(impactEnvelope(-0.1)).toBe(0);
  });

  it("is far shorter than the fence's own wobble, which is the aftermath", () => {
    expect(IMPACT_FLASH_MS).toBeLessThan(300);
  });

  it("carries the colour of the ball that made it", () => {
    // Recorded at the hit rather than matched up by position at draw time,
    // because two balls striking one fence in a frame is exactly the case a
    // nearest-ball guess gets wrong and exactly the case worth looking at.
    registerWallImpact({ x: 45, y: 400 }, { x: 855, y: 400 }, { x: 300, y: 400 },
      1, { x: 300, y: 380 }, "#00ff88");
    updateWallImpacts();
    expect(activeWallImpacts()[0].color).toBe("#00ff88");
  });

  it("puts an emitter at the contact, and none when the dial is off", () => {
    registerWallImpact({ x: 45, y: 400 }, { x: 855, y: 400 }, { x: 300, y: 400 },
      1, { x: 300, y: 380 }, "#00ff88");
    updateWallImpacts();
    // The impact stamps itself with the real clock, so the frame time has to
    // come from it rather than from a moment captured before it existed.
    const now = activeWallImpacts()[0].startTime + 10;
    const count = (g: CanvasGameState) => {
      const pass = new BallLightPass();
      pass.build(g, w2s, 1, now, lightScope(RECT, 0));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = (pass as any).live;
      pass.destroy();
      return n;
    };
    const withFlash = count(state({ balls: [] }));
    setLightLook({ reaction: 0 });
    expect(withFlash).toBeGreaterThan(count(state({ balls: [] })));
  });
});

describe("the cut the player is drawing is hot", () => {
  const growing = (over = {}) => ({
    startPoint: { x: 400, y: 500 }, endPoint: { x: 400, y: 700 },
    isComplete: false, thickness: 6, ...over,
  });

  it("lights both travelling tips, which is where the work is", () => {
    const pass = new BallLightPass();
    pass.build(state({ balls: [], activeWalls: [growing()] }), w2s, 1, 0, lightScope(RECT, 0));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((pass as any).live).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kids = ((pass as any).stage as Container).children;
    const lit = kids.filter(k => k instanceof Container && !(k instanceof Graphics) && k.visible);
    expect(lit.length).toBeGreaterThanOrEqual(2);
    pass.destroy();
  });

  it("goes out the moment the cut lands", () => {
    const pass = new BallLightPass();
    pass.build(state({ balls: [], activeWalls: [growing({ isComplete: true })] }),
      w2s, 1, 0, lightScope(RECT, 0));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((pass as any).live).toBe(0);
    pass.destroy();
  });

  it("is a working point and not a lamp, so it stays under a ball's reach", () => {
    expect(TIP_REACH).toBeLessThan(R * 5.4);
  });
});

describe("a moving ball's pool is not a circle", () => {
  it("stretches along the heading and squeezes across it", () => {
    const fast = speedStretch(SPEED_STRETCH_REF, 1);
    expect(fast.along).toBeCloseTo(1 + SPEED_STRETCH, 6);
    expect(fast.across).toBeLessThan(1);
  });

  it("keeps roughly the same area, so speed reads as SHAPE and not brightness", () => {
    // Brightness would be the wrong channel: it already means how close a ball
    // is, and two meanings on one channel is no meaning.
    for (const sp of [0, 80, 200, SPEED_STRETCH_REF, 900]) {
      const s = speedStretch(sp, 1);
      expect(s.along * s.across).toBeCloseTo(1, 6);
    }
  });

  it("is round when the ball is still, or when the dial is off", () => {
    expect(speedStretch(0, 1)).toEqual({ along: 1, across: 1 });
    expect(speedStretch(500, 0)).toEqual({ along: 1, across: 1 });
  });

  it("caps, so a launched ball is not a comet", () => {
    expect(speedStretch(9999, 1).along).toBeCloseTo(1 + SPEED_STRETCH, 6);
  });
});
