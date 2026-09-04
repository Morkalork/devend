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
  BOUNCER_MAX_SPEED_SCALE, BOUNCER_HOURS, BOUNCER_SLOW, bouncerCharge, type BouncerSpec,
} from "@/lib/physics/bouncer";
import { PHYSICS_STEP, BASE_BALL_RADIUS } from "@/lib/gameConstants";
import { WALL_THICKNESS } from "@/lib/wallGeometry";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bouncerRings } from "@/lib/rendering/sleek/bouncerRings";
import type { Ball } from "@/types/game";

/**
 * A SPENT bumper - the pop-bumper half, and the default here on purpose.
 *
 * A bumper is two machines, and which one it is depends on its bank. Charged it
 * BRAKES (5% a hit, paid for out of its hours); spent it kicks. Almost
 * everything below is about the kick, the gain and the ceiling, so the default
 * is the state those rules describe. `charged()` opts into the other one, and
 * every test that uses it says so in its name.
 */
const spec = (over: Partial<BouncerSpec> = {}): BouncerSpec => ({
  id: "b1", centre: { x: 0, y: 0 }, kick: BOUNCER_KICK,
  maxSpeedScale: BOUNCER_MAX_SPEED_SCALE, hours: 0, maxHours: BOUNCER_HOURS, ...over,
});

/** A bumper with hours left: the one that brakes and pays. */
const charged = (over: Partial<BouncerSpec> = {}): BouncerSpec =>
  spec({ hours: BOUNCER_HOURS, ...over });

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

