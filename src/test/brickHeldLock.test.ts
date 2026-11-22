/**
 * A ball and a brick in one pocket do not lock (BRICKS_PLAN.md).
 *
 * Reported from play on the brick ladder's map 2. Three rules, each pinned:
 *
 *  1. A pocket that holds a standing brick is refused as a lock, whatever the
 *     win asks for: the lock would bury the brick.
 *  2. It locks when its last brick breaks, with no further fence.
 *  3. A fence that would lock the last free ball away from bricks the win
 *     still owes is refused. That one used to land: the ball ended in a sliver
 *     beside the bricks, inside their striking reach, so they read as
 *     reachable; the ball locked and the map ended as locked out. Over 150
 *     bot runs on map 2 that was 17 map-ending locks; it is none.
 */
import { describe, it, expect } from "vitest";
import { createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { planCut, seededRandom } from "@/lib/bot/policy";
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

describe("map 2 never ends on a lock", () => {
  it("is not locked out by any fence, over 60 runs of careless cutting", () => {
    const ends: Record<string, number> = {};
    for (let seed = 1; seed <= 60; seed++) {
      installClock();
      setRunSeedText(`careless-${seed}`);
      try {
        const ctx = createBotGame(MAP2, 2, plainModifiers(), { lives: 9 });
        const rng = seededRandom(seed);
        let end = "clock";
        for (let f = 0; f < 120 * 30; f++) {
          if (f % 30 === 0 && ctx.game.activeWalls.length === 0) {
            const plan = planCut(ctx.game, rng, 0.8, false);
            if (plan) {
              tryCut(ctx, plan.origin, plan.direction);
            }
          }
          stepBot(ctx);
          if (ctx.game.gameOver || ctx.game.levelComplete) {
            end = ctx.game.levelComplete ? "win" : String(ctx.game.failure?.kind);
            break;
          }
        }
        ends[end] = (ends[end] ?? 0) + 1;
      } finally {
        releaseClock();
      }
    }
    // The lock-caused ending, which was 9 of these 60 before the fix.
    expect(ends.lockedOut ?? 0).toBe(0);
    // One run in these 60 still buries a brick, and not by a lock: the capture
    // pass keeps a ball-less strip beside the block while a narrow gap reads as
    // passable, and drops it when a neighbouring brick goes (BRICKS_PLAN.md,
    // open). Held at that one, so it cannot quietly grow.
    expect(ends.objectiveBuried ?? 0).toBeLessThanOrEqual(1);
    expect(ends.win ?? 0).toBeGreaterThan(10);
  });
});
