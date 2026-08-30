/**
 * The beam coming out of the compass ball.
 *
 * Reported as "strange beams coming from balls, the purple one in this case,
 * and it sometimes turns red". Both halves of that were the same bug.
 *
 * Pixi's `arc()` CONTINUES the current path, exactly as the Canvas2D API it
 * mirrors does: it draws a straight line from wherever the path last was to the
 * arc's first point. The compass countdown ring was the only `arc()` in the
 * renderer - every other round thing uses `circle()`, which opens its own
 * subpath - so it was the only call that could do this. The line was stroked
 * with the ring, in the ring's colour, and turned red exactly when the ring
 * did: in the last fifth of the cycle, when the turn is imminent.
 *
 * The geometry is a pure function now, and it returns the arc's starting point
 * so the caller cannot forget to open a subpath on it. That is the real fix:
 * the shape of the function makes the bug hard to write again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { compassRing, URGENT_FROM } from "@/lib/rendering/sleek/compassRing";
import { DEFAULT_TURN_INTERVAL } from "@/lib/physics/turnTimer";
import type { Ball } from "@/types/game";

const compass = (over: Partial<Ball> = {}): Ball => ({
  ability: "turnTimer", nextTurnAt: 9, turnIntervalSeconds: 9, turnClockwise: true,
  ...over,
} as unknown as Ball);

const CX = 400, CY = 300, R = 18, SCALE = 1;
const ringAt = (seconds: number, over: Partial<Ball> = {}) =>
  compassRing(compass(over), CX, CY, R, SCALE, seconds);

describe("the arc opens its own subpath", () => {
  /**
   * The bug, as geometry: without a starting point the caller has nothing to
   * moveTo, and Pixi joins the arc to whatever it drew last.
   */
  it("reports where the arc begins", () => {
    const ring = ringAt(0)!;
    expect(ring.start).toBeTruthy();
    expect(Number.isFinite(ring.start.x) && Number.isFinite(ring.start.y)).toBe(true);
  });

  it("puts that point exactly on the ring", () => {
    for (const t of [0, 2, 4, 6, 8]) {
      const ring = ringAt(t);
      if (!ring) continue;
      const d = Math.hypot(ring.start.x - CX, ring.start.y - CY);
      expect(d, `at t=${t}`).toBeCloseTo(ring.radius, 6);
    }
  });

  /** Pixi begins at the LOW angle whichever way it then sweeps, so that is the
   *  point a fresh subpath has to open on. */
  it("puts it at the low end of the sweep, which is where Pixi starts", () => {
    for (const cw of [true, false]) {
      const ring = ringAt(1, { turnClockwise: cw })!;
      expect(ring.from).toBeLessThanOrEqual(ring.to);
      expect(ring.start.x).toBeCloseTo(CX + Math.cos(ring.from) * ring.radius, 6);
      expect(ring.start.y).toBeCloseTo(CY + Math.sin(ring.from) * ring.radius, 6);
    }
  });

  it("sits outside the ball, not on it", () => {
    expect(ringAt(0)!.radius).toBeGreaterThan(R);
  });
});

describe("the ring still says what it always said", () => {
  it("unwinds as the turn approaches", () => {
    const sweep = (t: number) => {
      const r = ringAt(t);
      return r ? r.to - r.from : 0;
    };
    expect(sweep(0)).toBeGreaterThan(sweep(4));
    expect(sweep(4)).toBeGreaterThan(sweep(8));
  });

  /** The direction is chosen a cycle early precisely so the ring can lean the
   *  way the ball is about to turn; that is what makes it a plan. */
  it("leans the way the ball will turn", () => {
    // Twelve o'clock is -PI/2. A clockwise turn puts the whole wedge after it,
    // a counter-clockwise one before it. That is where the lean lives: in
    // WHICH bounds these are, not in a separate direction flag.
    const cw = ringAt(1, { turnClockwise: true })!;
    const ccw = ringAt(1, { turnClockwise: false })!;
    expect(cw.from).toBeCloseTo(-Math.PI / 2);
    expect(ccw.to).toBeCloseTo(-Math.PI / 2);
    expect(cw.to).toBeGreaterThan(-Math.PI / 2);
    expect(ccw.from).toBeLessThan(-Math.PI / 2);
  });

  it("goes urgent only in the last stretch", () => {
    const interval = DEFAULT_TURN_INTERVAL;
    // progress = 1 - remaining/interval, so urgency starts at 80% elapsed.
    expect(ringAt(interval * (URGENT_FROM - 0.1))!.urgent).toBe(false);
    expect(ringAt(interval * (URGENT_FROM + 0.1))!.urgent).toBe(true);
  });

  it("says nothing for a ball that does not turn", () => {
    expect(compassRing({ ability: "none" } as Ball, CX, CY, R, SCALE, 0)).toBeNull();
    expect(ringAt(0, { nextTurnAt: undefined })).toBeNull();
  });

  it("stops drawing once there is nothing left to unwind", () => {
    // At the moment of the turn the sweep is zero; a hairline arc there would
    // flicker rather than read as anything.
    expect(ringAt(DEFAULT_TURN_INTERVAL)).toBeNull();
  });
});

