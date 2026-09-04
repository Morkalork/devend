/**
 * The kick reaches the ball, from both collision systems.
 *
 * bouncer.test.ts proves the arithmetic. This proves it is connected, which is
 * the half that can be quietly correct and never called - and there are two
 * places it has to be called from, not one.
 *
 * An obstacle lives in BOTH collision systems: as a polygon (the outward
 * resolver) and as a set of `obstacle-<id>-edge-` walls. updateBall's own
 * comment on the pass rules says what happens when a property is honoured in
 * only one of them - "a wall that lets balls through its middle and bounces
 * them off its edges, which is worse than not having the mechanic". A bouncer
 * wired to one path would fire from its face and be inert at its rim.
 *
 * Both are wired, and measured here: removing EITHER one on its own leaves
 * these tests green, because whichever survives catches the hit. So this file
 * does not claim to exercise them separately - what it pins instead is the
 * property that makes wiring both safe, which is that a single contact still
 * produces exactly ONE kick. Without the cooldown the two paths would compound
 * on the same step and every bumper would quietly hit at kick squared.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playWallHitSound: () => {}, playBallCollideSound: () => {}, playFenceBreakSound: () => {},
  playDeathSound: () => {}, playBallLockSound: () => {}, playCutClaimedSound: () => {},
  playPickupClaimedSound: () => {}, playBossJumpSound: () => {}, playHeartbeatSound: () => {},
  playBossChargeSound: () => {}, playBossLandSound: () => {}, playLevelCompleteSound: () => {},
  setAudioMuted: () => {}, setSfxVolume: () => {}, getSfxVolume: () => 1,
  isAudioMuted: () => false, initAudio: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {}, vibrateDeath: () => {},
  vibrateBallLock: () => {}, setHapticsEnabled: () => {}, isHapticsEnabled: () => false,
}));

import { createInitialGameData } from "@/lib/initGame";
import { updateBall } from "@/lib/physics/updateBall";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { BOUNCER_KICK, BOUNCER_HOURS, BOUNCER_SLOW, bouncerCharge } from "@/lib/physics/bouncer";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const level = (bouncer: boolean): LevelConfig => ({
  id: "bounce-test", level: 5, name: "B", sizeThreshold: 30, expectedCuts: 4,
  points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1,
  entities: [{
    id: "bump", kind: "wall", shape: "circle", cx: 450, cy: 450, radius: 60,
    ...(bouncer ? { bouncer: true } : {}),
  }],
} as unknown as LevelConfig);

const build = (b: boolean) => createInitialGameData(level(b), 5, DEFAULT_MODIFIERS);

describe("a bouncer is registered on both collision paths", () => {
  it("puts the spec on the polygon map", () => {
    const d = build(true);
    expect(d.bouncers.size, "no bouncer was registered at all").toBe(1);
    const spec = [...d.bouncers.values()][0];
    expect(spec.id).toBe("bump");
    expect(spec.centre.x).toBeCloseTo(450, 0);
    expect(spec.centre.y).toBeCloseTo(450, 0);
  });

  it("puts the SAME object on every edge wall of that obstacle", () => {
    // Same object, not a copy: two copies is one edit away from a bumper that
    // fires at a different strength depending on which system caught the hit.
    const d = build(true);
    const spec = [...d.bouncers.values()][0];
    const edges = d.walls.filter(w => w.id.startsWith("obstacle-bump-"));
    expect(edges.length, "the obstacle has no edge walls").toBeGreaterThan(0);
    for (const w of edges) expect(w.bouncer, w.id).toBe(spec);
  });

  it("leaves an ordinary wall completely alone", () => {
    const d = build(false);
    expect(d.bouncers.size).toBe(0);
    expect(d.walls.some(w => w.bouncer)).toBe(false);
  });
});

describe("hitting one changes the ball's speed, and the bank says which way", () => {
  /**
   * Drive a ball into the bumper and report the extremes of its speed.
   *
   * `drain` empties the bank first, through the SPEC the game built rather than
   * by authoring a second map: the two states of a bumper have to be the same
   * object with a different number in it, or "spent" here would not be the
   * spent the player produces by bumping it five times.
   */
  const run = (bouncer: boolean, drain = false) => {
    const d = build(bouncer);
    const game = { ...d } as unknown as CanvasGameState;
    if (drain) for (const spec of game.bouncers?.values() ?? []) spec.hours = 0;
    const ball = game.balls[0];
    // Aimed straight at the bumper from the left, just outside its rim.
    ball.position = { x: 450 - 60 - ball.radius - 2, y: 450 };
    ball.velocity = { x: 300, y: 0 };
    ball.speed = 300;
    ball.baseSpeed = 250;

    let peak = 300, trough = 300;
    for (let i = 0; i < 40; i++) {
      updateBall(ball, 1 / 120, game);
      const v = Math.hypot(ball.velocity.x, ball.velocity.y);
      peak = Math.max(peak, v);
      trough = Math.min(trough, v);
    }
    return { peak, trough, game };
  };

  it("slows it while it still has hours, where a plain pillar would not", () => {
    const plain = run(false);
    const bumped = run(true);
    expect(plain.trough, "a plain pillar changed the ball's speed").toBeCloseTo(300, 0);
    expect(bumped.trough, "the bouncer never fired").toBeLessThan(300);
    expect(bumped.trough).toBeCloseTo(300 * BOUNCER_SLOW, 0);
    expect(bumped.peak, "a charged bumper still added speed").toBeCloseTo(300, 0);
  });

  it("speeds it up once the bank is empty", () => {
    const drained = run(true, true);
    expect(drained.peak).toBeCloseTo(300 * BOUNCER_KICK, 0);
  });

  it("acts exactly once per contact, though two systems both saw it", () => {
    // The invariant that lets the polygon path and the wall path both be wired.
    // Applied twice a charged bumper would read as 0.95^2 and a spent one as
    // 1.25^2, and no screen would say either was happening.
    const bumped = run(true);
    expect(bumped.trough).toBeCloseTo(300 * BOUNCER_SLOW, 0);
    expect(bumped.trough).toBeGreaterThan(300 * BOUNCER_SLOW * BOUNCER_SLOW + 1);
    const drained = run(true, true);
    expect(drained.peak).toBeLessThan(300 * BOUNCER_KICK * BOUNCER_KICK - 1);
  });

  it("publishes a flash so the speed-up has a visible cause", () => {
    const { game } = run(true);
    expect((game.bouncerFlashes ?? []).length, "nothing was told to draw it")
      .toBeGreaterThan(0);
    expect(game.bouncerFlashes![0].id).toBe("bump");
  });

  it("does not let the flash queue grow without bound", () => {
    // The physics runs whether or not anything is drawing, so nothing may rely
    // on a renderer draining this.
    const { game } = run(true);
    expect((game.bouncerFlashes ?? []).length).toBeLessThan(10);
  });
});

