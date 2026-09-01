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
import { BOUNCER_KICK } from "@/lib/physics/bouncer";
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

describe("hitting one actually speeds a ball up", () => {
  /** Drive a ball into the bumper and report its speed before and after. */
  const run = (bouncer: boolean) => {
    const d = build(bouncer);
    const game = { ...d } as unknown as CanvasGameState;
    const ball = game.balls[0];
    // Aimed straight at the bumper from the left, just outside its rim.
    ball.position = { x: 450 - 60 - ball.radius - 2, y: 450 };
    ball.velocity = { x: 300, y: 0 };
    ball.speed = 300;
    ball.baseSpeed = 250;

    let peak = 300;
    for (let i = 0; i < 40; i++) {
      updateBall(ball, 1 / 120, game);
      peak = Math.max(peak, Math.hypot(ball.velocity.x, ball.velocity.y));
    }
    return { peak, game };
  };

  it("speeds it up, where a plain pillar would not", () => {
    const plain = run(false);
    const bumped = run(true);
    expect(plain.peak, "a plain pillar changed the ball's speed").toBeCloseTo(300, 0);
    expect(bumped.peak, "the bouncer never fired").toBeGreaterThan(300);
    expect(bumped.peak).toBeCloseTo(300 * BOUNCER_KICK, 0);
  });

  it("kicks exactly once per contact, though two systems both saw it", () => {
    // The invariant that lets the polygon path and the wall path both be wired.
    // A double kick would read as 1.25^2 = 1.5625, which is a bumper that hits
    // half again as hard as it is authored to and no screen would say so.
    const bumped = run(true);
    expect(bumped.peak).toBeCloseTo(300 * BOUNCER_KICK, 0);
    expect(bumped.peak).toBeLessThan(300 * BOUNCER_KICK * BOUNCER_KICK - 1);
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
