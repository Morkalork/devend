/**
 * A fast ball hits harder, and a really fast one does not stop.
 *
 * Asked as a question and a request: "It is important that the speed of the
 * ball affects the damage it causes destructables, does it do that today? It
 * would give some value of a fast ball to compensate how difficult it is to
 * lock down. Also, if it is really fast, it should go straight through an
 * object as it breaks (not otherwise)."
 *
 * The first half already existed and is pinned here because it is easy to lose:
 * damage is `density x (radius/18)^2 x v^1.6`, so speed has always mattered
 * more than linearly. Two things blunted it, and both are addressed:
 *
 *   THE CAP     was 2.0, against an ordinary slab authored at 3 - so no ball at
 *               any speed could break one in a single contact. The compensation
 *               for living with a fast ball was capped below the only thing
 *               that would have felt like compensation. It is 3.0 now.
 *   THE BRICKS  act I's runs are `brittle`, and a brittle brick goes on the
 *               first contact whatever the force model says. On exactly the
 *               destructibles the ladder just filled up with, speed did
 *               NOTHING: a crawling graze and a rocket each took one brick.
 *
 * Punch-through is the answer to the second, and it is why the rule is written
 * against the contact that BREAKS something rather than against damage: on a
 * brittle brick there is no damage curve left to reward, so the reward is that
 * the rocket keeps going and takes the next brick too.
 */
import { describe, it, expect } from "vitest";
import {
  createBotGame, stepBot, plainModifiers, installClock, releaseClock, type BotGame,
} from "@/lib/bot/headlessGame";
import { LADDER, byLevel } from "./fixtures/maps";
import { setRunSeedText } from "@/lib/runRng";
import {
  ballImpactDamage, punchesThrough, punchingThrough, PUNCH_THROUGH_GRACE_MS,
} from "@/lib/physics/destructibles";
import type { Ball } from "@/types/game";

/** A standard ball: density 1, base radius. */
const standard = (over: Partial<Ball> = {}): Ball => ({
  typeId: "red", radius: 18, id: "b1", state: "active", ...over,
} as unknown as Ball);

describe("speed already drives damage, and now it can finish the job", () => {
  it("hits harder than linearly with speed", () => {
    // The whole reason the model is v^1.6 rather than v: doubling the speed
    // does rather more than double the damage, so a fast ball is worth
    // steering into things.
    const slow = ballImpactDamage(standard(), 125);
    const nominal = ballImpactDamage(standard(), 250);
    const fast = ballImpactDamage(standard(), 500);
    expect(nominal).toBeCloseTo(1, 2);
    expect(nominal / slow).toBeGreaterThan(2.5);
    expect(fast / nominal).toBeGreaterThan(2.5);
  });

  it("weighs the ball as well as its speed", () => {
    const heavy = standard({ typeId: "grey" });
    expect(ballImpactDamage(heavy, 250)).toBeGreaterThan(ballImpactDamage(standard(), 250));
  });

  it("lets a genuinely fast ball take an ordinary slab in one contact", () => {
    // THE change to the curve. The ladder's slab is authored at 3 hits and the
    // cap was 2.0, so "a fast ball hits harder" stopped exactly short of ever
    // mattering on the object it was most supposed to matter on.
    expect(ballImpactDamage(standard(), 500),
      "no speed can break a 3-hit slab in one, which is what the old cap said")
      .toBeGreaterThanOrEqual(3);
    expect(ballImpactDamage(standard(), 250), "an ordinary hit is still about one")
      .toBeLessThan(1.5);
  });

  it("still chips at a crawl rather than doing nothing at all", () => {
    expect(ballImpactDamage(standard(), 5)).toBeGreaterThan(0);
  });
});

describe("the punch-through rule", () => {
  it("wants a ball that is really moving", () => {
    expect(punchesThrough(250), "the base speed is not 'really fast'").toBe(false);
    expect(punchesThrough(419)).toBe(false);
    expect(punchesThrough(420)).toBe(true);
    expect(punchesThrough(900)).toBe(true);
  });

  it("holds the ball intangible to that one wreck, and briefly", () => {
    const ball = { punchThroughId: "slab-1", punchThroughUntil: 1000 };
    expect(punchingThrough(ball, 999)).toBe(true);
    expect(punchingThrough(ball, 1000), "the grace outlives the wreck").toBe(false);
    expect(punchingThrough({}, 999), "a ball that punched nothing is intangible")
      .toBe(false);
    expect(PUNCH_THROUGH_GRACE_MS).toBeLessThan(250);
  });
});

