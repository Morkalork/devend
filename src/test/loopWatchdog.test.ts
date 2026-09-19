/**
 * The two halves of "the map just does nothing and I end up stuck with no post
 * map menu", reported twice from level 13.
 *
 * The engine was ruled out first, and is ruled out here permanently: the bot
 * sweep now fails a run whose map is won on paper while nothing has been
 * declared (winNotShipped, wired into runBot). What was left is the browser
 * loop, which the harness does not model at all - five exits that stop
 * scheduling rAF, each handing the obligation to restart it to different code.
 *
 * So: the watchdog's predicate, and the per-map reset gap that could arm the
 * worst of those five on a board the player had not even begun.
 */
import { describe, it, expect } from "vitest";
import {
  loopHoldReason, loopNeedsRestart, holdFlagsOf, DEAD_AFTER_MS, type HoldFlags,
} from "@/lib/loopWatchdog";
import { winNotShipped, WIN_SHIP_GRACE_FRAMES, HARD_RULES } from "@/lib/bot/invariants";
import { runBot } from "@/lib/bot/runBot";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";
import { ENGINE_MAPS } from "./fixtures/maps";
import { recordLoopHealth, loopHealthLine, HOLD_STUCK_MS } from "@/lib/rendering/perfStats";

const RUNNING: HoldFlags = {
  paused: false, gameOver: false, levelComplete: false,
  pushMode: "none", pushPromptPending: false,
};

describe("what may legitimately stop the loop", () => {
  it("nothing, on an ordinary playing frame", () => {
    expect(loopHoldReason(RUNNING)).toBeNull();
  });

  it("names each hold, in the order the loop's own guards ask", () => {
    expect(loopHoldReason({ ...RUNNING, paused: true })).toBe("paused");
    expect(loopHoldReason({ ...RUNNING, gameOver: true })).toBe("gameOver");
    expect(loopHoldReason({ ...RUNNING, pushMode: "prompt" })).toBe("pushPrompt");
    expect(loopHoldReason({ ...RUNNING, levelComplete: true })).toBe("levelComplete");
    expect(loopHoldReason({ ...RUNNING, pushPromptPending: true })).toBe("pushPromptPending");
  });

  it("does not count a push in progress: that is ordinary play", () => {
    // The HUD changes, the loop does not. A hold here would freeze the board
    // for the whole push, which is the part of the map you are betting on.
    expect(loopHoldReason({ ...RUNNING, pushMode: "pushing" })).toBeNull();
  });

  it("a finished map outranks the pause flag, as the loop's first guard does", () => {
    // The loop's paused guard reads `paused && !levelComplete && !gameOver`,
    // so a completed level keeps running its lock and shimmer animations even
    // with a modal up. Reading it the other way would have the watchdog
    // restart a loop that parks itself again on the very next frame.
    expect(loopHoldReason({ ...RUNNING, paused: true, levelComplete: true })).toBe("levelComplete");
    expect(loopHoldReason({ ...RUNNING, paused: true, gameOver: true })).toBe("gameOver");
  });
});

describe("the watchdog restarts a dead loop and nothing else", () => {
  const now = 100_000;

  it("restarts a loop that has stopped being called with nothing holding it", () => {
    expect(loopNeedsRestart(RUNNING, now - DEAD_AFTER_MS - 1, now)).toBe(true);
  });

  it("leaves a merely slow loop alone", () => {
    // 200ms between frames is 5fps: a bad phone, not a dead loop.
    expect(loopNeedsRestart(RUNNING, now - 200, now)).toBe(false);
  });

  it("never fights a hold that is still in force", () => {
    const longDead = now - DEAD_AFTER_MS * 10;
    for (const f of [
      { ...RUNNING, paused: true },
      { ...RUNNING, gameOver: true },
      { ...RUNNING, levelComplete: true },
      { ...RUNNING, pushMode: "prompt" as const },
      { ...RUNNING, pushPromptPending: true },
    ]) {
      expect(loopNeedsRestart(f, longDead, now), loopHoldReason(f) ?? "?").toBe(false);
    }
  });

  it("waits for a map that has not started yet", () => {
    // 0 is "the loop has never run", which is a board still being built.
    expect(loopNeedsRestart(RUNNING, 0, now)).toBe(false);
  });

  it("reads its flags off the live game state", () => {
    const game = {
      paused: false, gameOver: false, levelComplete: false,
      pushMode: "prompt", pushPromptPending: false,
    } as unknown as CanvasGameState;
    expect(holdFlagsOf(game).pushMode).toBe("prompt");
    expect(loopHoldReason(holdFlagsOf(game))).toBe("pushPrompt");
  });
});

