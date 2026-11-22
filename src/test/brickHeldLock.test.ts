/**
 * A ball and a brick in one pocket do not lock (BRICKS_PLAN.md).
 *
 * Reported from play on the brick ladder's map 2. Each rule pinned:
 *
 *  1. A pocket that holds a standing brick is refused as a lock, whatever the
 *     win asks for: the lock would bury the brick.
 *  2. It locks when its last brick breaks, with no further fence.
 *  3. Fencing a ball off from the bricks is allowed. Its pocket has no brick
 *     in it, so it locks. (A refusal for that fence was tried and taken back:
 *     where a fence may go is the player's call.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { regionHoldsStandingBrick } from "@/lib/physics/smashReach";
import { findGridRegions, buildGridRegionMap, findGridRegionForBall } from "@/lib/spaceGrid";
import { setRunSeedText } from "@/lib/runRng";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import { LADDER, byLevel } from "./fixtures/maps";

const MAP2 = byLevel(LADDER, 2) as LevelConfig;
/** Map 2's board with a win that is NOT the bricks, so a lock can outlive them. */
const LOCK_WIN: LevelConfig = { ...MAP2, id: "brick-held-lock", timeLimit: 120, win: { require: [{ kind: "locks", count: 1 }] } } as LevelConfig;

const standing = (g: CanvasGameState) => (g.destructibles ?? []).filter(d => !d.destroyed).length;

function pocketOf(g: CanvasGameState, x: number, y: number): number[] | null {
  const regions = findGridRegions(g.spaceGrid!);
  return findGridRegionForBall(g.spaceGrid!, buildGridRegionMap(regions), x, y)?.cellIndices ?? null;
}

/**
 * Both balls held still (a long Cold Boot), one set down beside the bricks and
 * one far away, then four fences drawn into a box around the block: a pocket
 * holding one ball and all nine bricks, small enough to lock (the lock size is
 * widened: with two balls loose a pocket locks at 5% of the board, and a box
 * that clears the bricks is 11%).
 */
function boxedIn() {
  installClock();
  setRunSeedText("brick-held");
  const ctx = createBotGame(LOCK_WIN, 2, plainModifiers({ lockThresholdBonus: 20, spawnFreezeSeconds: 9999 }), { lives: 9 });
  const g = ctx.game;
  const [inside, outside] = g.balls;
  inside.position = { x: 450, y: 370 };
  outside.position = { x: 150, y: 150 };
  const cuts = [
    { o: { x: 300, y: 450 }, d: { x: 0, y: 1 } }, { o: { x: 600, y: 450 }, d: { x: 0, y: 1 } },
    { o: { x: 450, y: 330 }, d: { x: 1, y: 0 } }, { o: { x: 450, y: 570 }, d: { x: 1, y: 0 } },
  ];
  for (const cut of cuts) {
    expect(tryCut(ctx, cut.o, cut.d)).toBe(true);
    for (let n = 0; g.activeWalls.length > 0 && n < 2000; n++) {
      stepBot(ctx);
    }
  }
  return { ctx, g, inside };
}

describe("a pocket with a ball and a brick", () => {
  it("does not lock while a brick in it stands, and says a lock is waiting", () => {
    try {
      const { g, inside } = boxedIn();
      expect(standing(g)).toBe(9);
      expect(regionHoldsStandingBrick(g, pocketOf(g, inside.position.x, inside.position.y)!)).toBe(true);
      expect(g.lockedBallsCount).toBe(0);
      expect(inside.state).toBe("active");
      expect(g.brickHeldLocks).toBe(true);
    } finally {
      releaseClock();
    }
  });

  it("locks when its last brick breaks, with no fence being drawn", () => {
    try {
      const { ctx, g, inside } = boxedIn();
      // Let the boxed ball loose on the bricks.
      inside.frozenUntil = 0;
      inside.velocity = { x: 120, y: 160 };
      inside.speed = 200;
      let standingBeforeLock = -1;
      let fencesGrowingAtLock = -1;
      for (let f = 0; f < 120 * 120 && g.lockedBallsCount === 0; f++) {
        const before = standing(g);
        const growing = g.activeWalls.length;
        stepBot(ctx);
        if (g.lockedBallsCount > 0) {
          standingBeforeLock = before;
          fencesGrowingAtLock = growing;
        }
        // Never a lock while a brick is left in the pocket.
        if (standing(g) > 0) {
          expect(g.lockedBallsCount).toBe(0);
        }
      }
      expect(g.lockedBallsCount).toBe(1);
      expect(inside.state).toBe("won");
      // The frame the last brick went: one left before it, none after, no cut in flight.
      expect(standingBeforeLock).toBe(1);
      expect(standing(g)).toBe(0);
      expect(fencesGrowingAtLock).toBe(0);
    } finally {
      releaseClock();
    }
  });
});

describe("the brick's own pocket, by body and not by reach", () => {
  it("holds for the pocket the bricks are in, and not for an empty corner", () => {
    installClock();
    setRunSeedText("body");
    try {
      const ctx = createBotGame(MAP2, 2, plainModifiers());
      const g = ctx.game;
      const whole = pocketOf(g, 100, 100)!;
      expect(regionHoldsStandingBrick(g, whole)).toBe(true);
      // A handful of cells in the far corner are nowhere near a brick.
      expect(regionHoldsStandingBrick(g, whole.slice(0, 20))).toBe(false);
      // No bricks standing, nothing to hold a lock for.
      for (const d of g.destructibles ?? []) {
        d.destroyed = true;
      }
      expect(regionHoldsStandingBrick(g, whole)).toBe(false);
    } finally {
      releaseClock();
    }
  });
});

describe("fencing a ball off from the bricks", () => {
  it("is allowed: no fence is refused for the lock it would cause", () => {
    // Tried and taken back at the owner's word. A refusal that predicted the
    // lock a fence would cause stopped the player fencing a ball off beside
    // the bricks, and that is theirs to do: the lock rule is about what is IN
    // the pocket, not about where the fence may go. The older refusal stays
    // (a cut that buries owed bricks where no ball can reach them at all).
    const reach = readFileSync(resolve(__dirname, "../lib/physics/smashReach.ts"), "utf8");
    expect(reach).not.toMatch(/ballsLeftAfterLocks/);
    const refusal = reach.slice(reach.indexOf("export function cutWouldBurySmashes"));
    expect(refusal).toMatch(/const probe = \{ \.\.\.game, spaceGrid: after \} as CanvasGameState;/);
  });

  it("locks a ball whose pocket has no brick in it, bricks next door or not", () => {
    // Both balls held still; one fence walls the left third off with a ball in
    // it and no brick. That pocket is lock-sized (widened here) and empty of
    // bricks, so it locks at once: the bricks are the other pocket's business.
    installClock();
    setRunSeedText("fenced-off");
    try {
      const ctx = createBotGame(LOCK_WIN, 2, plainModifiers({ lockThresholdBonus: 60, spawnFreezeSeconds: 9999 }), { lives: 9 });
      const g = ctx.game;
      const [alone, withBricks] = g.balls;
      alone.position = { x: 150, y: 450 };
      withBricks.position = { x: 450, y: 250 };
      expect(tryCut(ctx, { x: 280, y: 450 }, { x: 0, y: 1 })).toBe(true);
      for (let n = 0; g.activeWalls.length > 0 && n < 2000; n++) {
        stepBot(ctx);
      }
      expect(alone.state).toBe("won");
      expect(withBricks.state).toBe("active");
      expect(standing(g)).toBe(9);
    } finally {
      releaseClock();
    }
  });
});