describe("a spent bumper redirects a ball it cannot speed up, and never brakes one", () => {
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

/**
 * The bank: a reason not to take the quick win.
 *
 * Tempo pays for shipping early and nothing has ever paid for staying, so a
 * bumper holds a small purse and pays a share of it every time a ball strikes
 * it. The two properties that make the idea safe rather than exploitable are
 * that the purse is FIXED (it cannot be farmed by parking a ball in a cluster
 * and walking away) and that a spent bumper still bounces (it is furniture that
 * was worth something, not a coin that vanishes and changes the board).
 *
 * The payout is deliberately routed above the per-map cap rather than through
 * `greedBonus` where the break bonus goes. Greed is a CAPPED axis: a flat bonus
 * added inside it is clamped straight back off on any map where the player
 * earned greed anyway, which is the bug the colored-area share shipped with -
 * "+9h" displayed for a contribution worth exactly zero. A bumper counts down
 * in front of the player, so a bump has to be an hour, always.
 */
describe("the bank is authored, and an empty one is still a bumper", () => {
  // What is SPENT is tested through the running game in bouncerWired.test.ts,
  // against the real payment path. Re-implementing the decrement here would be
  // a second copy of the one rule, and it would agree with a broken first copy.
  it("starts with the authored hours", () => {
    expect(charged().hours).toBe(BOUNCER_HOURS);
    expect(charged({ hours: 2 }).hours).toBe(2);
  });

  it("still bounces when its bank is empty, and only then kicks", () => {
    // A spent bumper is furniture that happened to be worth something. If it
    // stopped bouncing, running one dry would silently change the board - and
    // running one dry is what turns it from a brake into a kick.
    const rich = bouncerKick(ball({ x: 100, y: 0 }, { x: -200, y: 0 }), charged());
    const broke = bouncerKick(ball({ x: 100, y: 0 }, { x: -200, y: 0 }), spec({ hours: 0 }));
    expect(broke.speed).toBeCloseTo(200 * BOUNCER_KICK, 6);
    expect(rich.speed).toBeLessThan(200);
    // Both still fire the ball outward: the bank changes the speed, never the
    // direction, so a drained cluster plays the same shapes.
    expect(Math.sign(broke.velocity.x)).toBe(Math.sign(rich.velocity.x));
    expect(broke.velocity.y).toBeCloseTo(0, 9);
    expect(rich.velocity.y).toBeCloseTo(0, 9);
  });
});

/**
 * The brake, which is the charged half of the same object.
 *
 * The reason it exists: nothing else on the board takes speed off a ball. The
 * launcher and the Rubber Band both make a ball permanently faster, bumpers
 * used to only ever add, and a fast ball is a ball that is hard to fence. This
 * is the board's own answer, and it is not free - every brake spends an hour
 * the player would otherwise have banked.
 */
describe("a charged bumper brakes instead of kicking", () => {
  it("takes five per cent off, rather than adding a quarter", () => {
    const b = ball({ x: 100, y: 0 }, { x: -200, y: 0 });
    expect(bouncerKick(b, charged()).speed).toBeCloseTo(200 * BOUNCER_SLOW, 6);
  });

  it("brakes a launcher shot that a spent bumper would leave alone", () => {
    // The one case the old rule refused outright. It is allowed now because the
    // bumper pays for it out of its own bank.
    const fast = () => ball({ x: 100, y: 0 }, { x: 750, y: 0 });
    expect(bouncerKick(fast(), spec()).speed).toBeCloseTo(750, 6);
    expect(bouncerKick(fast(), charged()).speed).toBeCloseTo(750 * BOUNCER_SLOW, 6);
  });

  it("still fires the ball outward, so it is a bumper and not a wall", () => {
    const b = ball({ x: 0, y: 100 }, { x: 300, y: 0 });
    const hit = bouncerKick(b, charged());
    expect(hit.velocity.y).toBeGreaterThan(0);
    expect(hit.velocity.x).toBeCloseTo(0, 6);
  });

  it("cannot empty a whole bank into a standstill", () => {
    // Five hours is five brakes, so one bumper's entire bank is 0.95^5. A ball
    // that could be parked to a stop would be a way to break a map rather than
    // a way to tame one.
    let b = ball({ x: 100, y: 0 }, { x: -250, y: 0 });
    for (let i = 0; i < BOUNCER_HOURS; i++) {
      const hit = bouncerKick(b, charged());
      b = ball({ x: 100, y: 0 }, { x: -hit.speed, y: 0 });
    }
    expect(b.speed).toBeCloseTo(250 * Math.pow(BOUNCER_SLOW, BOUNCER_HOURS), 4);
    expect(b.speed).toBeGreaterThan(250 * 0.7);
  });

  it("never brakes a ball below its own minimum speed", () => {
    // The engine floors every ball at minimumSpeed anyway, but the returned
    // speed is what the caller writes on and what the flash is scaled from, so
    // it has to be true here too rather than corrected a step later.
    const b = ball({ x: 100, y: 0 }, { x: -200, y: 0 });
    (b as unknown as { minimumSpeed: number }).minimumSpeed = 195;
    expect(bouncerKick(b, charged()).speed).toBe(195);
  });

  it("flashes for a brake as brightly as for a kick", () => {
    const b = () => ball({ x: 100, y: 0 }, { x: -200, y: 0 });
    expect(bouncerKick(b(), charged()).intensity).toBeCloseTo(1, 6);
    expect(bouncerKick(b(), spec()).intensity).toBeCloseTo(1, 6);
  });
});

/**
 * The countdown, which is what the player actually sees.
 *
 * A bumper's bank was readable only as a colour: green while anything was left,
 * red once it was not. So a bumper with one hour in it looked exactly like one
 * with five, and a bump costing an hour looked like nothing happening. The
 * renderer draws this fraction as a shrinking ring inside a rim that never
 * moves - the gap between the two IS the readout - and it lives here rather
 * than in the renderer so there is one definition of "how full" to disagree
 * with.
 */
describe("how full a bumper reads", () => {
  it("is full at the start and empty when spent", () => {
    expect(bouncerCharge({ hours: BOUNCER_HOURS, maxHours: BOUNCER_HOURS })).toBe(1);
    expect(bouncerCharge({ hours: 0, maxHours: BOUNCER_HOURS })).toBe(0);
  });

  it("steps down as the bank is spent, so a bump is visible", () => {
    const steps = [5, 4, 3, 2, 1, 0].map(h => bouncerCharge({ hours: h, maxHours: 5 }));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i], `hour ${5 - i} did not shrink the gauge`).toBeLessThan(steps[i - 1]);
    }
    expect(steps).toEqual([1, 0.8, 0.6, 0.4, 0.2, 0]);
  });

  it("measures against the bank the map authored, not the default", () => {
    // A bumper authored with two hours is FULL at two. Measuring it against
    // BOUNCER_HOURS would draw it as three-fifths spent from the first frame,
    // which is a gauge that lies before the player has touched it.
    expect(bouncerCharge({ hours: 2, maxHours: 2 })).toBe(1);
    expect(bouncerCharge({ hours: 1, maxHours: 2 })).toBe(0.5);
  });

  it("never draws outside the rim it is measured against", () => {
    expect(bouncerCharge({ hours: 99, maxHours: 5 })).toBe(1);
    expect(bouncerCharge({ hours: -3, maxHours: 5 })).toBe(0);
    // A spec with no bank at all reads as spent rather than dividing by zero.
    expect(bouncerCharge({ hours: 0, maxHours: 0 })).toBe(0);
  });
});

