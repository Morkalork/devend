/**
 * Three pieces of motion the board was not showing.
 *
 *   BALL TRAILS   a ball is ~18 world units across moving at 250 a second, so
 *                 at 60fps it jumps four units a frame with nothing joining
 *                 them. Its direction is the single most useful fact on the
 *                 board and a still frame carried none of it.
 *   LOCK IMPACT   sealing a ball is the whole economy, and an ordinary lock
 *                 announced itself with a tint that fades and a puff of dust -
 *                 the same weight the game gives a wall bounce. Only SUPERIOR
 *                 locks got rings, so the payoff landed most often landed
 *                 softest.
 *   FENCE HEAD    the tip is the answer to "do I make it" while a cut runs, and
 *                 it was a flat dot dimmer than the ball racing it.
 *
 * The arithmetic is split out of the drawing for these the same way it is for
 * compassRing and gravityCue, and for the same reason: a curve that is subtly
 * wrong is invisible in review and obvious in play.
 */
import { describe, it, expect } from "vitest";
import { Container, Graphics } from "pixi.js";
import {
  ballTrail, SHUTTER_SECONDS, MIN_TRAIL_FRACTION, MAX_TRAIL_RADII,
} from "@/lib/rendering/sleek/ballTrail";
import { lockImpact, IMPACT_FRACTION } from "@/lib/rendering/sleek/lockImpact";
import { WallLayer } from "@/lib/rendering/sleek/wallLayer";
import { lightScope } from "@/lib/rendering/sleek/light";
import type { Ball } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";

const CENTRE = { x: 400, y: 300 };
const RADIUS = 18;

function ball(over: Partial<Ball> = {}): Ball {
  return {
    id: "red-0",
    position: { x: 400, y: 300 },
    velocity: { x: 250, y: 0 },
    speed: 250,
    radius: 18,
    color: "#ff5b5b",
    state: "active",
    ...over,
  } as unknown as Ball;
}

describe("a ball's motion smear", () => {
  it("is the distance the ball really travels in the shutter", () => {
    // A measurement, not a taste: that is what makes a faster ball longer for a
    // reason rather than because someone picked a number.
    const t = ballTrail(ball({ velocity: { x: 250, y: 0 } }), CENTRE, RADIUS, 1, 0)!;
    expect(t).toBeTruthy();
    const length = Math.hypot(t.to.x - t.from.x, t.to.y - t.from.y);
    expect(length).toBeCloseTo(250 * SHUTTER_SECONDS, 5);
  });

  it("runs BEHIND the ball, never ahead of it", () => {
    const t = ballTrail(ball({ velocity: { x: 0, y: 300 } }), CENTRE, RADIUS, 1, 0)!;
    expect(t.to).toEqual(CENTRE);
    expect(t.from.y, "the smear is drawn in front of the ball").toBeLessThan(CENTRE.y);
    expect(t.from.x).toBeCloseTo(CENTRE.x, 5);
  });

  it("grows with speed, and is capped so it never becomes a streak", () => {
    const slow = ballTrail(ball({ velocity: { x: 200, y: 0 } }), CENTRE, RADIUS, 1, 0)!;
    const fast = ballTrail(ball({ velocity: { x: 400, y: 0 } }), CENTRE, RADIUS, 1, 0)!;
    const len = (t: NonNullable<ReturnType<typeof ballTrail>>) =>
      Math.hypot(t.to.x - t.from.x, t.to.y - t.from.y);
    expect(len(fast)).toBeGreaterThan(len(slow));

    const absurd = ballTrail(ball({ velocity: { x: 100000, y: 0 } }), CENTRE, RADIUS, 1, 0)!;
    expect(len(absurd)).toBeLessThanOrEqual(RADIUS * MAX_TRAIL_RADII + 1e-6);
  });

  it("fades in rather than popping into existence", () => {
    const slow = ballTrail(ball({ velocity: { x: 200, y: 0 } }), CENTRE, RADIUS, 1, 0)!;
    const fast = ballTrail(ball({ velocity: { x: 500, y: 0 } }), CENTRE, RADIUS, 1, 0)!;
    expect(fast.alpha).toBeGreaterThan(slow.alpha);
    expect(slow.alpha).toBeGreaterThan(0);
    expect(fast.alpha).toBeLessThan(0.5);
  });

  it("gives a slow ball none, because a slow ball is legible already", () => {
    // Below the floor the smear is shorter than the antialiasing on the ball's
    // own edge, so it reads as a smudge rather than as motion.
    const belowFloor = (RADIUS * MIN_TRAIL_FRACTION) / SHUTTER_SECONDS - 1;
    expect(ballTrail(ball({ velocity: { x: belowFloor, y: 0 } }), CENTRE, RADIUS, 1, 0)).toBeNull();
  });

  it("gives none to a ball that is not moving under its own power", () => {
    expect(ballTrail(ball({ velocity: { x: 0, y: 0 } }), CENTRE, RADIUS, 1, 0)).toBeNull();
    expect(ballTrail(ball({ state: "dormant" as never }), CENTRE, RADIUS, 1, 0)).toBeNull();
    expect(ballTrail(ball({ state: "won" as never }), CENTRE, RADIUS, 1, 0)).toBeNull();
  });

  it("gives none to a frozen ball, which is being HELD still", () => {
    // A tap-freeze keeps the ball's velocity so it resumes correctly. A trail
    // on it would be a lie about the thing the player just paid to stop.
    const held = ball({ frozenUntil: 5000 } as Partial<Ball>);
    expect(ballTrail(held, CENTRE, RADIUS, 1, 4000), 'trailed a frozen ball').toBeNull();
    expect(ballTrail(held, CENTRE, RADIUS, 1, 6000), 'still refusing after the thaw').toBeTruthy();
  });

  it("survives a broken velocity without drawing nonsense", () => {
    expect(ballTrail(ball({ velocity: { x: NaN, y: 0 } }), CENTRE, RADIUS, 1, 0)).toBeNull();
    expect(ballTrail(ball({ velocity: undefined as never }), CENTRE, RADIUS, 1, 0)).toBeNull();
  });

  it("scales with the board, so it is the same size on any screen", () => {
    const small = ballTrail(ball(), CENTRE, RADIUS, 0.5, 0)!;
    const big = ballTrail(ball(), CENTRE, RADIUS * 2, 1, 0)!;
    const len = (t: NonNullable<ReturnType<typeof ballTrail>>) =>
      Math.hypot(t.to.x - t.from.x, t.to.y - t.from.y);
    expect(len(big)).toBeCloseTo(len(small) * 2, 5);
  });
});