/**
 * The rule is no longer "open a subpath before an arc" but "no arc at all".
 *
 * Guarding the moveTo was the previous fix, and it was correct: delete it and
 * the beam comes straight back. It was not ENOUGH, because arc() is dangerous
 * on both sides. Pixi reads a plain arc's instruction data as if it were an
 * arcToSvg when it works out where the path finished (`data[5], data[6]`, which
 * on a real arc are the counterclockwise flag and nothing at all), so a stroked
 * arc leaves a corrupt point behind for the next mark on the same Graphics to
 * start from. A moveTo in front of the arc cannot do anything about what the
 * arc leaves behind it.
 *
 * So the Pixi renderer has no arcs. A ring is flattened to points in the layer
 * that owns it and stroked as an ordinary polyline, which Pixi handles
 * correctly at both ends.
 */
describe("the pixi renderer contains no arc at all", () => {
  const SLEEK = readdirSync(resolve(__dirname, "../lib/rendering/sleek"))
    .filter(f => f.endsWith(".ts"));

  it.each(SLEEK)("%s calls no arc on a Graphics", (file) => {
    const src = readFileSync(resolve(__dirname, `../lib/rendering/sleek/${file}`), "utf8");
    for (const [i, line] of src.split("\n").entries()) {
      // Canvas2D arcs are a different API with beginPath to manage instead, and
      // they draw into their own offscreen canvas, so they are not this rule's
      // business. Only a chained `.arc(` on a Pixi Graphics is.
      if (/\bctx\.arc\(|\bc\.arc\(/.test(line)) continue;
      expect(/^\s*\.arc\(|\)\.arc\(/.test(line),
        `${file}:${i + 1} calls Pixi arc(): flatten it to points instead`).toBe(false);
    }
  });

  it("is actually reading the file the ring is drawn in", () => {
    // The mutation that made the previous version of this guard worth having:
    // a test that finds nothing passes forever. The ring has to be in here.
    const ball = readFileSync(
      resolve(__dirname, "../lib/rendering/sleek/ballLayer.ts"), "utf8");
    expect(ball, "drawTurnRing should still be here").toMatch(/drawTurnRing/);
    expect(ball, "the ring should be stroked from compassRing's points")
      .toMatch(/const pts = ring\.points/);
  });

  it("hands back points that lie on the ring and span the whole sweep", () => {
    // The polyline replaced an arc, so the thing to prove is that it IS the
    // arc: every point on the circle, first point at `from`, last at `to`.
    for (const t of [0, 2, 5, 8]) {
      const ring = ringAt(t);
      if (!ring) continue;
      expect(ring.points.length, `at t=${t}`).toBeGreaterThanOrEqual(26);
      for (let i = 0; i + 1 < ring.points.length; i += 2) {
        expect(Math.hypot(ring.points[i] - CX, ring.points[i + 1] - CY), `t=${t} pt${i / 2}`)
          .toBeCloseTo(ring.radius, 6);
      }
      const n = ring.points.length;
      expect(ring.points[0]).toBeCloseTo(CX + Math.cos(ring.from) * ring.radius, 6);
      expect(ring.points[1]).toBeCloseTo(CY + Math.sin(ring.from) * ring.radius, 6);
      expect(ring.points[n - 2]).toBeCloseTo(CX + Math.cos(ring.to) * ring.radius, 6);
      expect(ring.points[n - 1]).toBeCloseTo(CY + Math.sin(ring.to) * ring.radius, 6);
    }
  });
});

describe("a ring that cannot be computed", () => {
  it("returns null rather than a ring with no points in it", () => {
    // Found while chasing a report of a shape missing from the balls. A
    // non-finite clock makes turnProgress NaN, and NaN fails every comparison -
    // so `sweep <= 0.01` was false, the guard passed, and Math.ceil(NaN) gave a
    // NaN step count whose loop never ran. The result was a TRUTHY ring holding
    // zero points, which the layer strokes into nothing at all: the countdown
    // disappears with no error and nothing to explain it.
    
    for (const clock of [NaN, Infinity, undefined as unknown as number]) {
      const ring = compassRing(compass(), CX, CY, R, SCALE, clock);
      expect(ring, `a broken clock (${clock}) produced a ring`).toBeNull();
    }
  });

  it("never hands back a ring the caller would draw as nothing", () => {
    // The general form: whatever comes back must be strokeable. A zero-point
    // ring is the one shape that passes every truthiness check and draws
    // nothing.
    for (const t of [0, 1, 3, 5, 7, 8.5, 8.99]) {
      const ring = compassRing(compass(), CX, CY, R, SCALE, t);
      if (ring) expect(ring.points.length, `empty ring at t=${t}`).toBeGreaterThanOrEqual(4);
    }
  });
});
