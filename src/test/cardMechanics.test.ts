/**
 * The two mechanics the draft catalogue added (CARDS_PLAN.md):
 *  - Permafrost: an Ice fence freezes the ball it slows;
 *  - Thaw Cycle: every lock hands back a Feature Freeze tap.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBotGame, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { applyFenceSpeedStep, fenceSlows } from "@/lib/physics/fenceTouch";
import { setRunSeedText } from "@/lib/runRng";
import type { Ball } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";
import { LADDER, byLevel } from "./fixtures/maps";

const src = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");
const wall = (fenceTypeId?: string) => ({ id: "w", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 6, fenceTypeId }) as unknown as Wall;

describe("Permafrost", () => {
  it("is dealt to the board at map start, and off without the card", () => {
    try {
      installClock();
      setRunSeedText("permafrost");
      const on = createBotGame(byLevel(LADDER, 8)!, 8, plainModifiers({ iceFreezeSeconds: 2 }));
      expect(on.game.iceFreezeSeconds).toBe(2);
      const off = createBotGame(byLevel(LADDER, 8)!, 8, plainModifiers());
      expect(off.game.iceFreezeSeconds).toBe(0);
    } finally {
      releaseClock();
    }
  });

  it("acts on Ice only: the fence that takes speed off", () => {
    expect(fenceSlows(wall("ice"))).toBe(true);
    expect(fenceSlows(wall("flare"))).toBe(false);
    expect(fenceSlows(wall("standard"))).toBe(false);
    expect(fenceSlows(wall())).toBe(false);
  });

  it("freezes on a real slow, never on a ball already at its floor", () => {
    const ball = { velocity: { x: 200, y: 0 }, speed: 200, baseSpeed: 200, minimumSpeed: 100 } as unknown as Ball;
    expect(applyFenceSpeedStep(ball, wall("ice"), 1000)).toBe(true);
    const floored = { velocity: { x: 100, y: 0 }, speed: 100, baseSpeed: 200, minimumSpeed: 100 } as unknown as Ball;
    expect(applyFenceSpeedStep(floored, wall("ice"), 1000)).toBe(false);
    // The freeze rides on that answer, and leaves the usual thaw cooldown.
    const updateBall = src("lib/physics/updateBall.ts");
    expect(updateBall).toMatch(/const stepped = applyFenceSpeedStep\(ball, wall, now\);/);
    expect(updateBall).toMatch(/stepped && \(game\.iceFreezeSeconds \?\? 0\) > 0 && fenceSlows\(wall\)/);
    expect(updateBall).toMatch(/ball\.freezeReadyAt = now \+ ms \* \(1 \+ FREEZE_COOLDOWN_MULTIPLIER\);/);
  });
});

describe("Thaw Cycle", () => {
  it("hands freeze taps back on a lock, and the HUD's count follows", () => {
    const lock = src("lib/physics/checkBallWonState.ts");
    expect(lock).toMatch(/if \(activeModifiers\.freezeUsesPerLock > 0\) \{\s*game\.freezeUsesRemaining = \(game\.freezeUsesRemaining \?\? 0\)/);
    const canvas = src("components/game/GameCanvas.tsx");
    expect(canvas).toMatch(/setFreezeUsesRemaining\(gameRef\.current\.freezeUsesRemaining \?\? 0\);/);
  });
});
