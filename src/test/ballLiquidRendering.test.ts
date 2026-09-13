/**
 * A Bug Squash hold is drawn as the LIQUID, not the fan (ballLayer.ts).
 *
 * Three paths draw a ball now: the fan (round balls and ordinary bounces), the
 * fan warped to the droplet (a held squash before its scene is known), and the
 * liquid sprites (a held squash with its scene). This pins which one is used
 * when, that the liquid is placed where the fan would have been, and that a
 * held-still splat does not repaint every frame.
 *
 * Driven through the real layer, as ballSplatRendering is, and for the same
 * reason: the squash has twice been correct in memory and invisible on screen.
 */
import { describe, it, expect, vi } from "vitest";
import { Graphics } from "pixi.js";
import { SleekBallLayer } from "@/lib/rendering/sleek/ballLayer";
import { lightScope } from "@/lib/rendering/sleek/light";
import {
  createBallEffectState, triggerWallHit, pinSquish, updateBallEffects, getSquishEffect,
} from "@/lib/ballEffects";
import { captureSplatScene, type SplatScene } from "@/lib/splatScene";
import type { Ball } from "@/types/game";

const RADIUS = 18;
const AT = { x: 400, y: 300 };
const T0 = 1000;

function ball(effects: ReturnType<typeof createBallEffectState>, over: Partial<Ball> = {}): Ball {
  return {
    id: "b1",
    position: { ...AT },
    renderPosition: { ...AT },
    velocity: { x: 0, y: 0 },
    speed: 0, baseSpeed: 235, topSpeed: 300, minimumSpeed: 150,
    radius: RADIUS, color: "#c08cff", state: "active",
    effects,
    ...over,
  } as unknown as Ball;
}

/** A wall on the ball's RIGHT: the ball hit it moving +x, so the normal is -x. */
function sceneRight(): SplatScene {
  return captureSplatScene(
    { walls: [{ id: "fence", start: { x: AT.x + RADIUS + 5, y: 100 }, end: { x: AT.x + RADIUS + 5, y: 500 }, thickness: 6 }],
      obstaclePolygons: [], boardPolygon: null },
    { x: AT.x + RADIUS, y: AT.y }, { x: -1, y: 0 }, RADIUS,
  );
}

/** Splatted against a wall on its right, held, at `ms` after impact. */
function heldAt(ms: number) {
  const st = createBallEffectState();
  triggerWallHit(st, T0, -1, 0, 300);
  pinSquish(st, T0, 3000);
  for (let t = 0; t <= ms; t += 1000 / 60) updateBallEffects(st, 1 / 60, T0 + t);
  return st;
}

function layerFor(b: Ball, now: number, scale = 1) {
  const layer = new SleekBallLayer();
  const shadows = new Graphics();
  const w2s = (x: number, y: number) => ({ x: x * scale, y: y * scale });
  const light = lightScope({ x: 0, y: 0, width: 800, height: 600 } as never, 0);
  const game = {
    balls: [b], activePlaySeconds: 1,
    walls: [], obstaclePolygons: [], movers: [], chains: [],
  } as never;
  layer.sync(game, light, shadows, w2s, scale, now);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = (layer as unknown as any).views[0];
  return { layer, view, game, light, shadows, w2s, scale };
}

