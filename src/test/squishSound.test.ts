/**
 * Bug Squash has its own sound: a ball of wet paper hitting a wall.
 *
 * The hit that STICKS plays the squelch and not the dry thud; every other
 * wall hit plays the thud as before. Checked through the real physics with
 * the audio module replaced by spies, because the two calls sit on the same
 * three collision paths and it is easy to end up with both, or neither.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const audio = vi.hoisted(() => ({
  playWallHitSound: vi.fn(),
  playSquishSound: vi.fn(),
  playBossJumpSound: vi.fn(),
  playBossLandSound: vi.fn(),
}));
vi.mock("@/lib/gameAudio", () => audio);
vi.mock("@/lib/gameHaptics", () => ({ vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {} }));

import { createBotGame, stepBot, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { setRunSeedText } from "@/lib/runRng";
import type { LevelConfig } from "@/types/level";
import { simNow } from "@/lib/simClock";

const BOARD: LevelConfig = {
  id: "squish-sound-board", level: 7, sizeThreshold: 30, expectedCuts: 4,
  points: 5, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1, entities: [],
} as unknown as LevelConfig;

function play(chance: number, seconds: number) {
  setRunSeedText("squish-sound-probe");
  releaseClock();
  installClock();
  const ctx = createBotGame(BOARD, 7, plainModifiers({ bugSquashChance: chance, bugSquashSeconds: 1 }));
  const ball = ctx.game.balls[0];
  let sticks = 0, wasStuck = false;
  for (let f = 0; f < seconds / PHYSICS_STEP; f++) {
    stepBot(ctx, PHYSICS_STEP);
    const stuck = ball.bugSquashUntil !== undefined && simNow() < ball.bugSquashUntil;
    if (stuck && !wasStuck) sticks++;
    wasStuck = stuck;
  }
  return sticks;
}

beforeEach(() => {
  audio.playWallHitSound.mockClear();
  audio.playSquishSound.mockClear();
});

describe("the squish sound", () => {
  it("plays once per stick, in place of the thud", () => {
    const sticks = play(100, 6);
    expect(sticks).toBeGreaterThan(0);
    // At 100% every wall hit sticks, so every wall hit squelches and none thud.
    expect(audio.playSquishSound).toHaveBeenCalledTimes(sticks);
    expect(audio.playWallHitSound).not.toHaveBeenCalled();
  });

  it("is never heard when Bug Squash is off", () => {
    play(0, 6);
    expect(audio.playSquishSound).not.toHaveBeenCalled();
    expect(audio.playWallHitSound).toHaveBeenCalled();
  });

  it("carries the impact strength like the thud does", () => {
    play(100, 6);
    for (const call of audio.playSquishSound.mock.calls) {
      expect(call[0]).toBeGreaterThan(0);
      expect(call[0]).toBeLessThanOrEqual(1);
    }
  });
});
