/**
 * A splatted ball is drawn splatted by EVERYTHING, not just by its body.
 *
 * Two separate lessons are pinned here, learned in that order.
 *
 * FIRST: the ball is drawn as four things - a shadow, a body, an additive
 * corona and its mark - and for a long time only the body took the
 * deformation. A splatted ball was a flattened body underneath a perfectly
 * round bloom, blended with "add", seated on a perfectly round shadow. At ball
 * size the round glow simply won, and the squash was invisible on screen while
 * being correct in memory.
 *
 * SECOND: even once they all agreed, they agreed on an ELLIPSE, and an ellipse
 * squeezes symmetrically - the far side of the ball flattens exactly as much as
 * the side against the wall. The body is a MESH now so the silhouette can be a
 * droplet: flat contact face, mass pooled at the wall, domed crown. A sprite
 * could never have been one, which is why this file checks vertices rather than
 * a scale factor.
 *
 * Driven through the real layer, because that is the whole lesson of
 * ballLayerNoBeams next door: reasoning about the source said the squash was
 * applied, and it was - to one of the four things that needed it.
 */
import { describe, it, expect } from "vitest";
import { Graphics } from "pixi.js";
import { SleekBallLayer } from "@/lib/rendering/sleek/ballLayer";
import { lightScope } from "@/lib/rendering/sleek/light";
import {
  createBallEffectState, triggerWallHit, pinSquish, updateBallEffects, getSquishEffect,
} from "@/lib/ballEffects";
import { SPLAT_SEGMENTS, splatOutline, splatMetrics, splatCore } from "@/lib/rendering/splatShape";
import { heartbeat, heartPhase, heartRate, BREATHE } from "@/lib/rendering/ballLife";
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

interface Fan { x: number[]; y: number[]; cx: number; cy: number }
/** The screen positions the layer actually wrote, split into centre and ring. */
function fanOf(mesh: { geometry: { attributes: { aPosition: { buffer: { data: Float32Array } } } } }): Fan {
  const d = mesh.geometry.attributes.aPosition.buffer.data;
  const x: number[] = [], y: number[] = [];
  for (let i = 1; i <= SPLAT_SEGMENTS; i++) { x.push(d[i * 2]); y.push(d[i * 2 + 1]); }
  return { x, y, cx: d[0], cy: d[1] };
}

function render(b: Ball, now: number) {
  const layer = new SleekBallLayer();
  const shadows = new Graphics();
  const w2s = (x: number, y: number) => ({ x, y });
  const light = lightScope({ x: 0, y: 0, width: 800, height: 600 } as never, 0);
  const game = {
    balls: [b], activePlaySeconds: 1,
    walls: [], obstaclePolygons: [], movers: [], chains: [],
  } as never;
  layer.sync(game, light, shadows, w2s, 1, now);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const view = (layer as unknown as any).views[0];
  return { body: fanOf(view.body), corona: fanOf(view.corona), view };
}

/**
 * A ball splatted against a wall on its RIGHT, held, at `ms` after impact.
 *
 * The impact normal is the bounce impulse, so it points AWAY from the surface:
 * a ball that hit a wall on its right has its velocity flipped to -x and a
 * normal of -x. The wall is therefore on the +x side.
 */
function splatted(ms: number) {
  const t0 = 10_000;
  const fx = createBallEffectState();
  triggerWallHit(fx, t0, -300, 0, 300);
  pinSquish(fx, t0, 2000);
  for (let t = 0; t <= ms; t += 1000 / 60) updateBallEffects(fx, 1 / 60, t0 + t);
  return { fx, now: t0 + ms };
}

describe("a round ball is drawn round", () => {
  it("puts every ring vertex the same distance from the centre", () => {
    const { body } = render(ball(createBallEffectState()), 10_000);
    const d = body.x.map((x, i) => Math.hypot(x - AT.x, body.y[i] - AT.y));
    const lo = Math.min(...d), hi = Math.max(...d);
    expect(hi - lo).toBeLessThan(0.001);
    expect(body.cx).toBeCloseTo(AT.x, 6);
    expect(body.cy).toBeCloseTo(AT.y, 6);
  });

  it("keeps the corona concentric with it", () => {
    const { corona } = render(ball(createBallEffectState()), 10_000);
    const d = corona.x.map((x, i) => Math.hypot(x - AT.x, corona.y[i] - AT.y));
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(0.001);
    // ...and larger, since it carries the bloom that bleeds past the edge.
    expect(Math.max(...d)).toBeGreaterThan(RADIUS);
  });
});