/**
 * The countdown as the player sees it: which ring moves and which does not.
 *
 * The gauge is only worth anything if the rim stays where the ball will
 * actually bounce. A rim that shrank with the bank would read beautifully and
 * be a lie, and the player would find out by aiming at a small circle and
 * hitting a big one.
 */
describe("the rings that draw the countdown", () => {
  const R = 40;

  it("never moves the rim, whatever the bank holds", () => {
    const rims = [0, 0.25, 0.5, 0.75, 1].map(c => bouncerRings(c, R, 0).rim);
    expect(new Set(rims).size, "the rim moved with the bank").toBe(1);
    // Nor with a hit: the flare thickens the stroke, it does not grow the ring.
    expect(bouncerRings(1, R, 1).rim).toBe(bouncerRings(1, R, 0).rim);
  });

  it("shrinks the gauge as the bank empties, and hides it when spent", () => {
    const gauge = [1, 0.8, 0.6, 0.4, 0.2, 0].map(c => bouncerRings(c, R, 0).charge);
    for (let i = 1; i < gauge.length; i++) {
      expect(gauge[i], `step ${i} did not shrink`).toBeLessThan(gauge[i - 1]);
    }
    // Zero, so the caller draws nothing rather than leaving a dot that reads
    // as a bumper still holding something.
    expect(gauge[gauge.length - 1]).toBe(0);
  });

  it("keeps the gauge inside the rim, so the gap is always the readout", () => {
    for (const c of [0, 0.5, 1]) {
      for (const f of [0, 1]) {
        const ring = bouncerRings(c, R, f);
        expect(ring.charge, `charge ${c} flare ${f}`).toBeLessThan(ring.rim);
        expect(ring.core, `core at charge ${c} flare ${f}`).toBeLessThan(ring.rim);
      }
    }
  });

  it("leaves a spent bumper an ember rather than nothing", () => {
    // It is still a bumper and still bounces - and once spent it kicks, which
    // is the thing a player most needs to keep noticing.
    expect(bouncerRings(0, R, 0).core).toBeGreaterThan(0);
  });

  it("clamps whatever it is handed", () => {
    expect(bouncerRings(9, R, 9).charge).toBe(bouncerRings(1, R, 1).charge);
    expect(bouncerRings(-4, R, -4).charge).toBe(bouncerRings(0, R, 0).charge);
  });
});

/**
 * The joint the geometry above cannot reach.
 *
 * bouncerRings can be perfect and the layer can still hand it a constant, which
 * is a bumper whose gauge never moves and looks entirely deliberate. Pixi draw
 * calls are the one place in this codebase nothing can assert against, so the
 * call itself is read from the source - the same trick rendererPathHygiene
 * uses on the same directory, and for the same reason.
 */
describe("the layer actually draws the bank it was given", () => {
  const layer = readFileSync(
    resolve(__dirname, "../lib/rendering/sleek/entityLayer.ts"), "utf8");

  it("feeds the live charge into the rings, not a constant", () => {
    const call = layer.match(/bouncerRings\(([^)]*)\)/);
    expect(call, "the bumper stopped using bouncerRings at all").toBeTruthy();
    expect(call![1], "the gauge is drawn from a literal, so it never moves")
      .toContain("charge");
  });

  it("takes that charge from the spec rather than inventing one", () => {
    expect(layer).toContain("bouncerCharge(spec)");
  });
});
