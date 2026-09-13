/**
 * Second-hand light (derivedLight.ts): a mirror gives a pool back, a portal
 * passes it through.
 *
 * Both objects change what the board IS - a mirror changes where a ball goes
 * next, a portal changes what is adjacent to what - and until now neither
 * announced itself before a ball arrived. These are the two cues that do.
 *
 * The thing most worth pinning is where a mirror's light is PUT. On the
 * mirror's own centreline, not behind it: a virtual image behind the glass
 * would be shadowed by its own mirror, which blacks out the room it is
 * supposed to be lighting, and the fix for that is an aperture cone this does
 * not need. shadowQuad already declines to cast from a wall a light sits on.
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
  it("puts it on the mirror's own centreline, at the nearest point", () => {
    const [d] = derivedLights(ball(), state({ walls: [mirror()] }));
    expect(d.kind).toBe("mirror");
    expect(d.x).toBeCloseTo(400, 6);
    expect(d.y).toBeCloseTo(340, 6);  // ON the line, not reflected to y = 380
  });

  it("is not blacked out by its own mirror", () => {
    // The whole reason it sits on the line. A light anywhere else needs an
    // aperture cone through the mirror's ends or the mirror shadows the room.
    const [d] = derivedLights(ball(), state({ walls: [mirror()] }));
    const light = ballLight(ball(), { x: d.x, y: d.y }, R, 0xffffff)!;
    const m = mirror();
    expect(shadowQuad(light, m.start.x, m.start.y, m.end.x, m.end.y)).toBeNull();
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
