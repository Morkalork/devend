/**
 * The bot plays on the map's clock, like a player does.
 *
 * Found while sweeping the bare gravity board (level 15 at the time, level 14
 * since the two were merged): a seed came back a WIN at 53 seconds on a map
 * whose deadline is 50. useGameLoop calls `checkWinCondition` every active
 * frame and `evaluateWinConditions` opens by failing the map once
 * activePlaySeconds reaches getMapTimeLimit; the harness called it only in
 * reaction to a cut or a destroy, so between cuts there was no clock at all.
 *
 * Every sweep this harness has ever run was therefore measuring a map with no
 * time limit and reporting the number as though it had one. That is the third
 * divergence of this exact shape (map beats, the end-of-frame passes, now the
 * deadline), which is why it is pinned here rather than just fixed: the rule
 * the harness lives by is that it runs the same loop the browser runs, and
 * nothing was checking that the loop's own safety net was in it.
 *
 * Note for anyone reading a bot number: PHYSICS_STEP is 1/120, so runBot's
 * default `maxFrames: 3600` is 30 seconds of game time, not 60. A sweep meant
 * to reach a map's own deadline has to ask for the frames.
 */
import { describe, it, expect } from "vitest";
import { createBotGame, stepBot, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { getMapTimeLimit } from "@/lib/mapTiming";
import { setRunSeedText } from "@/lib/runRng";
import { LADDER } from "./fixtures/maps";
import type { LevelConfig } from "@/types/level";

/** Play a map with no cutting at all, and report when a life was docked. */
function livesDockedAt(level: LevelConfig, levelNumber: number, seconds: number): number[] {
  setRunSeedText("clock-probe");
  installClock();
  try {
    const ctx = createBotGame(level, levelNumber, plainModifiers());
    const at: number[] = [];
    const inner = ctx.callbacks.onLivesChange;
    ctx.callbacks.onLivesChange = (...args: unknown[]) => {
      at.push(Number((ctx.game.activePlaySeconds ?? 0).toFixed(2)));
      return (inner as ((...a: unknown[]) => unknown) | undefined)?.(...args);
    };
    for (let f = 0; f < seconds / PHYSICS_STEP; f++) stepBot(ctx, PHYSICS_STEP);
    return at;
  } finally { releaseClock(); }
}

const board = LADDER.find(l => l.level === 14)!;

describe("the map deadline reaches the harness", () => {
  it("docks a life the moment an authored timer runs out", () => {
    const at = livesDockedAt({ ...board, timeLimit: 5 } as LevelConfig, 14, 12);
    expect(at.length, "the deadline never fired: the bot is playing without a clock").toBeGreaterThan(0);
    expect(at[0]).toBeGreaterThanOrEqual(5);
    expect(at[0], "the deadline fired late").toBeLessThan(5.2);
  });

  it("uses the ladder's own ramp when a map authors no timer", () => {
    // 60s minus 10 per ten levels: level 14 gets 50. A map left to idle must
    // fail there, not run forever.
    expect(getMapTimeLimit(board, 14)).toBe(50);
    const at = livesDockedAt(board, 14, 53);
    expect(at.some(s => s >= 50 && s < 50.2), `expected a life at 50s, got ${JSON.stringify(at)}`).toBe(true);
  });

  it("leaves the tutorial band alone", () => {
    // Levels 1-3 are exempt by design, and a harness that invented a deadline
    // for them would report losses on maps that cannot lose that way.
    const l1 = LADDER.find(l => l.level === 1)!;
    expect(getMapTimeLimit(l1, 1)).toBeNull();
    expect(livesDockedAt(l1, 1, 20)).toEqual([]);
  });
});