describe("a held squash with its scene draws as the liquid", () => {
  it("shows the liquid sprites and hides both meshes", () => {
    const st = heldAt(600);
    expect(getSquishEffect(st).active).toBe(true);
    const { view } = layerFor(ball(st, { splatScene: sceneRight(), bugSquashUntil: T0 + 3000, frozenUntil: T0 + 3000 }), T0 + 600);
    expect(view.liquid).not.toBeNull();
    expect(view.liquid.body.visible).toBe(true);
    expect(view.liquid.glow.visible).toBe(true);
    expect(view.body.visible).toBe(false);
    expect(view.corona.visible).toBe(false);
    // Something was actually painted.
    let lit = 0;
    for (let k = 3; k < view.liquid.image.body.length; k += 4) if (view.liquid.image.body[k] > 0) lit++;
    expect(lit).toBeGreaterThan(100);
  });

  it("puts the sprite's origin on the contact point and turns it to the wall", () => {
    const st = heldAt(600);
    const { view } = layerFor(ball(st, { splatScene: sceneRight(), bugSquashUntil: T0 + 3000, frozenUntil: T0 + 3000 }), T0 + 600, 2);
    const sprite = view.liquid.body;
    // The contact is one radius to the right of the centre, in screen pixels.
    expect(sprite.position.x).toBeCloseTo((AT.x + RADIUS) * 2, 6);
    expect(sprite.position.y).toBeCloseTo(AT.y * 2, 6);
    // Local +y (into the wall) must map to screen +x. Pixi's local y axis is
    // (-sin, cos), so that is a rotation of -90 degrees.
    expect(Math.sin(sprite.rotation)).toBeCloseTo(-1, 6);
    expect(Math.cos(sprite.rotation)).toBeCloseTo(0, 6);
    // Scaled so one texel is (scale * world units per texel) pixels.
    expect(sprite.scale.x).toBeCloseTo(2 * view.liquid.image.texel, 6);
    // And the anchor sits where the grid's origin is.
    const img = view.liquid.image;
    expect(sprite.anchor.x * img.width * img.texel + img.x0).toBeCloseTo(0, 6);
    expect(sprite.anchor.y * img.height * img.texel + img.y0).toBeCloseTo(0, 6);
  });

  it("does not repaint a splat that has not changed", () => {
    const st = heldAt(1200); // deep in the hold: all dials flat and still
    const b = ball(st, { splatScene: sceneRight(), bugSquashUntil: T0 + 3000, frozenUntil: T0 + 3000 });
    const { layer, view, game, light, shadows, w2s, scale } = layerFor(b, T0 + 1200);
    const spy = vi.spyOn(view.liquid.bodySrc, "update");
    updateBallEffects(st, 1 / 60, T0 + 1216);
    layer.sync(game, light, shadows, w2s, scale, T0 + 1216);
    updateBallEffects(st, 1 / 60, T0 + 1232);
    layer.sync(game, light, shadows, w2s, scale, T0 + 1232);
    expect(spy).not.toHaveBeenCalled();
    // But a moving one does repaint.
    for (let t = 1232; t <= 2700; t += 16) updateBallEffects(st, 1 / 60, T0 + t);
    layer.sync(game, light, shadows, w2s, scale, T0 + 2700);
    expect(spy).toHaveBeenCalled();
  });

  it("hands back to the mesh once the ball is round again", () => {
    const st = heldAt(3100); // past the hold and the reinflate
    expect(getSquishEffect(st).active).toBe(false);
    const { view } = layerFor(ball(st, { splatScene: sceneRight() }), T0 + 3100);
    expect(view.body.visible).toBe(true);
    expect(view.liquid === null || view.liquid.body.visible === false).toBe(true);
  });
});

describe("everything else keeps the fan", () => {
  it("a held squash whose scene is not yet captured draws the droplet mesh", () => {
    const st = heldAt(600);
    const { view } = layerFor(ball(st, { splatScene: null, bugSquashUntil: T0 + 3000, frozenUntil: T0 + 3000 }), T0 + 600);
    expect(view.liquid).toBeNull();
    expect(view.body.visible).toBe(true);
    expect(view.corona.visible).toBe(true);
  });

  it("an ordinary bounce ignores a stale scene from an earlier stick", () => {
    const st = createBallEffectState();
    triggerWallHit(st, T0, -1, 0, 300);
    for (let t = 0; t <= 60; t += 1000 / 60) updateBallEffects(st, 1 / 60, T0 + t);
    expect(getSquishEffect(st).active).toBe(true);
    const { view } = layerFor(ball(st, { splatScene: sceneRight() }), T0 + 60);
    expect(view.liquid).toBeNull();
    expect(view.body.visible).toBe(true);
  });

  it("a round ball is the fan", () => {
    const { view } = layerFor(ball(createBallEffectState()), T0);
    expect(view.liquid).toBeNull();
    expect(view.body.visible).toBe(true);
  });
});