describe("the thump when a lock lands", () => {
  it("is over well before the flash is", () => {
    // A hit, not a glow: the ring completes early and leaves the pocket tint to
    // drain on its own.
    expect(lockImpact(IMPACT_FRACTION - 0.01, 1)).toBeTruthy();
    expect(lockImpact(IMPACT_FRACTION + 0.01, 1)).toBeNull();
    expect(lockImpact(0.99, 1)).toBeNull();
  });

  it("expands and fades, never the other way round", () => {
    let lastR = -1, lastA = Infinity;
    for (let t = 0; t < IMPACT_FRACTION; t += IMPACT_FRACTION / 20) {
      const i = lockImpact(t, 1)!;
      expect(i.ringRadius, `radius shrank at t=${t.toFixed(2)}`).toBeGreaterThanOrEqual(lastR);
      expect(i.ringAlpha, `alpha rose at t=${t.toFixed(2)}`).toBeLessThanOrEqual(lastA + 1e-9);
      lastR = i.ringRadius;
      lastA = i.ringAlpha;
    }
  });

  it("decelerates, so it reads as something struck", () => {
    // A ring expanding at a constant rate reads as a circle being drawn.
    const early = lockImpact(IMPACT_FRACTION * 0.1, 1)!.ringRadius;
    const mid = lockImpact(IMPACT_FRACTION * 0.5, 1)!.ringRadius;
    const late = lockImpact(IMPACT_FRACTION * 0.9, 1)!.ringRadius;
    expect(mid - early, "the first half moved less than the second").toBeGreaterThan(late - mid);
  });

  it("snaps a core at the catch point and drops it early", () => {
    expect(lockImpact(0.001, 1)!.coreAlpha).toBeGreaterThan(0.5);
    // Gone before the ring has finished travelling.
    expect(lockImpact(IMPACT_FRACTION * 0.5, 1)!.coreAlpha).toBe(0);
  });

  it("is the same size on the board whatever the screen", () => {
    const at1 = lockImpact(0.2, 1)!;
    const at2 = lockImpact(0.2, 2)!;
    expect(at2.ringRadius).toBeCloseTo(at1.ringRadius * 2, 5);
  });

  it("refuses a negative clock rather than drawing backwards", () => {
    expect(lockImpact(-0.1, 1)).toBeNull();
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function graphicsIn(node: Container, found: Graphics[] = []): Graphics[] {
  if (node instanceof Graphics) found.push(node);
  for (const child of node.children ?? []) graphicsIn(child as Container, found);
  return found;
}
function pathPoints(node: Container): number[] {
  const out: number[] = [];
  for (const g of graphicsIn(node)) {
    const paths: any[] = [];
    for (const ins of (g as any).context?.instructions ?? []) {
      if (ins.data?.path) paths.push(ins.data.path);
    }
    if ((g as any).context?._activePath) paths.push((g as any).context._activePath);
    for (const path of paths) {
      for (const prim of path.shapePath?.shapePrimitives ?? []) {
        for (const v of ((prim.shape as any).points ?? []) as number[]) out.push(v);
      }
    }
  }
  return out;
}
/**
 * How many CIRCLES a subtree drew.
 *
 * The head is the only thing in this layer made of circles - the fence legs
 * and its hot trail are all strokes - so this isolates it. Counting every
 * operation does not: the legs change with the tip's position too, so a
 * mutation that removed the head entirely still moved that number, and the
 * first version of this test passed with the head deleted.
 */
function circleCount(node: Container): number {
  let n = 0;
  for (const g of graphicsIn(node)) {
    const paths: any[] = [];
    for (const ins of (g as any).context?.instructions ?? []) {
      if (ins.data?.path) paths.push(ins.data.path);
    }
    for (const path of paths) {
      for (const prim of path.shapePath?.shapePrimitives ?? []) {
        if ((prim.shape as any)?.type === 'circle') n++;
      }
    }
  }
  return n;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("the growing fence head", () => {
  const BOARD = { left: 100, top: 200, width: 800, height: 800, scale: 1 };
  const w2s = (x: number, y: number) => ({ x: BOARD.left + x, y: BOARD.top + y });

  function growing(tipAt: { x: number; y: number }) {
    return {
      boardRect: { ...BOARD },
      walls: [],
      obstaclePolygons: [],
      phasingObjects: [],
      wallImpacts: [],
      boardPolygon: null,
      activeWalls: [{
        origin: { x: 300, y: 400 },
        direction: { x: 0, y: 1 },
        startWaypoints: [{ x: 300, y: 400 }, { x: 300, y: 100 }],
        endWaypoints: [{ x: 300, y: 400 }, { x: 300, y: 700 }],
        startSegmentIndex: 0,
        endSegmentIndex: 0,
        startPoint: { x: 300, y: 400 },
        endPoint: tipAt,
        targetStart: { x: 300, y: 100 },
        targetEnd: { x: 300, y: 700 },
        thickness: 6,
        isComplete: false,
        activeRegionId: "r0",
        startTime: 0,
      }],
    } as unknown as CanvasGameState;
  }

  function drawnFor(tipAt: { x: number; y: number }) {
    const layer = new WallLayer();
    layer.sync(growing(tipAt), lightScope(BOARD, 0), new Graphics(), w2s, 1);
    return layer;
  }

  it("draws a head once the tip has actually moved", () => {
    const grown = circleCount(drawnFor({ x: 300, y: 520 }).container);
    expect(grown, "the head is not drawn at all").toBeGreaterThan(0);
  });

  it("draws no head on a cut that has not grown yet", () => {
    // A cut that has only just been armed has no direction, and a head drawn
    // there would put a bright dot on the board before anything had grown.
    const unmoved = circleCount(drawnFor({ x: 300, y: 400 }).container);
    expect(unmoved, "a head appeared before the fence moved").toBe(0);
  });

  it("gives the head a halo, not just a dot", () => {
    // Two soft passes under the core, plus the leading spark. A flat dot is
    // what it was, and it was dimmer than the ball racing it.
    const grown = circleCount(drawnFor({ x: 300, y: 520 }).container);
    expect(grown, "the head is a bare dot again").toBeGreaterThanOrEqual(4);
  });

  it("never opens a path at the canvas origin", () => {
    // The head's trail is a moveTo/lineTo run, and one that forgets to open its
    // own subpath draws a beam from (0,0) across the board. That has happened
    // in this renderer before.
    const pts = pathPoints(drawnFor({ x: 300, y: 520 }).container);
    expect(pts.length, "no path geometry to check").toBeGreaterThan(0);
    for (let i = 0; i + 1 < pts.length; i += 2) {
      expect(
        Math.hypot(pts[i], pts[i + 1]) > 0.5,
        `a path point sits on the origin; the board starts at (${BOARD.left},${BOARD.top})`,
      ).toBe(true);
    }
  });
});