describe("a map that is won and has not said so is a defect", () => {
  it("tolerates the win landing and the ending being declared just after", () => {
    expect(winNotShipped(true, 1)).toBeNull();
    expect(winNotShipped(true, WIN_SHIP_GRACE_FRAMES)).toBeNull();
  });

  it("reports a map still sitting on its win a second later", () => {
    const v = winNotShipped(true, WIN_SHIP_GRACE_FRAMES + 1);
    expect(v?.rule).toBe("won-not-shipped");
    expect(v?.detail).toContain("has not ended");
  });

  it("says nothing about a map that is not won", () => {
    expect(winNotShipped(false, 9999)).toBeNull();
  });

  it("counts as a defect, not a lead: a sweep must fail on it", () => {
    expect(HARD_RULES.has("won-not-shipped")).toBe(true);
  });
});

describe("the map the reports came from", () => {
  it("never sits on a won level 13", () => {
    // The map both reports name. If the engine were holding a met win here,
    // this is where it would show; it does not, which is what sent the
    // investigation to the browser loop rather than back to the win gate.
    const l13 = (ENGINE_MAPS as LevelConfig[]).find(l => l.level === 13)!;
    for (const seed of [1, 2, 5]) {
      const r = runBot(l13, 13, seed, { maxFrames: 9000 });
      expect(
        r.violations.map(v => v.rule),
        `level 13 seed ${seed} ended at ${r.remainingPercent}% after ${r.cuts} cuts`,
      ).not.toContain("won-not-shipped");
    }
  }, 120000);
});

describe("a map starts with no push in force", () => {
  it("clears pushMode where it clears the rest of the per-map flags", () => {
    // Source-shape, because this is a reset block in a component effect and
    // the property is "it is in the block", not a value any call returns.
    // pushMode was the one flag of its family the block forgot, and inheriting
    // "prompt" parks the loop on the new map's first frame with no modal over
    // it - a dead board reached without the player doing anything at all.
    const src = readFileSync(resolve(process.cwd(), "src/components/game/GameCanvas.tsx"), "utf8");
    const at = src.indexOf("game.pushPromptPending = false;");
    expect(at, "the per-map reset block moved").toBeGreaterThan(-1);
    const block = src.slice(at, at + 1200);
    expect(block, "pushMode is not reset with its siblings").toContain('game.pushMode = "none";');
    expect(block, "React's mirror of pushMode is not reset with it").toContain('setPushMode("none");');
    expect(block, "the loop heartbeat is not reset with them").toContain("game.loopFrameAt = 0;");
  });
});

describe("a stalled board can say what it was doing", () => {
  it("puts the loop's state on the perf HUD, which screenshots", () => {
    // The only channel a stall reported from play has ever reached this
    // codebase through is a photo of a phone. Three reports arrived that way
    // and none of them could name the cause.
    recordLoopHealth(null, 0, 1200, 1);
    expect(loopHealthLine()).toBe("loop  - 0.0s  stale 1200ms  x1");
    recordLoopHealth("pushPrompt", 400, 16, 0);
    expect(loopHealthLine()).toBe("loop  pushPrompt 0.4s  stale 16ms  x0");
  });

  it("calls out a hold that has outlasted every animation it could be", () => {
    // The shape of the freeze that three reports could not name: the loop
    // running perfectly - 16ms since the last frame, no restarts - while the
    // hold it is in never ends. Without the hold's AGE on the line there is
    // nothing on the readout to notice.
    recordLoopHealth("levelComplete", HOLD_STUCK_MS + 1, 16, 0);
    expect(loopHealthLine()).toContain("STUCK");
    recordLoopHealth("levelComplete", 2000, 16, 0);
    expect(loopHealthLine()).not.toContain("STUCK");
  });
});
