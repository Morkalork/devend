/**
 * The motions that make a ball read as alive (ballLife.ts, look C).
 *
 * Nothing about the drawing changed; four motions were added. Each is pinned
 * here on its own, and then through the real layer, because the ball had a
 * pulse phase for a long time that nothing drew, and "it animates" was true in
 * the state and false on the screen.
 */
import { describe, it, expect } from "vitest";
import { Graphics } from "pixi.js";
import {
  heartbeat, heartPhase, heartRate, flightStretch, createLag, stepLag,
  HEART_BPM, BREATHE, STRETCH_MAX, LAG_LIMIT,
} from "@/lib/rendering/ballLife";
import { SleekBallLayer } from "@/lib/rendering/sleek/ballLayer";
import { lightScope } from "@/lib/rendering/sleek/light";
import { SPLAT_SEGMENTS } from "@/lib/rendering/splatShape";
import {
  createBallEffectState, triggerWallHit, updateBallEffects, getSquishEffect,
} from "@/lib/ballEffects";
import type { Ball } from "@/types/game";

describe("heartbeat", () => {
  const period = 60000 / HEART_BPM;
  it("is a lub and a dub per period, between 0 and 1", () => {
    let peaks = 0, prev = 0, prev2 = 0;
    for (let t = 0; t <= period; t += 2) {
      const v = heartbeat(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (prev > prev2 && prev > v && prev > 0.2) peaks++;
      prev2 = prev; prev = v;
    }
    expect(peaks).toBe(2);
  });
  it("rests between beats", () => {
    expect(heartbeat(period * 0.6)).toBeLessThan(0.02);
  });
  it("repeats every period", () => {
    expect(heartbeat(123)).toBeCloseTo(heartbeat(123 + period), 6);
  });
  it("gives every ball its own phase", () => {
    const phases = new Set(["red-0", "blue-1", "yellow-2", "purple-3", "green-4"].map(heartPhase));
    expect(phases.size).toBe(5);
  });
  it("races for the fastest ball and crawls when held", () => {
    expect(heartRate({ fastest: true, held: false })).toBeGreaterThan(1);
    expect(heartRate({ fastest: false, held: true })).toBeLessThan(1);
    expect(heartRate({ fastest: true, held: true })).toBeLessThan(1);
    expect(heartRate({ fastest: false, held: false })).toBe(1);
  });
});

describe("flight stretch", () => {
  it("is nothing at rest, grows with speed and saturates", () => {
    expect(flightStretch(0)).toBe(0);
    expect(flightStretch(100)).toBeGreaterThan(0);
    expect(flightStretch(100)).toBeLessThan(flightStretch(200));
    expect(flightStretch(250)).toBe(STRETCH_MAX);
    expect(flightStretch(900)).toBe(STRETCH_MAX);
  });
});

describe("the filament's lag", () => {
  it("is kicked the other way by a change of velocity and comes home", () => {
    const lag = createLag();
    stepLag(lag, 200, 0, 18, 0);          // seen: moving +x
    stepLag(lag, -200, 0, 18, 1 / 60);    // bounced: now -x
    // The body reversed toward -x; the filament, with inertia, lurches +x.
    expect(lag.x).toBeGreaterThan(0);
    let peak = lag.x;
    for (let i = 0; i < 120; i++) { stepLag(lag, -200, 0, 18, 1 / 60); peak = Math.max(peak, lag.x); }
    expect(peak).toBeGreaterThan(1);
    expect(Math.abs(lag.x)).toBeLessThan(0.05);   // settled within two seconds
  });
  it("never leaves the body", () => {
    const lag = createLag();
    stepLag(lag, 0, 0, 18, 0);
    stepLag(lag, 5000, 0, 18, 1 / 60);
    expect(Math.hypot(lag.x, lag.y)).toBeLessThanOrEqual(18 * LAG_LIMIT + 1e-9);
  });
  it("does not move while the velocity is steady", () => {
    const lag = createLag();
    for (let i = 0; i < 60; i++) stepLag(lag, 150, 90, 18, 1 / 60);
    expect(lag.x).toBe(0);
    expect(lag.y).toBe(0);
  });
});

describe("jelly after a bounce", () => {
  const T0 = 1000;
  it("swings past round before settling", () => {
    const st = createBallEffectState();
    triggerWallHit(st, T0, -300, 0, 300);
    let taller = false, round = false;
    for (let t = 0; t <= 700; t += 1000 / 120) {
      updateBallEffects(st, 1 / 120, T0 + t);
      const s = getSquishEffect(st, 1);
      if (s.scaleAlong > 1.005) taller = true;   // taller than round: the overswing
      if (t > 500 && !s.active) round = true;
    }
    expect(taller).toBe(true);
    expect(round).toBe(true);
  });
});

// ── Through the real layer ──────────────────────────────────────────────────
const AT = { x: 400, y: 300 };
const RADIUS = 18;
function ball(over: Partial<Ball> = {}): Ball {
  return {
    id: "b1", position: { ...AT }, renderPosition: { ...AT }, velocity: { x: 0, y: 0 },
    speed: 0, baseSpeed: 235, topSpeed: 300, minimumSpeed: 150,
    radius: RADIUS, color: "#ff4d5a", state: "active", effects: createBallEffectState(),
    ...over,
  } as unknown as Ball;
}
function ring(view: { body: { geometry: { attributes: { aPosition: { buffer: { data: Float32Array } } } } } }) {
  const d = view.body.geometry.attributes.aPosition.buffer.data;
  const pts: { x: number; y: number }[] = [];
  for (let i = 1; i <= SPLAT_SEGMENTS; i++) pts.push({ x: d[i * 2], y: d[i * 2 + 1] });
  return { centre: { x: d[0], y: d[1] }, pts };
}
function extent(pts: { x: number; y: number }[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  return { w: maxX - minX, h: maxY - minY };
}
function scene(b: Ball) {
  const layer = new SleekBallLayer();
  const shadows = new Graphics();
  const w2s = (x: number, y: number) => ({ x, y });
  const light = lightScope({ x: 0, y: 0, width: 800, height: 600 } as never, 0);
  const game = { balls: [b], activePlaySeconds: 1, walls: [], obstaclePolygons: [], movers: [], chains: [] } as never;
  const draw = (now: number) => { layer.sync(game, light, shadows, w2s, 1, now); return ring((layer as unknown as { views: never[] }).views[0]); };
  return { draw, game };
}

describe("on screen", () => {
  it("the body breathes: its size follows the heartbeat", () => {
    const b = ball();
    const { draw } = scene(b);
    const period = 60000 / HEART_BPM;
    // Find the beat and the rest for this ball's phase, then draw at both.
    let tBeat = 0, tRest = 0, vBeat = -1, vRest = 2;
    for (let t = 0; t < period; t += 2) {
      const v = heartbeat(t, heartPhase(b.id));
      if (v > vBeat) { vBeat = v; tBeat = t; }
      if (v < vRest) { vRest = v; tRest = t; }
    }
    const atBeat = extent(draw(tBeat).pts).w;
    const atRest = extent(draw(tRest).pts).w;
    expect(atBeat).toBeGreaterThan(atRest * (1 + BREATHE * 0.6));
    // And it swells about its centre, not about some old contact point.
    const r = draw(tBeat);
    const cx = r.pts.reduce((s, p) => s + p.x, 0) / r.pts.length;
    expect(cx).toBeCloseTo(AT.x, 1);
  });

  it("a fast ball is longer along its travel than across it", () => {
    const fast = ball({ velocity: { x: 300, y: 0 } });
    const { draw } = scene(fast);
    const e = extent(draw(5000).pts);
    expect(e.w / e.h).toBeGreaterThan(1 + STRETCH_MAX * 1.2);
    const slow = ball({ velocity: { x: 20, y: 0 } });
    const es = extent(scene(slow).draw(5000).pts);
    expect(es.w / es.h).toBeLessThan(1.02);
  });

  it("a held ball keeps its velocity but not the stretch", () => {
    const b = ball({ velocity: { x: 300, y: 0 }, frozenUntil: 9000 });
    const e = extent(scene(b).draw(5000).pts);
    expect(e.w / e.h).toBeCloseTo(1, 2);
  });

  it("the filament slides opposite to a change of direction, then settles", () => {
    const b = ball({ velocity: { x: 200, y: 0 } });
    const { draw } = scene(b);
    draw(1000);
    draw(1016);
    b.velocity = { x: -200, y: 0 };         // bounced off a wall on the right
    const r = draw(1032);
    const cx = r.pts.reduce((s, p) => s + p.x, 0) / r.pts.length;
    expect(r.centre.x - cx).toBeGreaterThan(0.5);   // lurches on toward the wall
    let last = r;
    for (let t = 1048; t < 3500; t += 16) last = draw(t);
    const cx2 = last.pts.reduce((s, p) => s + p.x, 0) / last.pts.length;
    expect(Math.abs(last.centre.x - cx2)).toBeLessThan(0.05);
  });
});