/**
 * The bank, through the real payment path.
 *
 * Tempo pays for shipping early and nothing has ever paid for STAYING, so a
 * bumper holds a small purse and pays an hour every time a ball strikes it.
 * Driven through updateBall rather than by re-implementing the decrement,
 * because a second copy of the rule would agree with a broken first copy.
 *
 * The two properties that make a purse safe where a rate would not be: it is
 * fixed, so parking a ball in a cluster earns nothing extra, and a spent bumper
 * still bounces, so running one dry does not silently change the board.
 */
describe("bumper hours", () => {
  /** Bounce a ball off the bumper `hits` times and report what it paid. */
  const rally = (hits: number) => {
    const d = build(true);
    const game = { ...d } as unknown as CanvasGameState;
    game.bouncerOvertime = 0;
    const spec = [...d.bouncers.values()][0];
    const ball = game.balls[0];
    ball.baseSpeed = 250;

    for (let i = 0; i < hits; i++) {
      // Re-approach from outside the rim each time, and clear the cooldown, so
      // each pass is a fresh contact rather than one long overlap.
      ball.position = { x: spec.centre.x - 60 - ball.radius - 2, y: spec.centre.y };
      ball.velocity = { x: 300, y: 0 };
      ball.speed = 300;
      ball.lastBouncerId = undefined;
      ball.lastBouncerAt = undefined;
      for (let step = 0; step < 8; step++) updateBall(ball, 1 / 120, game);
    }
    return { paid: game.bouncerOvertime ?? 0, left: spec.hours };
  };

  it("pays an hour for a bump", () => {
    const one = rally(1);
    expect(one.paid, "a bump paid nothing").toBe(1);
    expect(one.left).toBe(BOUNCER_HOURS - 1);
  });

  it("pays one per bump until the bank is empty", () => {
    const full = rally(BOUNCER_HOURS);
    expect(full.paid).toBe(BOUNCER_HOURS);
    expect(full.left).toBe(0);
  });

  it("pays nothing more once it is dry, however long the rally", () => {
    // The property that stops a bumper cluster being a place to park a ball
    // and walk away.
    const overrun = rally(BOUNCER_HOURS + 8);
    expect(overrun.paid, "the bank kept paying after it emptied").toBe(BOUNCER_HOURS);
    expect(overrun.left).toBe(0);
  });

  it("keeps kicking after the money runs out", () => {
    const d = build(true);
    const game = { ...d } as unknown as CanvasGameState;
    const spec = [...d.bouncers.values()][0];
    spec.hours = 0;
    const ball = game.balls[0];
    ball.position = { x: spec.centre.x - 60 - ball.radius - 2, y: spec.centre.y };
    ball.velocity = { x: 300, y: 0 };
    ball.speed = 300; ball.baseSpeed = 250;
    let peak = 300;
    for (let i = 0; i < 40; i++) {
      updateBall(ball, 1 / 120, game);
      peak = Math.max(peak, Math.hypot(ball.velocity.x, ball.velocity.y));
    }
    expect(peak, "a spent bumper stopped bouncing").toBeCloseTo(300 * BOUNCER_KICK, 0);
  });
});

