/**
 * The physics step hands the renderer the scene a stuck ball is stuck to.
 *
 * Through the real headless game, because the timing is the point: the scene
 * is captured on the step AFTER the stick, once every collision of the sticking
 * step has finished moving the ball, and it is built around where the ball
 * actually rests. A scene captured mid-step, before an obstacle's edge walls
 * had pushed the ball clear of its polygon, put the contact point inside the
 * wall and the splat three units short of the surface.
 */
import { describe, it, expect } from "vitest";
import { createBotGame, stepBot, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import { setRunSeedText } from "@/lib/runRng";
import { insideSolid } from "@/lib/splatScene";
import type { LevelConfig } from "@/types/level";

const BOARD: LevelConfig = {
  id: "splat-scene-board", level: 7, sizeThreshold: 30, expectedCuts: 4,
  points: 5, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1, entities: [],
} as unknown as LevelConfig;

describe("splat scene capture", () => {
  it("is pending on the step the ball sticks and captured on the next, around the resting point", () => {
    setRunSeedText("splat-scene-probe");
    releaseClock();
    installClock();
    const ctx = createBotGame(BOARD, 7, plainModifiers({ bugSquashChance: 100, bugSquashSeconds: 2 }));
    const ball = ctx.game.balls[0];
    expect(ball.splatScene).toBeUndefined();

    let stuckAt = -1;
    for (let f = 0; f < 8 / PHYSICS_STEP; f++) {
      stepBot(ctx, PHYSICS_STEP);
      const now = performance.now();
      const stuck = ball.bugSquashUntil !== undefined && now < ball.bugSquashUntil;
      if (stuck && stuckAt < 0) {
        stuckAt = f;
        // The step that stuck it: pending, not yet built.
        expect(ball.splatScene).toBeNull();
      } else if (stuckAt >= 0 && f === stuckAt + 1) {
        // The very next step: built.
        expect(ball.splatScene).not.toBeNull();
        expect(ball.splatScene).toBeDefined();
        const scene = ball.splatScene!;
        // Stuck to the board edge: the outside of the board is in the scene.
        expect(scene.solids.length).toBeGreaterThan(0);
        expect(scene.samples.length).toBeGreaterThan(20);
        // The contact point is on a surface, never inside one.
        for (const solid of scene.solids) expect(insideSolid(0, -0.05, solid)).toBe(false);
        // And there is a surface right at the contact.
        const nearest = Math.min(...scene.samples.map(q => Math.hypot(q.x, q.y)));
        expect(nearest).toBeLessThan(ball.radius * 0.2);
        break;
      }
    }
    expect(stuckAt, "the ball never stuck").toBeGreaterThan(0);
  });

  it("a second stick starts a fresh capture", () => {
    setRunSeedText("splat-scene-probe-2");
    releaseClock();
    installClock();
    const ctx = createBotGame(BOARD, 7, plainModifiers({ bugSquashChance: 100, bugSquashSeconds: 0.5 }));
    const ball = ctx.game.balls[0];
    const scenes: object[] = [];
    let wasStuck = false;
    for (let f = 0; f < 20 / PHYSICS_STEP && scenes.length < 2; f++) {
      stepBot(ctx, PHYSICS_STEP);
      const now = performance.now();
      const stuck = ball.bugSquashUntil !== undefined && now < ball.bugSquashUntil;
      if (stuck && !wasStuck) expect(ball.splatScene).toBeNull();
      if (stuck && wasStuck && ball.splatScene && !scenes.includes(ball.splatScene)) scenes.push(ball.splatScene);
      wasStuck = stuck;
    }
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).not.toBe(scenes[1]);
  });
});
