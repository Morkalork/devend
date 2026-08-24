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
import { readFileSync } from "node:fs";
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
 * The whole class, not just this one call. An `arc()` anywhere in the Pixi
 * renderer that does not open its own subpath will draw a line to itself from
 * whatever was drawn before it.
 */
describe("no arc in the renderer joins itself to the last thing drawn", () => {
  const SLEEK = ["ballLayer", "fxLayer", "wallLayer", "objectLayer", "entityLayer", "boardLayer"];

  it.each(SLEEK)("%s opens a subpath before every arc", (file) => {
    let src: string;
    try {
      src = readFileSync(resolve(__dirname, `../lib/rendering/sleek/${file}.ts`), "utf8");
    } catch {
      return; // a layer that does not exist is not a failure of this rule
    }
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Pixi arcs only: a Canvas2D `ctx.arc` has beginPath to manage instead.
      if (!/^\s*\.arc\(/.test(lines[i])) continue;
      const before = lines.slice(Math.max(0, i - 3), i).join("\n");
      expect(before, `${file}:${i + 1} arcs without opening a subpath first`)
        .toMatch(/\.moveTo\(/);
    }
  });

  it("is actually finding the arc it is meant to guard", () => {
    const ball = readFileSync(
      resolve(__dirname, "../lib/rendering/sleek/ballLayer.ts"), "utf8");
    expect(ball, "the compass ring arc should still be here").toMatch(/^\s*\.arc\(/m);
    expect(ball).toMatch(/\.moveTo\(ring\.start\.x, ring\.start\.y\)/);
  });
});
