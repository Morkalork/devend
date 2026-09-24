/**
 * A ball passes through a phasing wall while it is phased out.
 *
 * Reported from play on level 16: balls never went through a phasing object.
 * Both collision systems already skipped a phased-out obstacle; what stopped
 * the ball was the region containment check after them. An obstacle's
 * footprint is subtracted from the playable space, so a ball part-way through
 * one is in no region at all, and the escape recovery put it straight back out
 * the side it came in. From the seat that is indistinguishable from the wall
 * being solid. Membranes and ball-type gates hit exactly this when they were
 * built and were given a transit exemption; phasing never was.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  createBotGame, stepBot, plainModifiers, installClock, releaseClock,
} from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";

afterEach(() => releaseClock());

const WALL_X = 440, WALL_W = 26;

// Level 3 never rotates, so the wall is where the fixture says.
const level = (): LevelConfig => ({
  id: "phase-test", level: 3, name: "P", sizeThreshold: 10, expectedCuts: 4,
  points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1, bugChance: 0,
  entities: [{
    id: "ghost", kind: "wall", shape: "rect", x: WALL_X, y: 250, width: WALL_W, height: 400,
    isPhasing: true, phaseCycleSeconds: 100,
  }],
} as unknown as LevelConfig);

/** Fire the one ball straight at the wall with the wall held in `phase`. */
function fire(phase: "in" | "out"): number {
  releaseClock();
  setRunSeedText("phase-pass");
  installClock();
  const ctx = createBotGame(level(), 3, plainModifiers());
  // Let the launch settle first: the opening frames deal the ball its own
  // heading, which would overwrite the one set below.
  for (let i = 0; i < 30; i++) stepBot(ctx);
  const game = ctx.game as unknown as CanvasGameState;
  const ghost = game.phasingObjects[0];
  // A 100 s cycle: 0.75 of the way in is the middle of the fully-out stretch,
  // and 0.1 is the middle of the solid one. Either holds for the whole test.
  ghost.startedAt = game.activePlaySeconds - (phase === "out" ? 75 : 10);
  // Already in that phase, so the blink-out shockwave (which flings nearby
  // balls away from the wall on purpose) does not fire on the first frame.
  ghost.phase = phase;
  ghost.firedOutAt = phase === "out" ? game.activePlaySeconds : undefined;
  const [ball] = game.balls;
  ball.position = { x: 300, y: 450 };
  ball.prevPosition = { x: 300, y: 450 };
  ball.velocity = { x: 220, y: 0 };
  ball.speed = 220;
  for (let i = 0; i < 180; i++) stepBot(ctx); // 1.5 s at 120 Hz
  expect(ghost.phase).toBe(phase);
  return ball.position.x;
}

describe("a phasing wall", () => {
  it("lets a ball through while it is phased out", () => {
    expect(fire("out")).toBeGreaterThan(WALL_X + WALL_W);
  });

  it("still stops a ball while it is solid", () => {
    expect(fire("in")).toBeLessThan(WALL_X);
  });
});