// ── On a real board: level 6 is twelve brittle bricks stacked into a column,
//    which is exactly the shape the request is about.

/** Level 6, stepped into life, with every ball but ours put out of the way. */
function level6(): BotGame {
  installClock();
  setRunSeedText("punch-through");
  // Pinned upright: level 6 rotates, and every coordinate below is authored.
  const ctx = createBotGame({ ...byLevel(LADDER, 6)!, neverRotates: true }, 6, plainModifiers());
  for (let i = 0; i < 30; i++) stepBot(ctx);
  for (const ball of ctx.game.balls) {
    ball.position = { x: 120, y: 820 };
    ball.velocity = { x: 0, y: 0 };
    ball.speed = 0;
    ball.frozenUntil = Number.MAX_SAFE_INTEGER;   // parked, and not in the way
  }
  return ctx;
}

const teeth = (ctx: BotGame) => (ctx.game.destructibles ?? []).filter(d => d.id.startsWith("tooth-"));

/**
 * Fire the first ball straight up into the middle right-hand tooth at `speed`,
 * and report what happened to it and to the bricks.
 *
 * Level 6 used to be one column of shards down the middle; since its redesign
 * the shards are teeth off a solid spine. tooth-r2b sits at x 509..539,
 * y 436..464, and above it is open floor as far as the next tooth at y 254, so
 * a ball at x 524 heading up meets one brick and then nothing for 180 units.
 *
 * Head-on into a face is also the case that found a bug: the obstacle's BODY
 * resolver reflected the ball before the edge walls broke the brick, and the
 * punch-through then restored the already-reflected velocity. See
 * arrivalVelocity in updateBall.
 */
function fireAtTheTooth(ctx: BotGame, speed: number) {
  const ball = ctx.game.balls[0];
  ball.frozenUntil = undefined;
  ball.position = { x: 524, y: 540 };
  ball.velocity = { x: 0, y: -speed };
  ball.speed = speed;
  const before = teeth(ctx).filter(d => d.destroyed).length;
  for (let i = 0; i < 40; i++) stepBot(ctx);
  return {
    ball,
    smashed: teeth(ctx).filter(d => d.destroyed).length - before,
    // -1 still heading up (through), +1 turned back down (bounced).
    heading: Math.sign(ball.velocity.y),
  };
}

describe("on level 6's teeth of shards", () => {
  it("bounces an ordinary ball off the brick it just broke", () => {
    // The "(not otherwise)" half. A brittle brick goes on any contact, so this
    // ball breaks one too - and comes straight back, as it always has.
    const ctx = level6();
    const out = fireAtTheTooth(ctx, 260);
    expect(out.smashed, "the brick survived an ordinary hit").toBeGreaterThanOrEqual(1);
    expect(out.heading, "an ordinary ball punched through").toBe(1);
    releaseClock();
  });

  it("sends a fast one straight on through", () => {
    const ctx = level6();
    const out = fireAtTheTooth(ctx, 700);
    expect(out.smashed, "nothing broke").toBeGreaterThanOrEqual(1);
    expect(out.heading, "the rocket bounced off the wreck").toBe(-1);
    expect(out.ball.position.y, "it never made it past the tooth").toBeLessThan(436);
    releaseClock();
  });

  it("keeps the speed it arrived with", () => {
    // Nothing on this board damps a ball, and a reward that quietly taxed the
    // thing it was rewarding would be a strange reward.
    const ctx = level6();
    const out = fireAtTheTooth(ctx, 700);
    expect(Math.hypot(out.ball.velocity.x, out.ball.velocity.y)).toBeCloseTo(700, 0);
    releaseClock();
  });

  it("goes through the NEXT brick too, rather than stopping at one", () => {
    // A tooth is a run, and a ball fast enough to pass through one brick is
    // fast enough to meet the next one at the same speed. The hit debounce is
    // per object, so each brick is its own contact.
    const ctx = level6();
    const ball = ctx.game.balls[0];
    ball.frozenUntil = undefined;
    // Along the tooth's own line, from its free end toward the spine, so it
    // meets brick after brick.
    ball.position = { x: 700, y: 450 };
    ball.velocity = { x: -900, y: 0 };
    ball.speed = 900;
    for (let i = 0; i < 90; i++) stepBot(ctx);
    const smashed = teeth(ctx).filter(d => d.id.startsWith("tooth-r2") && d.destroyed).length;
    expect(smashed, "it stopped at the first brick").toBeGreaterThan(1);
    releaseClock();
  });
});

