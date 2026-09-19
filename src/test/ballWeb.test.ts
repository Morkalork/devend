/**
 * The web on the shell and the light that flickers inside (ballWeb.ts,
 * ballLife.ts flicker, ballLook.ts), through the real layers.
 *
 * The pattern is SHELL ONLY: multiplied over the body and turned by the ball's
 * rotation. It used to be drawn a second time into the ball's light pool as a
 * spinning gobo, and that read as a revolving texture rather than as light, so
 * the pool is a plain radial falloff again. The last describe below is what
 * keeps it that way: the web strength must not reach the light at all.
 * The strength is a Playground slider and zero is exactly the plain bulb.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Graphics } from "pixi.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flicker, heartPhase, FLICKER_FLOOR, FLICKER_EVERY_MS } from "@/lib/rendering/ballLife";
import { webStrands, WEB_SPIN } from "@/lib/rendering/sleek/ballWeb";
import { getBallLook, setBallLook, resetBallLookCache, DEFAULT_BALL_LOOK } from "@/lib/ballLook";
import { SleekBallLayer } from "@/lib/rendering/sleek/ballLayer";
import { BallLightPass } from "@/lib/rendering/sleek/ballLightPass";
import { lightScope } from "@/lib/rendering/sleek/light";
import { SPLAT_SEGMENTS } from "@/lib/rendering/splatShape";
import { createBallEffectState } from "@/lib/ballEffects";
import type { Ball } from "@/types/game";

beforeEach(() => { localStorage.clear(); resetBallLookCache(); });

describe("the look setting", () => {
  it("defaults to a visible web and a flickering light", () => {
    expect(getBallLook()).toEqual(DEFAULT_BALL_LOOK);
    expect(DEFAULT_BALL_LOOK.web).toBeGreaterThan(0);
  });
  it("persists across a reload and clamps the web to 0..1", () => {
    setBallLook({ web: 3, flicker: false });
    resetBallLookCache();
    expect(getBallLook()).toEqual({ web: 1, flicker: false });
    setBallLook({ web: -1 });
    expect(getBallLook().web).toBe(0);
  });
});

describe("the flicker", () => {
  it("is steady almost all of the time and never below the floor", () => {
    let dim = 0, n = 0;
    for (let t = 0; t < 60000; t += 10, n++) {
      const f = flicker(t);
      expect(f).toBeLessThanOrEqual(1);
      expect(f).toBeGreaterThanOrEqual(FLICKER_FLOOR - 1e-9);
      if (f < 0.999) dim++;
    }
    expect(dim / n).toBeLessThan(0.06);
    expect(dim).toBeGreaterThan(0);
  });
  it("happens a few times a minute, not once and not constantly", () => {
    let events = 0, wasDim = false;
    for (let t = 0; t < 120000; t += 10) {
      const d = flicker(t) < 0.999;
      if (d && !wasDim) events++;
      wasDim = d;
    }
    const expected = 120000 / FLICKER_EVERY_MS;
    expect(events).toBeGreaterThan(expected * 0.4);
    expect(events).toBeLessThan(expected * 1.1);
  });
  it("is deterministic and differs by phase", () => {
    expect(flicker(12345, 7)).toBe(flicker(12345, 7));
    let differ = false;
    for (let t = 0; t < 60000 && !differ; t += 10) differ = flicker(t, 0) !== flicker(t, 3000);
    expect(differ).toBe(true);
  });
});

describe("the pattern", () => {
  it("is a coarse web inside the disc, the same every time", () => {
    const a = webStrands(), b = webStrands();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(12);
    expect(a.length).toBeLessThan(40);
    for (const s of a) {
      for (const [x, y] of [[s.ax, s.ay], [s.bx, s.by]]) expect(Math.hypot(x, y)).toBeLessThanOrEqual(0.93);
    }
  });
});

// ── Through the real layers ─────────────────────────────────────────────────
const AT = { x: 400, y: 300 };
function ball(over: Partial<Ball> = {}): Ball {
  return {
    id: "b1", position: { ...AT }, renderPosition: { ...AT }, velocity: { x: 0, y: 0 },
    speed: 0, baseSpeed: 235, topSpeed: 300, minimumSpeed: 150,
    radius: 18, color: "#ff4d5a", state: "active", effects: createBallEffectState(), rotation: 0,
    ...over,
  } as unknown as Ball;
}
function scene(b: Ball, scale = 1) {
  const layer = new SleekBallLayer();
  const shadows = new Graphics();
  const w2s = (x: number, y: number) => ({ x: x * scale, y: y * scale });
  const light = lightScope({ x: 0, y: 0, width: 800, height: 600 } as never, 0);
  const game = { balls: [b], activePlaySeconds: 1, walls: [], obstaclePolygons: [], movers: [], chains: [] } as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draw = (now: number) => { layer.sync(game, light, shadows, w2s, scale, now); return (layer as unknown as any).views[0]; };
  return { draw, game, w2s };
}

describe("the web on the body", () => {
  it("is a multiply layer riding the body's own fan", () => {
    const v = scene(ball()).draw(1000);
    expect(v.web.visible).toBe(true);
    expect(v.web.blendMode).toBe("multiply");
    const body = v.body.geometry.attributes.aPosition.buffer.data as Float32Array;
    const web = v.web.geometry.attributes.aPosition.buffer.data as Float32Array;
    for (let i = 2; i < body.length; i++) expect(web[i]).toBeCloseTo(body[i], 5);
  });
  it("turns with the ball's rotation", () => {
    const b = ball({ rotation: 0 });
    const { draw } = scene(b);
    const uv0 = Array.from(draw(1000).web.geometry.attributes.aUV.buffer.data as Float32Array);
    // The web turns at WEB_SPIN of the ball's rotation: this is a quarter turn of the pattern.
    b.rotation = (Math.PI / 2) / WEB_SPIN;
    const uv1 = Array.from(draw(1016).web.geometry.attributes.aUV.buffer.data as Float32Array);
    expect(uv1).not.toEqual(uv0);
    // A quarter turn the same way round as a sprite's rotation: the vertex a
    // quarter of the way round the ring now samples what the first one did.
    const q = SPLAT_SEGMENTS / 4;
    expect(uv1[(q + 1) * 2]).toBeCloseTo(uv0[2], 5);
    expect(uv1[(q + 1) * 2 + 1]).toBeCloseTo(uv0[3], 5);
    // Every ring UV still sits on the texture's disc.
    for (let i = 1; i <= SPLAT_SEGMENTS; i++) expect(Math.hypot(uv1[i * 2] - 0.5, uv1[i * 2 + 1] - 0.5)).toBeCloseTo(0.5, 5);
  });
  it("follows the strength slider and is gone at zero", () => {
    const v = scene(ball()).draw(1000);
    const full = v.web.alpha;
    setBallLook({ web: 0.3 });
    expect(scene(ball()).draw(1000).web.alpha).toBeCloseTo(full * 0.5, 5);
    setBallLook({ web: 0 });
    expect(scene(ball()).draw(1000).web.visible).toBe(false);
  });
  it("fades out on a tiny ball, where it would be dirt", () => {
    expect(scene(ball({ radius: 5 })).draw(1000).web.visible).toBe(false);
    expect(scene(ball({ radius: 18 })).draw(1000).web.visible).toBe(true);
  });
});

describe("the light pool is plain", () => {
  it("carries no pattern, at any web strength", () => {
    // One emitter, one sprite in it. The gobo was a SECOND sprite parented to
    // the same pool, so a child count of one is the durable way to say the
    // pattern is gone - a stronger pin than any alpha, because it also catches
    // the pattern coming back as a different texture on a new sprite.
    const b = ball({ rotation: 1.2 });
    const { game, w2s } = scene(b);
    const pass = new BallLightPass();
    pass.build(game, w2s, 1, 5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = (pass as unknown as any).emitters[0];
    expect(e.pool.children.length).toBe(1);
    expect(e.pool.children[0]).toBe(e.glow);
    // And the pool does not turn with the ball. The container rotates with the
    // ball's HEADING for the speed stretch, which is a different thing: this
    // ball is not moving, so nothing here should be at an angle.
    expect(e.glow.rotation).toBe(0);
    expect(e.pool.rotation).toBe(0);
  });
  it("is the same light whatever the web slider says", () => {
    const { game, w2s } = scene(ball({ rotation: 1.2 }));
    const alphaAt = (web: number) => {
      setBallLook({ web, flicker: false });
      const pass = new BallLightPass();
      pass.build(game, w2s, 1, 5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (pass as unknown as any).emitters[0].glow.alpha as number;
    };
    const off = alphaAt(0);
    expect(off).toBeGreaterThan(0);
    // The web used to take (1 - strength) out of the plain pool and hand it to
    // the gobo, so a full-strength web left the glow at zero. It is now a
    // shell dial and the light does not hear it.
    expect(alphaAt(1)).toBeCloseTo(off, 6);
    expect(alphaAt(0.6)).toBeCloseTo(off, 6);
  });
  it("dims with the flicker", () => {
    setBallLook({ web: 0.5, flicker: true });
    const b = ball();
    const { game, w2s } = scene(b);
    const pass = new BallLightPass();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emitter = () => (pass as unknown as any).emitters[0];
    // The pass flickers on the ball's own phase; find a steady and a dim moment on it.
    const phase = heartPhase(b.id) * 7;
    let tDim = -1, tSteady = -1;
    for (let t = 0; t < 120000 && (tDim < 0 || tSteady < 0); t += 10) {
      const f = flicker(t, phase);
      if (f < 0.7 && tDim < 0) tDim = t;
      if (f === 1 && tSteady < 0) tSteady = t;
    }
    expect(tDim).toBeGreaterThanOrEqual(0);
    pass.build(game, w2s, 1, tSteady);
    const steady = emitter().glow.alpha;
    pass.build(game, w2s, 1, tDim);
    expect(emitter().glow.alpha).toBeLessThan(0.75 * steady);
  });
});

describe("the Playground can reach it", () => {
  it("has the web slider and the flicker toggle", () => {
    const src = readFileSync(resolve(__dirname, "../components/admin/PlaygroundScreen.tsx"), "utf8");
    expect(src).toMatch(/id="ball-web-strength"/);
    expect(src).toMatch(/setBallLook\(\{ web:/);
    expect(src).toMatch(/setBallLook\(\{ flicker:/);
  });
});
