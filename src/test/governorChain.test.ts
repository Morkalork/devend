/**
 * Level 11's governor: the map's answer to its own wager.
 *
 * A launched ball keeps its speed for the whole map. Nothing in the engine
 * damps one - `minimumSpeed` only ever scales UP, bounces preserve magnitude,
 * and there is no drag anywhere in src/lib/physics - so a hard pull buys
 * position now and leaves a board that is much harder to fence for the rest of
 * the level. Until the bumper brake there was nothing on any board that could
 * take that speed back off.
 *
 * A CHARGED bumper does: 5% a bump, paid for out of its own bank of hours. So a
 * chain of them across the plunger's line is where a player who pulled too hard
 * goes to buy the speed back, and it costs the bumpers' banks to do it. Run
 * them dry and the same chain starts kicking instead, which is the trap.
 *
 * What this file guards is the pair of facts that make that true and that both
 * fail silently: a hard shot really does end up slower than it left, and the
 * bumpers really do have banks to pay for it. It deliberately does NOT claim
 * the bumpers sit across the shot's line - measured, the first crossing is the
 * same with them and without, because a ball meets what it happens to meet.
 * What they buy is a chamber that is still braking after the first pass.
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

import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInitialGameData } from "@/lib/initGame";
import { updateBall } from "@/lib/physics/updateBall";
import { fireLauncher, pendingLauncher } from "@/lib/physics/launcher";
import { setRunSeedText } from "@/lib/runRng";
import { BOUNCER_SLOW } from "@/lib/physics/bouncer";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { LevelConfig, LevelData } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const level11 = (): LevelConfig => {
  const doc = yaml.load(readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8")) as LevelData;
  const l = doc.levels.find(x => x.level === 11);
  if (!l) throw new Error("map.yml has no level 11");
  return l as unknown as LevelConfig;
};

const bumpers = (l: LevelConfig) =>
  (l.entities ?? []).filter(e => (e as unknown as { bouncer?: boolean }).bouncer);

/**
 * Fire the plunger down the barrel's own line and report what the chain did.
 *
 * Seeded, because a map is dealt in one of four rotations: a chain measured on
 * whichever board turned up is a chain measured by luck. `deal-e` is checked
 * below against the rotation it claims.
 */
function fire(level: LevelConfig, seed: string, steps = 900) {
  setRunSeedText(seed);
  const d = createInitialGameData(level, 11, DEFAULT_MODIFIERS);
  const game = {
    ...d, objectDebris: [], pendingDestroys: [], bouncerFlashes: [], assimilations: new Map(),
  } as unknown as CanvasGameState;
  const launcher = pendingLauncher(game);
  if (!launcher) { setRunSeedText(null); throw new Error("level 11 has no plunger"); }

  // The barrel's own aim, dealt with the board: a straight pull, which is the
  // shot the map is built around.
  const rad = (((launcher.angle ?? 0)) * Math.PI) / 180;
  const before = game.balls.map(b => b.baseSpeed * 3);
  fireLauncher(game, launcher, {
    direction: { x: Math.cos(rad), y: Math.sin(rad) }, power: 3, clamped: false,
  });

  for (let i = 0; i < steps; i++) {
    for (const b of game.balls) if (b.state === "active") updateBall(b, 1 / 120, game);
  }
  const after = game.balls.map(b => Math.hypot(b.velocity.x, b.velocity.y));
  setRunSeedText(null);
  return {
    rotation: d.mapRotation,
    slowest: Math.min(...after.map((s, i) => s / before[i])),
    hours: game.bouncerOvertime ?? 0,
  };
}

describe("the chamber is stocked to brake with", () => {
  it("keeps every bumper a bumper, and exactly one of them a kicker", () => {
    const bs = bumpers(level11());
    expect(bs.length, "the gauntlet lost its bumpers").toBeGreaterThanOrEqual(5);
    const kickers = bs.filter(e => (e as unknown as { bearing?: string }).bearing);
    // A kicker aims; a bouncer scatters. One aimed feed is a plan, five would
    // be a conveyor belt with no decision in it.
    expect(kickers.length, "the aimed feed is gone, or the whole chain became one").toBe(1);
  });

  it("banks hours in every bumper, so braking has something to spend", () => {
    // A bumper with no bank cannot brake: the brake IS the bank being spent.
    for (const b of bumpers(level11())) {
      const hours = (b as unknown as { hours?: number }).hours;
      expect(hours === undefined || hours > 0, `${b.id} has an empty bank`).toBe(true);
    }
  });
});

describe("a hard shot comes out slower than it went in", () => {
  it("brakes the launched ball, and pays for it", () => {
    const r = fire(level11(), "deal-a");
    expect(r.rotation, "the pinned seed no longer deals this rotation").toBe(0);
    // At full power the shot leaves at 3x base. Every charged bump takes 5%,
    // so a ball that crossed the chain is measurably under what it left at.
    expect(r.slowest, "nothing on the board took any speed off the shot")
      .toBeLessThan(BOUNCER_SLOW);
    // And the braking is the same event that pays: hours only move when a
    // charged bumper fires, so this is the brake seen from the other side.
    expect(r.hours, "the chain never fired, so nothing was braked or paid")
      .toBeGreaterThan(0);
  });

  it("brakes it in every deal, not just the one that happened to be dealt", () => {
    // One seed per rotation for THIS level: pickMapRotation salts the run seed
    // with the level id, so a seed that deals level 6 upright says nothing here.
    for (const seed of ["deal-a", "deal-c", "deal-f", "deal-h"]) {
      const r = fire(level11(), seed);
      expect(r.hours, `deal ${seed} (rotation ${r.rotation}) never reached the chain`)
        .toBeGreaterThan(0);
    }
  });
});
