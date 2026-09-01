/**
 * The pop bumper: the first solid in the game that gives a ball energy.
 *
 * Every other solid is passive. The board edge, a fence, a pillar and a mirror
 * all reflect - `v - 2(v.n)n`, which preserves magnitude exactly - so a ball
 * leaves at the speed it arrived. A bouncer kicks: faster than it came in, and
 * radially outward from the bouncer's middle rather than along the reflection
 * of its approach.
 *
 * Both halves are load-bearing and both fail invisibly:
 *
 *   NO GAIN and it is a pillar with a different paint job, which is exactly
 *     what it looks like in motion. Nothing on screen says "this one should
 *     have been faster".
 *   NO CAP and it is a ball through a fence twenty seconds later, on a
 *     different part of the board, with nothing to connect it back. Nothing in
 *     the engine damps a ball, so a per-hit gain compounds for the whole map,
 *     and collision is discrete: past about 5520 units/second an 18-unit ball
 *     crosses a 6-unit fence between two steps without ever being tested
 *     against it. A 250-speed ball reaches that in about sixteen hits at 1.2x.
 *
 * So the ceiling is tested against the REAL tunnelling threshold, recomputed
 * from the live constants rather than pinned to a number, so it moves if
 * PHYSICS_STEP or the ball radius ever does.
 */
import { describe, it, expect } from "vitest";
import {
  bouncerKick, bouncerReady, BOUNCER_COOLDOWN_MS, BOUNCER_KICK,
  BOUNCER_MAX_SPEED_SCALE, type BouncerSpec,
} from "@/lib/physics/bouncer";
import { PHYSICS_STEP, BASE_BALL_RADIUS } from "@/lib/gameConstants";
import { WALL_THICKNESS } from "@/lib/wallGeometry";
import type { Ball } from "@/types/game";

const spec = (over: Partial<BouncerSpec> = {}): BouncerSpec => ({
  id: "b1", centre: { x: 0, y: 0 }, kick: BOUNCER_KICK,
  maxSpeedScale: BOUNCER_MAX_SPEED_SCALE, ...over,
});

/** A ball at `pos` moving with `vel`, base speed 250 like a red. */
const ball = (pos: { x: number; y: number }, vel: { x: number; y: number }, baseSpeed = 250): Ball => ({
  id: "ball", position: { ...pos }, velocity: { ...vel },
  speed: Math.hypot(vel.x, vel.y), baseSpeed, radius: BASE_BALL_RADIUS,
} as unknown as Ball);

const speedOf = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);

describe("a bouncer gives energy back, which no other solid does", () => {
  it("sends the ball away faster than it arrived", () => {
    const b = ball({ x: 100, y: 0 }, { x: -200, y: 0 });
    const hit = bouncerKick(b, spec());
    expect(hit.speed).toBeGreaterThan(200);
    expect(hit.speed).toBeCloseTo(200 * BOUNCER_KICK, 6);
  });

  it("is a plain wall at a kick of 1, which is what makes the gain the feature", () => {
    const b = ball({ x: 100, y: 0 }, { x: -200, y: 0 });
    expect(bouncerKick(b, spec({ kick: 1 })).speed).toBeCloseTo(200, 6);
  });

  it("fires outward from the middle, not back along the approach", () => {
    // THE thing that makes it a bumper. A ball arriving at a glancing angle
    // leaves along the radius, which is why a cluster scatters instead of
    // returning the ball down its own line.
    const b = ball({ x: 0, y: 100 }, { x: 300, y: -20 });
    const hit = bouncerKick(b, spec());
    // The ball sits BELOW a bouncer at the origin (screen coords: +y is down),
    // so outward is straight down - and emphatically not back along the +x it
    // arrived on, which is what a reflector would have given.
    expect(hit.velocity.x).toBeCloseTo(0, 6);
    expect(hit.velocity.y).toBeGreaterThan(0);
  });

  it("fires outward whatever direction the ball came from", () => {
    for (const [px, py] of [[100, 0], [-100, 0], [0, 100], [0, -100], [70, 70]]) {
      const b = ball({ x: px, y: py }, { x: -px, y: -py });
      const hit = bouncerKick(b, spec());
      // The heading must agree with the outward radius.
      const len = Math.hypot(px, py);
      const dot = (hit.velocity.x * (px / len) + hit.velocity.y * (py / len)) / speedOf(hit.velocity);
      expect(dot, `from ${px},${py}`).toBeCloseTo(1, 6);
    }
  });

  it("keeps a ball moving even when it is dead centre", () => {
    // No outward direction exists there. Returning a zero vector would strand
    // the ball inside the bumper for the rest of the map.
    const b = ball({ x: 0, y: 0 }, { x: 0, y: 180 });
    const hit = bouncerKick(b, spec());
    expect(speedOf(hit.velocity)).toBeGreaterThan(0);
  });
});