/**
 * The countdown's wiring: the gauge needs a number the map put there.
 *
 * bouncer.test.ts pins what the fraction means. This pins that the running
 * game supplies both halves of it, which is the part that fails silently -
 * a spec with no `maxHours` divides into a gauge that is either always full
 * or always empty, and either one looks like a deliberate art choice.
 */
describe("a built bumper knows what its bank started at", () => {
  it("records the authored bank, not just the remaining one", () => {
    const d = build(true);
    const spec = [...d.bouncers.values()][0];
    expect(spec.maxHours, "the gauge has no denominator").toBe(BOUNCER_HOURS);
    expect(spec.hours).toBe(BOUNCER_HOURS);
    expect(bouncerCharge(spec), "a fresh bumper does not read as full").toBe(1);
  });

  it("carries a map's own bank through to the gauge", () => {
    // Authored at two hours: full is two, and the gauge has to agree or the
    // bumper reads as three-fifths spent before anything has touched it.
    const lvl = {
      id: "bounce-test", level: 5, name: "B", sizeThreshold: 30, expectedCuts: 4,
      points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1,
      entities: [{
        id: "bump", kind: "wall", shape: "circle", cx: 450, cy: 450, radius: 60,
        bouncer: true, bounceHours: 2,
      }],
    } as unknown as LevelConfig;
    const spec = [...createInitialGameData(lvl, 5, DEFAULT_MODIFIERS).bouncers.values()][0];
    expect(spec.maxHours).toBe(2);
    expect(bouncerCharge(spec)).toBe(1);
  });

  it("empties the gauge as the bank is spent through the real payment path", () => {
    // Not a re-implementation of the decrement: the same run that pays the
    // hours is the one the gauge is read from, so the two cannot drift.
    const d = build(true);
    const game = { ...d } as unknown as CanvasGameState;
    const spec = [...game.bouncers!.values()][0];
    const before = bouncerCharge(spec);
    const ball = game.balls[0];
    ball.position = { x: 450 - 60 - ball.radius - 2, y: 450 };
    ball.velocity = { x: 300, y: 0 };
    ball.speed = 300;
    ball.baseSpeed = 250;
    for (let i = 0; i < 40; i++) updateBall(ball, 1 / 120, game);
    expect(bouncerCharge(spec), "the bumper was hit and the gauge did not move")
      .toBeLessThan(before);
  });
});
