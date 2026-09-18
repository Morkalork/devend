/**
 * Second-hand light (derivedLight.ts): a mirror gives a pool back, a portal
 * passes it through.
 *
 * Both objects change what the board IS - a mirror changes where a ball goes
 * next, a portal changes what is adjacent to what - and until now neither
 * announced itself before a ball arrived. These are the two cues that do.
 *
 * The thing most worth pinning is where a mirror's light is PUT, and it moved.
 * It used to sit on the mirror's own centreline, to dodge two real problems:
 * a light behind the glass is shadowed by its own mirror, and it would spill
 * out the back. Dodging them cost the effect entirely. A mirror only lights up
 * when a ball is within one pool of it, which is exactly when the ball's own
 * pool already covers the mirror, so the reflection was a dimmer copy of the
 * same coloured pool sitting inside the brighter original: invisible, and
 * reported as "I can't see any effect at all".
 *
 * So it stands at the ball's VIRTUAL IMAGE now, as far behind the face as the
 * ball is in front, and the two problems are paid for instead of avoided: the
 * pass skips the mirror's own walls as occluders (by `owner`) and fills the
 * half-plane behind `face` with shadow. Both halves are pinned here, because
 * either one alone is a worse picture than what it replaced - the exemption
 * without the clip is a window, and the clip without the exemption is a mirror
 * that blacks out the room it lights.
 */
import { describe, it, expect } from "vitest";
import {
  derivedLights, MIRROR_RETURN, PORTAL_THROUGH, PORTAL_REACH_RADII,
  MAX_DERIVED_PER_BALL,
} from "@/lib/rendering/sleek/derivedLight";
import { shadowQuad, REACH_RADII, ballLight } from "@/lib/rendering/sleek/ballLight";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { Polygon } from "@/lib/polygon";

const R = 18;

function ball(over: Partial<Ball> = {}): Ball {
  return {
    id: "b1", position: { x: 400, y: 300 }, radius: R,
    color: "#ff4d5a", state: "active", assimScale: 1,
    ...over,
  } as unknown as Ball;
}

/** A mirror running along x at y = 340, so 40 below a ball at y = 300. */
const mirror = (over = {}) => ({
  id: "m", start: { x: 200, y: 340 }, end: { x: 600, y: 340 },
  thickness: 6, isMirror: true, ...over,
});

function state(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return { balls: [ball()], walls: [], ...over } as unknown as CanvasGameState;
}

function portals(specs: { id: string; link: string; x: number; y: number }[]) {
  const m = new Map<Polygon, { id: string; link: string; centre: { x: number; y: number }; radius: number }>();
  for (const s of specs) {
    m.set({ vertices: [] } as unknown as Polygon,
      { id: s.id, link: s.link, centre: { x: s.x, y: s.y }, radius: 20 });
  }
  return m as unknown as CanvasGameState["portals"];
}

describe("a mirror gives the light back", () => {
  it("puts it at the ball's virtual image, behind the face", () => {
    // The ball is at y = 300 and the mirror runs along y = 340, so the image
    // is 40 the other side of it. Being somewhere the ball is NOT is the whole
    // point: a reflection co-located with its own source cannot be seen.
    const [d] = derivedLights(ball(), state({ walls: [mirror()] }));
    expect(d.kind).toBe("mirror");
    expect(d.x).toBeCloseTo(400, 6);
    expect(d.y).toBeCloseTo(380, 6);
  });

  it("names the mirror it came off, so the pass can stop it shadowing itself", () => {
    // Without the exemption the mirror stands between this light and the whole
    // room, and shadowQuad correctly blacks the room out - which is what makes
    // the `owner` field load-bearing rather than bookkeeping.
    const [d] = derivedLights(ball(), state({ walls: [mirror({ id: "obstacle-mirror-a-edge-0" })] }));
    expect(d.owner).toBe("obstacle-mirror-a");
    const light = ballLight(ball(), { x: d.x, y: d.y }, R, 0xffffff)!;
    const m = mirror();
    expect(shadowQuad(light, m.start.x, m.start.y, m.end.x, m.end.y),
      "the mirror does not occlude its own reflection, so nothing needs exempting")
      .not.toBeNull();
  });

  it("carries the face it bounced off, so the pass can clip to the front", () => {
    const [d] = derivedLights(ball(), state({ walls: [mirror()] }));
    expect(d.face).toEqual({ ax: 200, ay: 340, bx: 600, by: 340 });
  });

  it("reflects across the face the ball is looking at, not a far edge", () => {
    // A rect mirror is four walls. Reflecting across one of the short ends
    // would put the image somewhere the ball can never see itself.
    const near = mirror({ id: "obstacle-m-edge-0" });
    const farSide = mirror({ id: "obstacle-m-edge-2", start: { x: 200, y: 360 }, end: { x: 600, y: 360 } });
    const [d] = derivedLights(ball(), state({ walls: [near, farSide] }));
    expect(d.y).toBeCloseTo(380, 6);   // across y = 340, not across y = 360
  });

  it("gives one light per mirror, however many edges it has", () => {
    // Four edges of one rect used to mean three derived lights a few units
    // apart, which spent the per-ball budget lighting a single object and left
    // a second mirror on the map dark.
    const edges = [0, 1, 2, 3].map(i => mirror({
      id: `obstacle-m-edge-${i}`,
      start: { x: 200 + i, y: 340 }, end: { x: 600 - i, y: 340 },
    }));
    expect(derivedLights(ball(), state({ walls: edges }))).toHaveLength(1);
  });

  it("gives back less the further the ball is, and nothing past the pool", () => {
    const near = derivedLights(ball({ position: { x: 400, y: 335 } }), state({ walls: [mirror()] }));
    const far = derivedLights(ball({ position: { x: 400, y: 280 } }), state({ walls: [mirror()] }));
    expect(near[0].gain).toBeGreaterThan(far[0].gain);
    expect(near[0].gain).toBeLessThan(MIRROR_RETURN);   // never all of it
    const beyond = 340 - R * REACH_RADII - 5;
    expect(derivedLights(ball({ position: { x: 400, y: beyond } }), state({ walls: [mirror()] })))
      .toHaveLength(0);
  });

  it("ignores an ordinary wall and a mirror that is also a portal rim", () => {
    expect(derivedLights(ball(), state({ walls: [mirror({ isMirror: false })] }))).toHaveLength(0);
    expect(derivedLights(ball(), state({ walls: [mirror({ portal: {} })] }))).toHaveLength(0);
  });
});

