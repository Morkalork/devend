/**
 * A squashed ball is drawn squashed by EVERYTHING, not just by its body.
 *
 * The Bug Squash splat was reported as having no animation while the envelope
 * was running correctly, and the biggest single reason was here rather than in
 * the maths. The ball is drawn as four things - a shadow, a body, an additive
 * corona and its mark - and only the body took the deformation. So a splatted
 * ball was a flattened sprite underneath a perfectly round bloom, blended with
 * "add", seated on a perfectly round shadow. At ball size the round glow simply
 * won, and the squash was invisible on screen while being correct in memory.
 *
 * Driven through the real layer, because that is the whole lesson of
 * ballLayerNoBeams next door: reasoning about the source said the squash was
 * applied, and it was - to one of the four things that needed it.
 */
import { describe, it, expect } from "vitest";
import { Graphics } from "pixi.js";
import { SleekBallLayer } from "@/lib/rendering/sleek/ballLayer";
import { lightScope } from "@/lib/rendering/sleek/light";
import { createBallEffectState, triggerWallHit, pinSquish, updateBallEffects } from "@/lib/ballEffects";
import type { Ball } from "@/types/game";

const RADIUS = 9;
const AT = { x: 400, y: 300 };

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

/** Render one frame and hand back the layer's private view for ball 0. */
function render(b: Ball, now: number) {
  const layer = new SleekBallLayer();
  const shadows = new Graphics();
  const w2s = (x: number, y: number) => ({ x, y });
  const light = lightScope({ x: 0, y: 0, width: 800, height: 600 } as never, 0);
  const game = {
    balls: [b],
    activePlaySeconds: 1,
    walls: [], obstaclePolygons: [], movers: [], chains: [],
  } as never;
  layer.sync(game, light, shadows, w2s, 1, now);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (layer as unknown as any).views[0] as {
    holder: { rotation: number; scale: { x: number; y: number }; position: { x: number; y: number } };
    corona: { visible: boolean; rotation: number; scale: { x: number; y: number }; position: { x: number; y: number } };
  };
}

/**
 * A ball splatted against a wall on its RIGHT, held, at `ms` after impact.
 *
 * The impact normal is the bounce impulse, so it points AWAY from the surface:
 * a ball that hit a wall on its right has its velocity flipped to -x and a
 * normal of -x. The wall is therefore on the +x side and the body sinks +x into
 * it. Easy to get backwards, and this comment is here because the first draft
 * of this file did.
 */
function splatted(ms: number) {
  const t0 = 10_000;
  const fx = createBallEffectState();
  triggerWallHit(fx, t0, -300, 0, 300);   // normal -x: the wall is to the +x side
  pinSquish(fx, t0, 2000);
  for (let t = 0; t <= ms; t += 1000 / 60) updateBallEffects(fx, 1 / 60, t0 + t);
  return { fx, now: t0 + ms };
}

describe("the corona takes the ball's shape", () => {
  it("is round on a round ball", () => {
    const view = render(ball(createBallEffectState()), 10_000);
    expect(view.corona.visible).toBe(true);
    expect(view.corona.rotation).toBe(0);
    expect(view.corona.scale.x).toBeCloseTo(view.corona.scale.y, 6);
  });

  it("flattens with the body on a splat, on the same axis", () => {
    const { fx, now } = splatted(300);
    const view = render(ball(fx), now);
    // Squashed the same way round as the body...
    expect(view.corona.scale.x).toBeLessThan(view.corona.scale.y);
    expect(view.corona.rotation).toBeCloseTo(view.holder.rotation, 6);
    // ...and by the same proportions. This is the assertion that would have
    // failed before: the corona was scaled uniformly.
    const bodyRatio = view.holder.scale.x / view.holder.scale.y;
    const coronaRatio = view.corona.scale.x / view.corona.scale.y;
    expect(coronaRatio).toBeCloseTo(bodyRatio, 6);
  });

  it("sits where the body sits, sunk into the wall", () => {
    const { fx, now } = splatted(300);
    const view = render(ball(fx), now);
    // Normal -x means the wall is on the +x side, so the body slides +x into it.
    expect(view.holder.position.x).toBeGreaterThan(AT.x);
    expect(view.holder.position.y).toBeCloseTo(AT.y, 6);
    expect(view.corona.position.x).toBeCloseTo(view.holder.position.x, 6);
    expect(view.corona.position.y).toBeCloseTo(view.holder.position.y, 6);
  });

  it("is back to round and back on centre once the splat is over", () => {
    const { fx, now } = splatted(2000 + 900);
    const view = render(ball(fx), now);
    expect(view.corona.scale.x).toBeCloseTo(view.corona.scale.y, 6);
    expect(view.holder.position.x).toBeCloseTo(AT.x, 6);
    expect(view.corona.rotation).toBe(0);
  });
});

describe("the body is drawn against the wall", () => {
  it("sinks by exactly the compression, so the flat face meets the surface", () => {
    const { fx, now } = splatted(300);
    const view = render(ball(fx), now);
    // Sink is r * (1 - scaleAlong): the amount the near face would otherwise
    // have floated clear of the wall.
    const expected = RADIUS * (1 - view.holder.scale.x);
    expect(view.holder.position.x - AT.x).toBeCloseTo(expected, 4);
  });

  it("does not sink on an ordinary bounce, which is gone too fast to notice", () => {
    const fx = createBallEffectState();
    triggerWallHit(fx, 10_000, -300, 0, 300);
    updateBallEffects(fx, 1 / 60, 10_000);
    const view = render(ball(fx), 10_000);
    expect(view.holder.scale.x).toBeLessThan(1);      // it IS squashed
    expect(view.holder.position.x).toBeCloseTo(AT.x, 6); // and not displaced
  });
});