describe("a splatted ball is a droplet, not an ellipse", () => {
  it("flattens the face against the wall and leaves the far side round", () => {
    const { body } = render(ball(splatted(300).fx), splatted(300).now);
    // The wall is on the +x side, so the contact face is the vertices at max x.
    const maxX = Math.max(...body.x);
    const minX = Math.min(...body.x);
    const onWall = body.y.filter((_, i) => body.x[i] > maxX - 0.5);
    const onFar = body.y.filter((_, i) => body.x[i] < minX + 0.5);
    // MANY vertices share the wall's x (it is a flat chord), and only a couple
    // sit at the far extreme (it is still a dome). That asymmetry is the whole
    // difference from an ellipse, which would have the two counts equal.
    expect(onWall.length).toBeGreaterThan(onFar.length * 3);
  });

  it("spreads along the wall and loses height across it", () => {
    const s = splatted(300);
    const { body } = render(ball(s.fx), s.now);
    const along = Math.max(...body.y) - Math.min(...body.y);   // across the normal
    const across = Math.max(...body.x) - Math.min(...body.x);   // along the normal
    expect(along).toBeGreaterThan(2 * RADIUS * 1.4);           // wider than the ball
    expect(across).toBeLessThan(2 * RADIUS * 0.75);                 // and much shorter
  });

  it("puts the widest point at the wall, not at the middle", () => {
    // The droplet's signature. On an ellipse the widest point is the centre.
    const s = splatted(300);
    const { body } = render(ball(s.fx), s.now);
    const maxX = Math.max(...body.x);      // the wall
    const minX = Math.min(...body.x);      // the crown
    const depth = maxX - minX;
    /** Width across the normal within a band at this depth from the wall. */
    const widthAt = (lo: number, hi: number) => {
      const ys = body.y.filter((_, i) => {
        const f = (maxX - body.x[i]) / depth;   // 0 at the wall, 1 at the crown
        return f >= lo && f <= hi;
      });
      return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    };
    const atWall = widthAt(0, 0.12);
    const atMiddle = widthAt(0.44, 0.56);
    const atCrown = widthAt(0.85, 1);
    // Widest hard against the wall, narrowing all the way to the crown. An
    // ellipse peaks in the MIDDLE, so this ordering is the discriminating test.
    expect(atWall).toBeGreaterThan(atMiddle);
    expect(atMiddle).toBeGreaterThan(atCrown);
  });

  it("slides the highlight down onto the mass, at the deformed CORE", () => {
    // The centre vertex carries the texture's bright core, so where it goes is
    // where the highlight goes. It rides the deformed core - the middle of the
    // sphere put through the same transform as every vertex - rather than the
    // outline's centroid, which is an average of a silhouette and gets dragged
    // about by the footprint spreading. The filament is a material point.
    const s = splatted(300);
    // Held, as a pinned splat always is in the game: a held ball breathes
    // about the wall its face is glued to, at a held ball's slow rate.
    const { body } = render(ball(s.fx, { frozenUntil: s.now + 1000, bugSquashUntil: s.now + 1000 }), s.now);
    const splat = getSquishEffect(s.fx, 1).splat;
    // The body breathes (ballLife.ts): the core is computed on the radius the
    // heartbeat has swelled it to at this instant, not the resting one.
    const rBody = RADIUS * (1 + BREATHE * heartbeat(s.now, heartPhase("b1"), heartRate({ fastest: false, held: true })));
    const core = splatCore(splat, rBody);
    const centroid = splatMetrics(splatOutline(splat, rBody));
    // The ball hit a wall on its RIGHT, so contact space maps to the screen
    // simply here: the wall is the vertical line at AT.x + RADIUS, and contact
    // y (negative, off the wall) runs back along -x from it.
    const wallX = AT.x + RADIUS;
    expect(body.cx).toBeGreaterThan(AT.x);                  // toward the wall
    expect(body.cx).toBeCloseTo(wallX + core.y, 3);         // exactly on the core (float32 buffer)
    expect(body.cx).toBeGreaterThan(wallX + centroid.cy);   // nearer the wall than the centroid
    expect(body.cx).toBeLessThan(wallX);                    // and never through it
    expect(body.cy).toBeCloseTo(AT.y, 6);                   // still on the impact axis
  });
});

describe("the corona takes the ball's shape", () => {
  it("is the same silhouette, blown outward from the same mass", () => {
    const s = splatted(300);
    const { body, corona } = render(ball(s.fx), s.now);
    expect(corona.cx).toBeCloseTo(body.cx, 6);
    expect(corona.cy).toBeCloseTo(body.cy, 6);
    // Every corona vertex is the matching body vertex pushed out from the
    // centre by one constant. This is the assertion that would have failed when
    // the corona was a uniformly-scaled round sprite.
    const ratios = corona.x.map((x, i) => {
      const bd = Math.hypot(body.x[i] - body.cx, body.y[i] - body.cy);
      const cd = Math.hypot(x - corona.cx, corona.y[i] - corona.cy);
      return cd / bd;
    });
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.001);
    expect(Math.max(...ratios)).toBeGreaterThan(1.5);
  });

  it("goes round again once the splat is over", () => {
    const s = splatted(2000 + 900);
    const { corona } = render(ball(s.fx), s.now);
    const d = corona.x.map((x, i) => Math.hypot(x - AT.x, corona.y[i] - AT.y));
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(0.001);
  });
});
