/**
 * The headless bot plays the build the browser plays.
 *
 * The upgrade sweep (UPGRADE_SWEEP_REPORT.md) read 84 of 145 cards as changing
 * nothing, and part of that was the bot rather than the cards: shields, Cold
 * Boot, Feature Freeze uses and Cron Job were applied only in GameCanvas and
 * the browser loop, lives were a bottomless three, the bot never tapped a
 * freeze, never drew a second fence at once, and never drew a fence type.
 * These pin each piece, so a sweep of a card measures the card.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBotGame, stepBot, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { planFreeze } from "@/lib/bot/policy";
import { setRunSeedText } from "@/lib/runRng";
import { simNow } from "@/lib/simClock";
import { AUTO_FREEZE_INTERVAL_MS, PHYSICS_STEP } from "@/lib/gameConstants";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import { LADDER, byLevel } from "./fixtures/maps";

const LEVEL = byLevel(LADDER, 8)!;

function deal(over: Partial<GameModifiers> = {}, opts: Parameters<typeof createBotGame>[3] = {}) {
  installClock();
  setRunSeedText("parity");
  return createBotGame(LEVEL, 8, plainModifiers(over), opts);
}

describe("what a build hands every map at its start", () => {
  it("deals shields, Feature Freeze uses and a Cold Boot freeze", () => {
    try {
      const ctx = deal({ wallShieldsPerMap: 2, freezeUsesPerMap: 1, spawnFreezeSeconds: 2 });
      expect(ctx.game.wallShieldsRemaining).toBe(2);
      expect(ctx.game.freezeUsesRemaining).toBe(1);
      const now = simNow();
      expect(ctx.game.balls.every(b => (b.frozenUntil ?? 0) > now)).toBe(true);
    } finally {
      releaseClock();
    }
  });

  it("deals none of it to a plain build", () => {
    try {
      const ctx = deal();
      expect(ctx.game.wallShieldsRemaining).toBe(0);
      expect(ctx.game.freezeUsesRemaining).toBe(0);
      expect(ctx.game.balls.some(b => (b.frozenUntil ?? 0) > simNow())).toBe(false);
    } finally {
      releaseClock();
    }
  });
});

describe("Cron Job", () => {
  it("freezes a ball once its interval has passed", () => {
    try {
      const ctx = deal({ autoFreezeDuration: 3 });
      const frames = Math.ceil((AUTO_FREEZE_INTERVAL_MS / 1000 + 0.5) / PHYSICS_STEP);
      for (let f = 0; f < frames; f++) {
        stepBot(ctx);
      }
      expect(ctx.game.balls.some(b => (b.frozenUntil ?? 0) > simNow())).toBe(true);
    } finally {
      releaseClock();
    }
  });
});

describe("lives", () => {
  it("are real when asked for: a spent life stays spent", () => {
    try {
      const ctx = deal({}, { lives: 4 });
      expect(ctx.callbacks.getLives()).toBe(4);
      ctx.callbacks.setLivesRef(3);
      expect(ctx.callbacks.getLives()).toBe(3);
    } finally {
      releaseClock();
    }
  });

  it("stay the old bottomless three when not", () => {
    try {
      const ctx = deal();
      ctx.callbacks.setLivesRef(0);
      expect(ctx.callbacks.getLives()).toBe(3);
    } finally {
      releaseClock();
    }
  });
});

describe("the freeze policy", () => {
  it("targets the ball heading into a growing fence, and nothing without one", () => {
    try {
      const ctx = deal();
      expect(planFreeze(ctx.game)).toBeNull();
      const ball = ctx.game.balls[0];
      const at = { x: ball.position.x + 30, y: ball.position.y };
      ball.velocity = { x: 100, y: 0 };
      ctx.game.activeWalls = [{
        origin: at, direction: { x: 0, y: 1 },
        startWaypoints: [at, { x: at.x, y: at.y - 200 }], endWaypoints: [at, { x: at.x, y: at.y + 200 }],
        startSegmentIndex: 0, endSegmentIndex: 0,
        startPoint: { x: at.x, y: at.y - 50 }, endPoint: { x: at.x, y: at.y + 50 },
        targetStart: { x: at.x, y: at.y - 200 }, targetEnd: { x: at.x, y: at.y + 200 },
        thickness: 6, isComplete: false, activeRegionId: ball.regionId,
      } as unknown as typeof ctx.game.activeWalls[number]];
      expect(planFreeze(ctx.game)?.regionId).toBe(ball.regionId);
      // Heading away, it is not about to break anything.
      ball.velocity = { x: -100, y: 0 };
      expect(planFreeze(ctx.game)).toBeNull();
    } finally {
      releaseClock();
    }
  });
});

describe("the bot shares the browser's rules rather than copying them", () => {
  it("reads the concurrent-fence limit from the same function the input layer does", () => {
    const input = readFileSync(resolve(__dirname, "../hooks/useGameInput.ts"), "utf8");
    const bot = readFileSync(resolve(__dirname, "../lib/bot/runBot.ts"), "utf8");
    expect(input).toMatch(/from "@\/lib\/concurrentFences"/);
    expect(bot).toMatch(/concurrentFenceLimit\(ctx\.game, ctx\.modifiers\)/);
  });

  it("shares Cron Job, the map-start boons and push banking with the browser", () => {
    const loop = readFileSync(resolve(__dirname, "../hooks/useGameLoop.ts"), "utf8");
    const canvas = readFileSync(resolve(__dirname, "../components/game/GameCanvas.tsx"), "utf8");
    const bot = readFileSync(resolve(__dirname, "../lib/bot/runBot.ts"), "utf8");
    expect(loop).toMatch(/tickAutoFreeze\(game, autoFreezeDuration, freezeNoCooldown\)/);
    expect(canvas).toMatch(/applyMapStartBoons\(game, activeModifiers\)/);
    expect(canvas).toMatch(/mapStartShields\(activeModifiers\)/);
    expect(canvas).toMatch(/mapStartFreezeUses\(activeModifiers\)/);
    expect(canvas).toMatch(/scoreBankedPush\(\s*game, level, levelNumber, activeModifiers,?\s*\)/);
    expect(bot).toMatch(/scoreBankedPush\(/);
  });
});
