/**
 * Nothing the ball layer draws may reach across the board.
 *
 * The compass beam was reported three times and survived two rounds of
 * reasoning about Pixi's semantics, because both rounds argued from the source
 * instead of measuring the output. `rendererPathHygiene.test.ts` reads the
 * layers as TEXT and checks that every continuing call (arc, arcTo, the two
 * curve calls) opens a subpath within three lines. That is a useful rule, but
 * it can only ever confirm that the code looks right - it cannot see a beam,
 * and it passed throughout.
 *
 * This drives the real layer and measures the geometry Pixi actually builds.
 * Every mark on a ball is local to that ball: a ring, a halo, a frost cage, a
 * highlight. None of them is wider than a few ball radii. So any segment longer
 * than that is, by construction, a beam - whatever drew it, and whether or not
 * anyone predicted the mechanism.
 *
 * Held deliberately at the layer, not at compassRing(): the bug was never in
 * the geometry. `moveTo` had to be missing AND the shared Graphics had to be
 * carrying path state from the marks drawn before it, and only running the two
 * together shows that.
 */
import { describe, it, expect } from "vitest";
import { Graphics } from "pixi.js";
import { SleekBallLayer } from "@/lib/rendering/sleek/ballLayer";
import { lightScope } from "@/lib/rendering/sleek/light";
import { DEFAULT_TURN_INTERVAL } from "@/lib/physics/turnTimer";
import type { Ball } from "@/types/game";

/**
 * The longest straight run in everything a Graphics has queued or flushed.
 *
 * Pixi flattens an arc into a polyline, so a legitimate ring shows up here as
 * many short segments; a beam shows up as one long one. That difference is the
 * entire test.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function longestSegment(g: any): { max: number; where: string } {
  const paths: any[] = [];
  for (const ins of g.context?.instructions ?? []) if (ins.data?.path) paths.push(ins.data.path);
  if (g.context?._activePath) paths.push(g.context._activePath);

  let max = 0, where = "nothing drawn";
  for (const path of paths) {
    for (const prim of path.shapePath?.shapePrimitives ?? []) {
      const pts: number[] = (prim.shape as any).points ?? [];
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const d = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
        if (d > max) {
          max = d;
          where = `${prim.shape.type} (${pts[i].toFixed(0)},${pts[i + 1].toFixed(0)})`
            + ` -> (${pts[i + 2].toFixed(0)},${pts[i + 3].toFixed(0)})`;
        }
      }
    }
  }
  return { max, where };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Every flattened arc in a Graphics, as its own run length plus the radius it
 * was drawn at, so a sweep can be recovered in radians.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function polylines(g: any): Array<{ length: number; radius: number }> {
  const paths: any[] = [];
  for (const ins of g.context?.instructions ?? []) if (ins.data?.path) paths.push(ins.data.path);
  if (g.context?._activePath) paths.push(g.context._activePath);

  const out: Array<{ length: number; radius: number }> = [];
  for (const path of paths) {
    for (const prim of path.shapePath?.shapePrimitives ?? []) {
      if (prim.shape.type !== "polygon") continue;
      const pts: number[] = (prim.shape as any).points ?? [];
      if (pts.length < 6) continue;
      let length = 0;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        length += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
      }
      // The arc is centred on the ball, which the caller placed at 400,300.
      const radius = Math.hypot(pts[0] - 400, pts[1] - 300);
      out.push({ length, radius });
    }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const RADIUS = 9;
/** Generous: the widest mark is the fastest-ball ring at r + 6px. */
const LONGEST_LOCAL_MARK = 80;

function compassBall(over: Partial<Ball> = {}): Ball {
  return {
    id: "c1",
    position: { x: 400, y: 300 },
    renderPosition: { x: 400, y: 300 },
    velocity: { x: 100, y: 0 },
    speed: 100, baseSpeed: 235, topSpeed: 300, minimumSpeed: 150,
    radius: RADIUS, color: "#c08cff", state: "active",
    ability: "turnTimer", turnIntervalSeconds: DEFAULT_TURN_INTERVAL,
    nextTurnAt: DEFAULT_TURN_INTERVAL, effects: [],
    ...over,
  } as unknown as Ball;
}

