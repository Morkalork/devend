/**
 * The three things that make the ball light dynamic rather than decorative.
 *
 * All three answer the same complaint from different sides: the pool was a
 * flat additive disc whose only variable was where it sat.
 *
 *   ENERGY      how much is happening reaches the light at all (ballTell.ts
 *               speedGain), where before only the pool's SHAPE moved.
 *   EXPOSURE    a crowd of pools rolls off instead of summing into a white
 *               patch with no contrast left in it (exposure.ts).
 *   GEOMETRY    a wall's face answers the light in FRONT of it rather than
 *               merely near it (faceLight.ts), and a ball's shadow spreads
 *               with distance because a ball is an area source, not a point
 *               (ballLight.ts shadowQuad).
 *
 * Every one of them is arithmetic on geometry, so every one of them is pinned
 * here rather than judged from a screenshot. The dials are pinned too: each
 * must be exactly inert at 0, because that is what makes the before/after a
 * drag rather than a rebuild.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  speedGain, speedStretch, SPEED_GAIN_REF, SPEED_GAIN_FLOOR, SPEED_GAIN_PEAK,
} from "@/lib/rendering/ballTell";
import {
  toneMapLights, exposureKnee, EXPOSURE_KNEE, EXPOSURE_CEIL, type ExposureLight,
} from "@/lib/rendering/sleek/exposure";
import {
  ballLight, shadowQuad, BASE_INTENSITY, PENUMBRA_ALPHA,
} from "@/lib/rendering/sleek/ballLight";
import {
  collectFaceLights, FACE_SPAN_REACH, MAX_FACES_PER_LIGHT,
} from "@/lib/rendering/sleek/faceLight";
import { BallLightPass } from "@/lib/rendering/sleek/ballLightPass";
import { FaceLightLayer } from "@/lib/rendering/sleek/faceLightLayer";
import { setLightLook, resetLightLookCache } from "@/lib/lightLook";
import { setBallLook, resetBallLookCache } from "@/lib/ballLook";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { MoteLight } from "@/lib/rendering/motes";
import type { Pt } from "@/lib/rendering/sleek/pixelGrid";

const AT: Pt = { x: 400, y: 300 };
const R = 18;
const WHITE = 0xffffff;
const w2s = (x: number, y: number) => ({ x, y });

beforeEach(() => {
  localStorage.clear();
  resetLightLookCache();
  resetBallLookCache();
  // The flicker is a hashed function of the clock and would make every alpha
  // in here a moving target; it has its own tests in ballWeb.test.ts.
  setBallLook({ flicker: false });
});

function ball(over: Partial<Ball> = {}): Ball {
  return {
    id: "red-0",
    position: { x: 400, y: 300 },
    velocity: { x: 0, y: 0 },
    speed: 0,
    radius: R,
    color: "#ff5b5b",
    state: "active",
    ...over,
  } as unknown as Ball;
}

function wall(over: Record<string, unknown> = {}) {
  return {
    id: "fence-1",
    start: { x: 300, y: 400 },
    end: { x: 500, y: 400 },
    thickness: 6,
    ...over,
  };
}

function game(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    balls: [], walls: [], activePlaySeconds: 1, activeWalls: [],
    ...over,
  } as unknown as CanvasGameState;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emitters(pass: BallLightPass): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (pass as unknown as any).emitters;
}

// ── 1. Energy ────────────────────────────────────────────────────────────────

describe("speed drives how hard a ball burns", () => {
  it("is exactly inert with the dial down", () => {
    for (const sp of [0, 100, SPEED_GAIN_REF, 10_000]) {
      expect(speedGain(sp, 0)).toBe(1);
    }
  });

  it("dims a ball at a standstill and lifts one at speed", () => {
    expect(speedGain(0, 1)).toBeCloseTo(SPEED_GAIN_FLOOR, 6);
    expect(speedGain(SPEED_GAIN_REF, 1)).toBeCloseTo(SPEED_GAIN_PEAK, 6);
    expect(speedGain(SPEED_GAIN_REF / 2, 1))
      .toBeCloseTo((SPEED_GAIN_FLOOR + SPEED_GAIN_PEAK) / 2, 6);
  });

  it("never runs away past the reference", () => {
    // A slingshot release and a boss ramp both go well past it, and a light
    // that kept climbing would be a second brightness channel rather than a
    // colouring of the one that exists.
    expect(speedGain(SPEED_GAIN_REF * 12, 1)).toBeCloseTo(SPEED_GAIN_PEAK, 6);
  });

  it("stays inside the falloff's own span, which is the read it must not eat", () => {
    // Proximity is read from the gradient INSIDE one pool. The end-to-end
    // swing here has to stay well under that, or a dim near ball and a bright
    // far one start looking alike - which is the objection speedStretch was
    // written against, and the reason this is a colouring and not a channel.
    const swing = speedGain(SPEED_GAIN_REF, 1) / speedGain(0, 1);
    expect(swing).toBeLessThan(2);
    expect(swing).toBeGreaterThan(1.3);
  });

  it("is a separate thing from the stretch, which is shape and not output", () => {
    const st = speedStretch(SPEED_GAIN_REF, 1);
    expect(st.along).toBeGreaterThan(1);
    expect(st.across).toBeLessThan(1);
    // Near enough volume-preserving: the stretch alone must not brighten.
    expect(st.along * st.across).toBeCloseTo(1, 6);
  });

  it("reaches the pass, so a moving ball outshines a parked one", () => {
    setLightLook({ exposure: 0, energy: 1, tell: 0, caustic: 0, reflected: 0, reaction: 0 });
    const alpha = (speed: number) => {
      const pass = new BallLightPass();
      pass.build(game({ balls: [ball({ velocity: { x: speed, y: 0 } })] }), w2s, 1, 5000);
      return emitters(pass)[0].glow.alpha as number;
    };
    expect(alpha(SPEED_GAIN_REF)).toBeGreaterThan(alpha(0) * 1.4);
  });
});

// ── 2. Exposure ──────────────────────────────────────────────────────────────

describe("local exposure", () => {
  const lone: ExposureLight = { x: 0, y: 0, reach: 100, intensity: BASE_INTENSITY };

  it("leaves a single ball alone, to the last decimal", () => {
    // The whole design rests on this. A mechanism that quietly took a few per
    // cent off the ordinary case would be a global dimmer with extra steps,
    // and the honest version of that is simply lowering BASE_INTENSITY.
    expect(toneMapLights([lone], 1)).toEqual([1]);
    expect(BASE_INTENSITY).toBeLessThan(EXPOSURE_KNEE);
  });

  it("is exactly inert with the dial down", () => {
    const crowd = [lone, { ...lone, x: 10 }, { ...lone, x: 20 }, { ...lone, y: 10 }];
    expect(toneMapLights(crowd, 0)).toEqual([1, 1, 1, 1]);
  });

  it("rolls a crowd off, and harder the bigger it is", () => {
    const at = (n: number) => {
      const crowd: ExposureLight[] = [];
      for (let i = 0; i < n; i++) crowd.push({ ...lone, x: i * 6 });
      return toneMapLights(crowd, 1)[0];
    };
    expect(at(2)).toBeLessThan(1);
    expect(at(4)).toBeLessThan(at(2));
    expect(at(8)).toBeLessThan(at(4));
    // But never to nothing: a crowd is still brighter than one ball.
    expect(at(8) * 8 * BASE_INTENSITY).toBeGreaterThan(BASE_INTENSITY);
  });

  it("does not depend on the order the balls happen to sit in", () => {
    // The reason the pass measures the whole frame before drawing any of it.
    // Done incrementally the first ball would never dim and the last would be
    // crushed, and a player would see it the moment one overtook another.
    const crowd = [lone, { ...lone, x: 30 }, { ...lone, x: 60, intensity: 0.4 }];
    const forward = toneMapLights(crowd, 1, []);
    const back = toneMapLights([...crowd].reverse(), 1, []);
    expect(forward[0]).toBeCloseTo(back[2], 9);
    expect(forward[2]).toBeCloseTo(back[0], 9);
  });

  it("ignores a light a pool away, which is most of the board", () => {
    const far: ExposureLight = { ...lone, x: 400 };
    expect(toneMapLights([lone, far], 1)).toEqual([1, 1]);
  });

  it("has no corner at the knee, so drifting into a crowd does not step", () => {
    const below = exposureKnee(EXPOSURE_KNEE - 1e-4);
    const above = exposureKnee(EXPOSURE_KNEE + 1e-4);
    expect(below).toBeCloseTo(EXPOSURE_KNEE - 1e-4, 9);
    // Value continuous...
    expect(above - below).toBeLessThan(3e-4);
    // ...and slope continuous: both sides are moving at about 1.
    expect((above - below) / 2e-4).toBeCloseTo(1, 2);
  });

  it("approaches a ceiling above 1, because a crowd should be brighter", () => {
    expect(exposureKnee(50)).toBeLessThanOrEqual(EXPOSURE_CEIL);
    expect(exposureKnee(50)).toBeGreaterThan(EXPOSURE_CEIL - 0.01);
    expect(exposureKnee(3)).toBeLessThan(EXPOSURE_CEIL);
    expect(EXPOSURE_CEIL).toBeGreaterThan(1);
  });

  it("reaches the pass, so four balls in a corner do not sum unchecked", () => {
    setLightLook({ energy: 0, tell: 0, caustic: 0, reflected: 0, reaction: 0, ballShadows: 0 });
    const sum = (exposure: number) => {
      setLightLook({ exposure });
      const balls = [0, 1, 2, 3].map(i => ball({
        id: `b-${i}`, position: { x: 400 + i * 8, y: 300 },
      }));
      const pass = new BallLightPass();
      pass.build(game({ balls }), w2s, 1, 5000);
      return emitters(pass).slice(0, 4)
        .reduce((t: number, e) => t + (e.glow.alpha as number), 0);
    };
    expect(sum(1)).toBeLessThan(sum(0) * 0.8);
  });
});

// ── 3a. Soft shadows ─────────────────────────────────────────────────────────

describe("a ball is an area source, so its shadow has a penumbra", () => {
  const light = () => ballLight(ball(), AT, R, WHITE)!;

  it("carries its own radius, and nothing else does", () => {
    expect(light().source).toBe(R);
  });

  it("is exactly the old hard shadow at spread 0", () => {
    const l = light();
    const hard = shadowQuad(l, 300, 360, 500, 360);
    const same = shadowQuad(l, 300, 360, 500, 360, 0);
    expect(same).toEqual(hard);
  });

  it("widens the far end and leaves the contact edge sharp", () => {
    const l = light();
    const hard = shadowQuad(l, 300, 360, 500, 360)!;
    const soft = shadowQuad(l, 300, 360, 500, 360, R)!;
    // Corners 0 and 3 are ON the wall: a contact shadow is sharp where the
    // occluder meets the floor whatever the source's size.
    expect(soft[0]).toEqual(hard[0]);
    expect(soft[3]).toEqual(hard[3]);
    // Corners 1 and 2 are the far ones, and they have moved APART.
    const far = (q: Pt[]) => Math.hypot(q[1].x - q[2].x, q[1].y - q[2].y);
    expect(far(soft)).toBeGreaterThan(far(hard));
  });

  it("is nothing at the wall and grows the further out the shadow falls", () => {
    // The contact-shadow read. The fringe is the gap between the two quads,
    // and it opens linearly from zero at the occluder, so a shadow is sharp
    // where the wall stands and soft where it lands.
    const l = light();
    const hard = shadowQuad(l, 300, 360, 500, 360)!;
    const soft = shadowQuad(l, 300, 360, 500, 360, R)!;
    // Corner 1 is A's far corner in both; the gap between them at fraction t
    // of the way out from A is t of the gap at the end.
    const gapAt = (t: number) => {
      const h = { x: hard[0].x + (hard[1].x - hard[0].x) * t, y: hard[0].y + (hard[1].y - hard[0].y) * t };
      const sq = { x: soft[0].x + (soft[1].x - soft[0].x) * t, y: soft[0].y + (soft[1].y - soft[0].y) * t };
      return Math.hypot(sq.x - h.x, sq.y - h.y);
    };
    expect(gapAt(0)).toBeCloseTo(0, 6);
    expect(gapAt(0.5)).toBeGreaterThan(gapAt(0.25));
    expect(gapAt(1)).toBeGreaterThan(gapAt(0.5));
  });

  it("flares harder off a wall the ball is close to, which is what a lamp does", () => {
    // The part that reads backwards until you look at a real one: a light
    // almost touching an object throws an enormous soft shadow, and the same
    // object at arm's length throws a tight one. The source subtends
    // radius-over-distance at the occluder, and that angle is what opens the
    // quad, so this falls out of the geometry rather than being tuned in.
    const l = light();
    const flare = (wallY: number) => {
      const w = (q: Pt[]) => Math.hypot(q[1].x - q[2].x, q[1].y - q[2].y);
      const hard = shadowQuad(l, 300, wallY, 500, wallY)!;
      const soft = shadowQuad(l, 300, wallY, 500, wallY, R)!;
      // As a FRACTION, so the comparison is not just "the far quad is bigger".
      return (w(soft) - w(hard)) / w(hard);
    };
    expect(flare(AT.y + 24)).toBeGreaterThan(flare(AT.y + 80));
  });

  it("is a fringe and not a second shadow", () => {
    expect(PENUMBRA_ALPHA).toBeGreaterThan(0);
    expect(PENUMBRA_ALPHA).toBeLessThan(0.5);
  });

  it("reaches the pass, and the dial takes it away again", () => {
    setLightLook({ tell: 0, caustic: 0, reflected: 0, reaction: 0, ballShadows: 0, exposure: 0 });
    const shapes = (softShadows: number) => {
      setLightLook({ softShadows });
      const pass = new BallLightPass();
      // Inside the pool: a wall at y=400 is 100 away and the reach is 97.2.
      pass.build(game({ balls: [ball()], walls: [wall({ start: { x: 300, y: 360 }, end: { x: 500, y: 360 } })] }), w2s, 1, 5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = emitters(pass)[0].shade as any;
      return g.context.instructions.filter((i: { action: string }) => i.action === "fill").length;
    };
    // Hard: one batched fill. Soft: the fringe first, then the umbra over it.
    expect(shapes(0)).toBe(1);
    expect(shapes(1)).toBe(2);
  });
});

// ── 3b. Directional shading ──────────────────────────────────────────────────

describe("a wall's face answers the light in front of it", () => {
  const lit = (x: number, y: number, over: Record<string, unknown> = {}): MoteLight => ({
    x, y, reach: R * 5.4, intensity: BASE_INTENSITY, color: WHITE, ...over,
  });

  it("lights the side the light is on, and not the other", () => {
    const above = collectFaceLights(game({ walls: [wall()] }), [lit(400, 340)]);
    const below = collectFaceLights(game({ walls: [wall()] }), [lit(400, 460)]);
    expect(above).toHaveLength(1);
    expect(below).toHaveLength(1);
    // The wall runs east-west at y=400. A light above it lights the north
    // face, one below the south: the normals are opposite.
    expect(above[0].ny).toBeCloseTo(-1, 6);
    expect(below[0].ny).toBeCloseTo(1, 6);
  });

  it("falls away as the light slides off the end of the wall", () => {
    // The facing term, and the whole point of the feature: a wall square in
    // front of a ball is lit, the same wall seen end-on is an edge.
    const square = collectFaceLights(game({ walls: [wall()] }), [lit(400, 360)]);
    const endOn = collectFaceLights(game({ walls: [wall()] }), [lit(560, 400)]);
    expect(square[0].strength).toBeGreaterThan(0);
    // Off the end the light direction lies along the wall, so the facing term
    // goes to zero and the face drops out entirely.
    expect(endOn).toHaveLength(0);
  });

  it("dims with distance on the same squared falloff the pools have", () => {
    const at = (gap: number) =>
      collectFaceLights(game({ walls: [wall()] }), [lit(400, 400 - gap)])[0]?.strength ?? 0;
    expect(at(20)).toBeGreaterThan(at(50));
    expect(at(50)).toBeGreaterThan(at(90));
    expect(at(400)).toBe(0);
  });

  it("scales with the light that justifies it, so the two never drift apart", () => {
    const half = collectFaceLights(
      game({ walls: [wall()] }), [lit(400, 360, { intensity: BASE_INTENSITY / 2 })],
    );
    const full = collectFaceLights(game({ walls: [wall()] }), [lit(400, 360)]);
    expect(half[0].strength).toBeCloseTo(full[0].strength / 2, 6);
  });

  it("puts the band on the face rather than the centreline", () => {
    const [f] = collectFaceLights(game({ walls: [wall({ thickness: 14 })] }), [lit(400, 360)]);
    expect(f.faceOffset).toBe(7);
    expect(f.span).toBeCloseTo(R * 5.4 * FACE_SPAN_REACH, 6);
  });

  it("skips a portal, which is a hole and not a surface", () => {
    expect(collectFaceLights(
      game({ walls: [wall({ portal: true })] }), [lit(400, 360)],
    )).toHaveLength(0);
  });

  it("skips the board's own frame, which is drawn outside this layer's mask", () => {
    expect(collectFaceLights(
      game({ walls: [wall({ id: "board-north" })] }), [lit(400, 360)],
    )).toHaveLength(0);
    expect(collectFaceLights(
      game({ walls: [wall({ id: "fence-1", isBoardEdge: true })] }), [lit(400, 360)],
    )).toHaveLength(0);
  });

  it("cannot turn a fence tangle into hundreds of sprites", () => {
    const walls = [];
    for (let i = 0; i < MAX_FACES_PER_LIGHT * 4; i++) {
      walls.push(wall({ id: `fence-${i}`, start: { x: 300, y: 360 + i }, end: { x: 500, y: 360 + i } }));
    }
    const out = collectFaceLights(game({ walls }), [lit(400, 300)]);
    expect(out.length).toBeLessThanOrEqual(MAX_FACES_PER_LIGHT);
  });

  it("ignores a light that has gone out", () => {
    expect(collectFaceLights(
      game({ walls: [wall()] }), [lit(400, 360, { intensity: 0 })],
    )).toHaveLength(0);
  });
});

describe("the face-light layer puts the band where the model says", () => {
  const lit = (x: number, y: number): MoteLight =>
    ({ x, y, reach: R * 5.4, intensity: BASE_INTENSITY, color: WHITE });

  it("turns the sprite so its +y runs INTO the wall, away from the light", () => {
    const layer = new FaceLightLayer();
    layer.sync(game({ walls: [wall()] }), [lit(400, 360)], w2s, 1);
    const band = layer.container.children[0];
    expect(band.visible).toBe(true);
    // Pixi's local +y in world is (-sin r, cos r). The light is ABOVE the wall
    // (smaller y), so the lit normal is (0,-1) and local +y must be (0, +1):
    // straight down into the wall's body. That is rotation 0.
    expect(Math.sin(band.rotation)).toBeCloseTo(0, 6);
    expect(Math.cos(band.rotation)).toBeCloseTo(1, 6);
    // And it sits on the FACE, half a thickness off the centreline.
    expect(band.position.y).toBeCloseTo(400 - 3, 6);
    layer.destroy();
  });

  it("flips to the other face when the light crosses the wall", () => {
    const layer = new FaceLightLayer();
    layer.sync(game({ walls: [wall()] }), [lit(400, 440)], w2s, 1);
    const band = layer.container.children[0];
    expect(Math.cos(band.rotation)).toBeCloseTo(-1, 6);
    expect(band.position.y).toBeCloseTo(400 + 3, 6);
    layer.destroy();
  });

  it("adds, because two lamps on one face sum rather than replace", () => {
    const layer = new FaceLightLayer();
    expect(layer.container.blendMode).toBe("add");
    layer.destroy();
  });

  it("draws nothing at all with the dial down", () => {
    setLightLook({ facing: 0 });
    const layer = new FaceLightLayer();
    layer.sync(game({ walls: [wall()] }), [lit(400, 360)], w2s, 1);
    expect(layer.container.children.every(c => !c.visible)).toBe(true);
    layer.destroy();
  });

  it("hides the sprites it is no longer using rather than leaving them lit", () => {
    const layer = new FaceLightLayer();
    layer.sync(game({ walls: [wall(), wall({ id: "fence-2", start: { x: 300, y: 370 }, end: { x: 500, y: 370 } })] }), [lit(400, 360)], w2s, 1);
    expect(layer.container.children.filter(c => c.visible)).toHaveLength(2);
    layer.sync(game({ walls: [] }), [lit(400, 360)], w2s, 1);
    expect(layer.container.children.filter(c => c.visible)).toHaveLength(0);
    layer.destroy();
  });
});