describe("a portal passes the light through", () => {
  const pair = () => portals([
    { id: "p1", link: "a", x: 400, y: 320 },
    { id: "p2", link: "a", x: 800, y: 700 },
  ]);

  it("lights the FAR mouth as the ball nears the near one", () => {
    const [d] = derivedLights(ball(), state({ portals: pair() }));
    expect(d.kind).toBe("portal");
    expect(d.x).toBeCloseTo(800, 6);
    expect(d.y).toBeCloseTo(700, 6);
    expect(d.gain).toBeGreaterThan(0);
    expect(d.gain).toBeLessThanOrEqual(PORTAL_THROUGH);
  });

  it("brightens as the ball closes, and is dark until it is close", () => {
    const at = (y: number) => derivedLights(ball({ position: { x: 400, y } }), state({ portals: pair() }));
    expect(at(320)[0].gain).toBeGreaterThan(at(300)[0].gain);
    // Past the reach there is nothing: a portal is not a standing lamp.
    expect(at(320 - 20 - R * PORTAL_REACH_RADII - 5)).toHaveLength(0);
  });

  it("stays dark for a lone portal, which is inert", () => {
    expect(derivedLights(ball(), state({
      portals: portals([{ id: "p1", link: "a", x: 400, y: 320 }]),
    }))).toHaveLength(0);
  });

  it("walks a ring of three round to the next one", () => {
    const ring = portals([
      { id: "p1", link: "a", x: 400, y: 320 },
      { id: "p2", link: "a", x: 800, y: 700 },
      { id: "p3", link: "a", x: 100, y: 100 },
    ]);
    const out = derivedLights(ball(), state({ portals: ring }));
    // Only the mouth the ball is near contributes, and it lights the NEXT one.
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeCloseTo(800, 6);
  });
});

describe("it cannot run away with the frame", () => {
  it("caps how many one ball can throw", () => {
    const walls = Array.from({ length: 12 }, (_, i) =>
      mirror({ id: `m${i}`, start: { x: 200, y: 330 + i }, end: { x: 600, y: 330 + i } }));
    expect(derivedLights(ball(), state({ walls })).length).toBe(MAX_DERIVED_PER_BALL);
  });

  it("never derives from a derived light", () => {
    // Two mirrors facing each other are a hall of mirrors; the honest end of
    // that recursion is a frame budget, not a picture. One bounce, always.
    const out = derivedLights(ball(), state({
      walls: [mirror(), mirror({ id: "m2", start: { x: 200, y: 260 }, end: { x: 600, y: 260 } })],
    }));
    expect(out).toHaveLength(2);
    for (const d of out) expect(d.kind).toBe("mirror");
  });

  it("reuses the array it is handed", () => {
    const out: ReturnType<typeof derivedLights> = [];
    expect(derivedLights(ball(), state({ walls: [mirror()] }), out)).toBe(out);
    derivedLights(ball(), state({ walls: [] }), out);
    expect(out).toHaveLength(0);
  });
});

/**
 * Both halves of the reflection live in the render pass, and each is inert
 * without the other. A render harness for a light buffer would be a large
 * fragile thing guarding three lines, and what must not happen - one half
 * going missing - is visible in the source, which is how launcherLock and
 * gateZoneDeal pin their rules too.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("the pass honours what the mirror light carries", () => {
  const pass = readFileSync(resolve(process.cwd(), "src/lib/rendering/sleek/ballLightPass.ts"), "utf8");
  const fx = readFileSync(resolve(process.cwd(), "src/lib/rendering/sleek/fxLayer.ts"), "utf8");

  it("skips the owning mirror's walls when shadowing its reflection", () => {
    expect(pass).toContain("const exempt = derived?.owner;");
    expect(pass, "the exemption is declared but never applied")
      .toContain("if (exempt && wall.id.startsWith(exempt)) continue;");
  });

  it("clips the pool to the front of the face", () => {
    expect(pass).toContain("this.clipToFrontOfMirror(g, light, w2s, derived);");
    // The mask has to be opaque, or the back of the mirror merely dims rather
    // than going dark, and a half-lit back reads as a window with a curtain.
    const at = pass.indexOf("private clipToFrontOfMirror");
    expect(at).toBeGreaterThan(-1);
    expect(pass.slice(at, at + 2200)).toContain("alpha: 1");
  });

  it("hands the derived light to the placement that needs it", () => {
    expect(pass).toMatch(/this\.place\(this\.emitterAt\(this\.live\+\+\), dl, tex, d, game, w2s, scale, ball, d\)/);
  });

  it("draws the glint on the face, and stops when reflected light is off", () => {
    expect(fx).toContain("this.drawMirrorGlints(game, w2s, scale);");
    const at = fx.indexOf("private drawMirrorGlints");
    expect(at).toBeGreaterThan(-1);
    expect(fx.slice(at, at + 600), "the glint ignores the reflected slider")
      .toContain("look.reflected <= 0.001");
  });
});