describe("the ball layer draws nothing that reaches across the board", () => {
  it("holds through a whole compass cycle, turning either way", () => {
    const layer = new SleekBallLayer();
    const shadows = new Graphics();
    const w2s = (x: number, y: number) => ({ x, y });
    const light = lightScope({ x: 0, y: 0, width: 800, height: 600 } as never, 0);

    let framesWithGeometry = 0;
    const frames = 40;

    for (const turnClockwise of [true, false]) {
      for (let i = 0; i <= frames; i++) {
        // Stop a hair short of the turn: at exactly 0 remaining the ring has
        // nothing left to unwind and correctly draws nothing.
        const seconds = (i / frames) * (DEFAULT_TURN_INTERVAL - 0.01);
        const game = {
          balls: [compassBall({ turnClockwise } as Partial<Ball>)],
          activePlaySeconds: seconds,
          fastestBallId: "c1",
          walls: [], obstaclePolygons: [], movers: [], chains: [],
        } as never;

        layer.sync(game, light, shadows, w2s, 1, 0);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const seg = longestSegment((layer as unknown as any).overlays);
        if (seg.max > 0) framesWithGeometry++;
        expect(
          seg.max,
          `cw=${turnClockwise} t=${seconds.toFixed(2)}s drew ${seg.where}`,
        ).toBeLessThan(LONGEST_LOCAL_MARK);
      }
    }

    // Without this the test passes just as happily when the ring never draws at
    // all, which is how the first version of it was green while the beam was
    // still on screen: the probe ball had no `nextTurnAt`, so there was no ring
    // and nothing to measure.
    expect(framesWithGeometry).toBeGreaterThan(frames);
  });

  /**
   * What the layer ACTUALLY sweeps, both ways round.
   *
   * Measured HERE rather than beside compassRing(), and that placement is the
   * point. A test that calls `arc()` itself is a second reading of the same
   * fact: it can only confirm that the geometry is self-consistent, and it
   * stays green while the layer passes `arc()` a different argument list. That
   * is exactly how the flag survived - the bounds were right all along, and the
   * ring was still inverted for every counter-clockwise ball, nearly full when
   * the turn was imminent and nearly empty just after one landed.
   */
  it("sweeps the arc the countdown promises, whichever way the ball turns", () => {
    const layer = new SleekBallLayer();
    const shadows = new Graphics();
    const w2s = (x: number, y: number) => ({ x, y });
    const light = lightScope({ x: 0, y: 0, width: 800, height: 600 } as never, 0);

    for (const turnClockwise of [true, false]) {
      for (const progress of [0.1, 0.35, 0.6, 0.9]) {
        const game = {
          balls: [compassBall({ turnClockwise } as Partial<Ball>)],
          activePlaySeconds: DEFAULT_TURN_INTERVAL * progress,
          // Nothing else may add a polyline: the ring must be the only one.
          fastestBallId: null,
          walls: [], obstaclePolygons: [], movers: [], chains: [],
        } as never;
        layer.sync(game, light, shadows, w2s, 1, 0);

        const arcs = polylines((layer as unknown as never as { overlays: unknown }).overlays);
        expect(arcs.length, `cw=${turnClockwise} progress=${progress}`).toBe(1);
        const { length, radius } = arcs[0];
        const swept = length / radius;
        // The ring shows what is LEFT of the cycle, so it unwinds toward zero.
        expect(swept, `cw=${turnClockwise} progress=${progress}`)
          .toBeCloseTo((1 - progress) * Math.PI * 2, 1);
      }
    }
  });

  it("holds with several balls sharing the layer's Graphics", () => {
    // The beam was a line from the canvas origin to the first ring. Path state
    // left behind by one ball is inherited by the next, so more balls is
    // strictly more opportunity, and two compass balls is the ordinary case
    // from level 18 on.
    const layer = new SleekBallLayer();
    const shadows = new Graphics();
    const w2s = (x: number, y: number) => ({ x, y });
    const light = lightScope({ x: 0, y: 0, width: 800, height: 600 } as never, 0);

    const game = {
      balls: [
        compassBall({ id: "a", position: { x: 120, y: 90 }, renderPosition: { x: 120, y: 90 } } as Partial<Ball>),
        compassBall({ id: "b", position: { x: 600, y: 420 }, renderPosition: { x: 600, y: 420 }, turnClockwise: false } as Partial<Ball>),
        compassBall({ id: "c", position: { x: 300, y: 500 }, renderPosition: { x: 300, y: 500 }, frozenUntil: 10_000 } as Partial<Ball>),
      ],
      activePlaySeconds: 3, fastestBallId: "a",
      walls: [], obstaclePolygons: [], movers: [], chains: [],
    } as never;

    layer.sync(game, light, shadows, w2s, 1, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seg = longestSegment((layer as unknown as any).overlays);
    expect(seg.max, `drew ${seg.where}`).toBeGreaterThan(0);
    expect(seg.max, `drew ${seg.where}`).toBeLessThan(LONGEST_LOCAL_MARK);
  });
});

/**
 * The same layer, reused frame after frame, the way the game actually runs it.
 *
 * Every sweep before this one built a FRESH layer for each state it wanted to
 * try, which quietly rules out the whole reason the beam was hard to catch:
 * that it needs a long-lived session. A Graphics keeps its path state across
 * `clear()` (Pixi clears the instruction list and the active path, but `_tick`
 * and the seed left by the last `fill`/`stroke` are their own story), so what
 * one frame leaves behind is what the next frame starts from. A layer built
 * fresh per assertion can never show that.
 *
 * It also looks for the ORIGIN rather than for length. A long segment has to be
 * judged against a threshold and argued about; a path point at exactly (0, 0)
 * is not a coincidence, because the transform below puts every legitimate mark
 * hundreds of pixels away from it. A non-finite point is caught for the same
 * reason: `undefined` and `NaN` are what Pixi's own `getLastPoint` hands back
 * for an arc, and geometry built from those is corrupt whether or not it is
 * long.
 */
describe("the ball layer stays clean across a long session", () => {
  /** Offset well away from the origin, so (0,0) can only be a stray. */
  const W2S = (x: number, y: number) => ({ x: 400 + x, y: 500 + y });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function strayPoints(g: any): string[] {
    const paths: any[] = [];
    for (const ins of g.context?.instructions ?? []) if (ins.data?.path) paths.push(ins.data.path);
    if (g.context?._activePath) paths.push(g.context._activePath);

    const out: string[] = [];
    for (const path of paths) {
      for (const prim of path.shapePath?.shapePrimitives ?? []) {
        const pts: number[] = (prim.shape as any).points ?? [];
        for (let i = 0; i + 1 < pts.length; i += 2) {
          const nonFinite = !Number.isFinite(pts[i]) || !Number.isFinite(pts[i + 1]);
          const atOrigin = !nonFinite && Math.hypot(pts[i], pts[i + 1]) < 0.5;
          if (nonFinite || atOrigin) {
            out.push(
              `${prim.shape.type} point ${i / 2} is (${pts[i]},${pts[i + 1]}), `
              + `running to (${pts[i + 2]},${pts[i + 3]})`,
            );
          }
        }
      }
    }
    return out;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it("draws no origin or non-finite point over forty frames of mixed state", () => {
    const layer = new SleekBallLayer();
    const shadows = new Graphics();
    const light = lightScope({ left: 0, top: 0, width: 900, height: 900, scale: 1 } as never, 0);

    // States that change which marks land on the SHARED overlays Graphics, and
    // crucially what the last call on it was: a boss splash ends on fill(), a
    // frost cage on stroke(), a plain ball on the ring itself.
    const variants: Array<Partial<Ball>> = [
      {},
      { frozenUntil: 1e12 },
      { splitAnimAt: 0.2, splitDirX: 1, splitDirY: 0 },
      { splitAnimAt: 0.2, splitDirX: 1, splitDirY: 0, frozenUntil: 1e12 },
      { isBoss: true, bossHp: 2, bossMaxHp: 3 },
    ];

    const found = new Set<string>();
    let framesWithGeometry = 0;

    for (let frame = 0; frame < 40; frame++) {
      const seconds = frame * 0.25;
      const variant = variants[frame % variants.length];
      const balls = [0, 1, 2].map(i => compassBall({
        ...variant,
        id: `b${i}`,
        position: { x: 120 + i * 180, y: 140 + i * 90 },
        renderPosition: { x: 120 + i * 180, y: 140 + i * 90 },
        nextTurnAt: seconds + 0.2 + i * 2.5,
        turnClockwise: i % 2 === 0,
      } as Partial<Ball>));

      const game = {
        balls, fastestBallId: "b0", assimilations: new Map(),
        activePlaySeconds: seconds,
        boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
      } as never;

      shadows.clear();
      layer.sync(game, light, shadows, W2S, 1, frame * 250);

      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const overlays = (layer as unknown as any).overlays;
      if (longestSegment(overlays).max > 0) framesWithGeometry++;
      for (const stray of strayPoints(overlays)) found.add(`frame ${frame}: ${stray}`);
    }

    // Mutation-proofing: a sweep that measured nothing would pass forever, and
    // the first version of the test above did exactly that.
    expect(framesWithGeometry, "no ring was ever drawn, so nothing was swept")
      .toBeGreaterThan(30);
    expect([...found], "the ball layer drew from the canvas origin").toEqual([]);
  });
});