describe("the ceiling, which is the difference between a mechanic and a bug", () => {
  /**
   * The speed at which discrete collision starts to be able to miss a fence,
   * recomputed from the live constants exactly as maxSafeLaunchPower does.
   */
  const tunnelingSpeed = (2 * (BASE_BALL_RADIUS + WALL_THICKNESS / 2 + 2)) / PHYSICS_STEP;

  /** Kick a ball until its speed stops changing: where the ceiling actually is. */
  const settle = (baseSpeed: number, s = spec()) => {
    const b = ball({ x: 100, y: 0 }, { x: baseSpeed, y: 0 }, baseSpeed);
    for (let i = 0; i < 200; i++) {
      const hit = bouncerKick(b, s);
      b.velocity = hit.velocity; b.speed = hit.speed;
      b.position = { x: 100, y: 0 };
    }
    return b.speed;
  };

  it("caps at a multiple of the ball's OWN base speed", () => {
    // Driven up to the ceiling rather than started above it: a ball ALREADY
    // above its ceiling is deliberately left alone (see the redirect tests), so
    // starting there would have tested the wrong rule and passed anyway.
    expect(settle(250)).toBeCloseTo(250 * BOUNCER_MAX_SPEED_SCALE, 6);
  });

  it("gives a slow ball and a fast ball the same headroom relative to themselves", () => {
    // An absolute ceiling would be generous to a 200-speed grey and a hard stop
    // for a 340-speed purple.
    expect(settle(200) / 200).toBeCloseTo(settle(340) / 340, 6);
    expect(settle(200)).toBeLessThan(settle(340));
  });

  it("never compounds past the tunnelling threshold, however many hits", () => {
    // The actual failure mode: a gain applied per hit, for a whole map, with
    // nothing in the engine damping it.
    const b = ball({ x: 100, y: 0 }, { x: 250, y: 0 });
    for (let i = 0; i < 500; i++) {
      const hit = bouncerKick(b, spec());
      b.velocity = hit.velocity;
      b.speed = hit.speed;
      b.position = { x: 100, y: 0 };
    }
    expect(b.speed).toBeLessThan(tunnelingSpeed);
    expect(b.speed).toBeCloseTo(250 * BOUNCER_MAX_SPEED_SCALE, 6);
  });

  it("holds even for an author who sets a reckless kick", () => {
    const b = ball({ x: 100, y: 0 }, { x: 250, y: 0 });
    const hit = bouncerKick(b, spec({ kick: 50 }));
    expect(hit.speed).toBeLessThan(tunnelingSpeed);
  });

  it("refuses a maxSpeedScale below 1 rather than braking every ball", () => {
    const b = ball({ x: 100, y: 0 }, { x: 400, y: 0 });
    expect(bouncerKick(b, spec({ maxSpeedScale: 0.2 })).speed).toBeGreaterThanOrEqual(400);
  });
});

describe("it redirects a ball it cannot speed up, and never brakes one", () => {
  it("leaves a launcher shot at its own speed", () => {
    // A launcher can put a ball at 3x base, above this ceiling. Slowing it would
    // make the launcher's whole wager - "the speed is permanent" - quietly false.
    const fast = ball({ x: 100, y: 0 }, { x: 750, y: 0 });
    const hit = bouncerKick(fast, spec());
    expect(hit.speed).toBeCloseTo(750, 6);
  });

  it("but still turns it outward, so the bumper is not a no-op", () => {
    const fast = ball({ x: 0, y: 100 }, { x: 750, y: 0 });
    const hit = bouncerKick(fast, spec());
    expect(hit.velocity.y).toBeGreaterThan(0);   // pushed away from the centre
    expect(hit.velocity.x).toBeCloseTo(0, 6);
  });
});

describe("the cooldown, so a resting ball is not machine-gunned", () => {
  it("fires on first contact", () => {
    expect(bouncerReady(ball({ x: 1, y: 0 }, { x: 1, y: 0 }), spec(), 1000)).toBe(true);
  });

  it("ignores the same ball while it is still in the band", () => {
    // A ball inside the collision band is resolved every step: without this it
    // is kicked 120 times a second and pinned at its ceiling instantly.
    const b = ball({ x: 1, y: 0 }, { x: 1, y: 0 });
    b.lastBouncerId = "b1";
    b.lastBouncerAt = 1000;
    expect(bouncerReady(b, spec(), 1000 + BOUNCER_COOLDOWN_MS - 1)).toBe(false);
    expect(bouncerReady(b, spec(), 1000 + BOUNCER_COOLDOWN_MS)).toBe(true);
  });

  it("does not let one bouncer's cooldown mute the next one", () => {
    // A cluster is the point. A shared cooldown would make the second bumper in
    // a pair inert exactly when the ball reaches it.
    const b = ball({ x: 1, y: 0 }, { x: 1, y: 0 });
    b.lastBouncerId = "b1";
    b.lastBouncerAt = 1000;
    expect(bouncerReady(b, spec({ id: "b2" }), 1001)).toBe(true);
  });
});

/**
 * The kicker: the same solid, aimed.
 *
 * A bouncer SCATTERS - which way a ball leaves depends on where it happened to
 * hit - so a cluster is a pinball rather than a plan. A kicker fires along one
 * bearing whatever the approach, which is what lets a designer build a lane
 * that feeds a ball somewhere on purpose and a player learn it.
 *
 * Everything else has to be identical, and that is most of what is checked
 * here: two objects that differ in one way are a pair, and two that quietly
 * differ in three are a maintenance problem.
 */
describe("a kicker fires along its bearing, not away from itself", () => {
  it("sends a ball the same way whatever side it arrives on", () => {
    const headings = [[100, 0], [-100, 0], [0, 100], [0, -100], [70, -70]].map(([px, py]) => {
      const b = ball({ x: px, y: py }, { x: -px, y: -py });
      const hit = bouncerKick(b, spec({ bearing: "right" }));
      return `${(hit.velocity.x / speedOf(hit.velocity)).toFixed(4)},${(hit.velocity.y / speedOf(hit.velocity)).toFixed(4)}`;
    });
    expect(new Set(headings).size, "a kicker scattered like a bouncer").toBe(1);
    expect(headings[0]).toBe("1.0000,0.0000");
  });

  it("honours every bearing", () => {
    const dir = (bearing: "up" | "down" | "left" | "right") => {
      const hit = bouncerKick(ball({ x: 40, y: 40 }, { x: -100, y: -100 }), spec({ bearing }));
      return { x: Math.round(hit.velocity.x / speedOf(hit.velocity)), y: Math.round(hit.velocity.y / speedOf(hit.velocity)) };
    };
    expect(dir("right")).toEqual({ x: 1, y: 0 });
    expect(dir("left")).toEqual({ x: -1, y: 0 });
    expect(dir("down")).toEqual({ x: 0, y: 1 });   // screen coords: +y is down
    expect(dir("up")).toEqual({ x: 0, y: -1 });
  });

  it("gains and caps exactly like a bouncer", () => {
    // The one thing that differs is the direction. If the gain or the ceiling
    // ever drifted apart, one of the two would quietly become the better object
    // to place everywhere.
    const kicked = bouncerKick(ball({ x: 100, y: 0 }, { x: -200, y: 0 }), spec({ bearing: "right" }));
    const bounced = bouncerKick(ball({ x: 100, y: 0 }, { x: -200, y: 0 }), spec());
    expect(kicked.speed).toBeCloseTo(bounced.speed, 9);
  });

  it("still never brakes a ball that is already faster than its ceiling", () => {
    const hit = bouncerKick(ball({ x: 100, y: 0 }, { x: 750, y: 0 }), spec({ bearing: "left" }));
    expect(hit.speed).toBeCloseTo(750, 6);
    expect(hit.velocity.x).toBeLessThan(0);
  });
});
