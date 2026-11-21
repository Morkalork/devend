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
import { fireSlingFence, isLoadedSling, slingShape } from "@/lib/physics/slingFence";
import type { CanvasGameState } from "@/types/gameState";
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

describe("the fence payoffs", () => {
  it("Crash Barrier: a Guardrail holds more shields, and no other fence gains one", async () => {
    const { isArmedGuardrail } = await import("@/lib/physics/guardrailFence");
    const game = { guardrailShieldsUsed: 1, guardrailExtraShields: 0 } as never as Parameters<typeof isArmedGuardrail>[0];
    expect(isArmedGuardrail(game, "guardrail")).toBe(false);
    game.guardrailExtraShields = 2;
    expect(isArmedGuardrail(game, "guardrail")).toBe(true);
    game.guardrailShieldsUsed = 3;
    expect(isArmedGuardrail(game, "guardrail")).toBe(false);
    game.guardrailShieldsUsed = 0;
    expect(isArmedGuardrail(game, "standard")).toBe(false);
    expect(isArmedGuardrail(game, "ice")).toBe(false);
  });

  it("is dealt to the board at map start", () => {
    try {
      installClock();
      setRunSeedText("payoffs");
      const ctx = createBotGame(byLevel(LADDER, 8)!, 8, plainModifiers({ guardrailExtraShields: 2, fenceExtraHits: 2 }));
      expect(ctx.game.guardrailExtraShields).toBe(2);
      expect(ctx.game.fenceExtraHits).toBe(2);
    } finally {
      releaseClock();
    }
  });

  it("Tensioned Wire: only a fence with a hit budget gets more of it", () => {
    const cut = src("lib/physics/applyCut.ts");
    expect(cut).toMatch(/if \(ownHits != null\) \{[\s\S]{0,160}const hits = ownHits \+ \(game\.fenceExtraHits \?\? 0\);/);
  });

  it("Afterburner: one Flare bounce is enough to run hot, and the bonus multiplies the lock", async () => {
    const { FAST_LOCK_FACTOR } = await import("@/lib/gameConstants");
    const fences = (await import("js-yaml")).default.load(
      readFileSync(resolve(__dirname, "../../public/fences.yml"), "utf8")) as { fences: { id: string; ballSpeedStep?: number }[] };
    const balls = (await import("js-yaml")).default.load(
      readFileSync(resolve(__dirname, "../../public/balls.yml"), "utf8")) as { balls: { id: string; baseSpeed: number }[] };
    const step = fences.fences.find(f => f.id === "flare")!.ballSpeedStep!;
    const red = balls.balls.find(b => b.id === "red")!;
    expect((red.baseSpeed + step) / red.baseSpeed).toBeGreaterThanOrEqual(FAST_LOCK_FACTOR);
    expect(FAST_LOCK_FACTOR).toBeGreaterThan(1);
    const lock = src("lib/physics/checkBallWonState.ts");
    // Read from the speed taken BEFORE the lock stops the ball: `speed` is 0 by the payout.
    expect(lock).toMatch(/ball\.lockedAtSpeed = ball\.speed;\s*ball\.velocity = \{ x: 0, y: 0 \};/);
    expect(lock).toMatch(/\(b\.lockedAtSpeed \?\? 0\) >= b\.baseSpeed \* FAST_LOCK_FACTOR/);
    expect(lock).toMatch(/mult \* frozenMult \* gravityMult \* fastMult \* lampMult/);
  });
});

describe("Hot Reload", () => {
  // Two segments of one Redeploy cut, and a ball standing in front of them.
  const slingBoard = (extra: number) => {
    const a = { id: "a", cutId: "cut-1", fenceTypeId: "redeploy", start: { x: 100, y: 300 }, end: { x: 200, y: 300 }, thickness: 6 } as unknown as Wall;
    const b = { id: "b", cutId: "cut-1", fenceTypeId: "redeploy", start: { x: 200, y: 300 }, end: { x: 300, y: 300 }, thickness: 6 } as unknown as Wall;
    const ball = { id: "ball", state: "active", position: { x: 150, y: 260 }, velocity: { x: 0, y: 0 }, speed: 0, baseSpeed: 250 } as unknown as Ball;
    const game = { walls: [a, b], balls: [ball], slingExtraThrows: extra } as unknown as CanvasGameState;
    // A pull straight down, so the throw goes up, at the ball.
    const shape = slingShape(a, { x: 0, y: 120 })!;
    return { a, b, ball, game, shape };
  };

  it("is dealt to the board at map start, and off without the card", () => {
    try {
      installClock();
      setRunSeedText("hot-reload");
      const on = createBotGame(byLevel(LADDER, 8)!, 8, plainModifiers({ slingExtraThrows: 1 }));
      expect(on.game.slingExtraThrows).toBe(1);
      const off = createBotGame(byLevel(LADDER, 8)!, 8, plainModifiers());
      expect(off.game.slingExtraThrows).toBe(0);
    } finally {
      releaseClock();
    }
  });

  it("without it a Redeploy cut is spent by its one throw, every segment together", () => {
    const { a, b, game, shape } = slingBoard(0);
    expect(shape).toBeTruthy();
    expect(fireSlingFence(game, a, shape)).toBe(true);
    expect(isLoadedSling(a)).toBe(false);
    expect(isLoadedSling(b)).toBe(false);
  });

  it("with it the cut throws once more before it is spent", () => {
    const { a, b, ball, game, shape } = slingBoard(1);
    expect(fireSlingFence(game, a, shape)).toBe(true);
    expect(isLoadedSling(a)).toBe(true);
    expect(isLoadedSling(b)).toBe(true);
    // The ball is back in front of the fence for the second throw.
    ball.position = { x: 150, y: 260 };
    expect(fireSlingFence(game, b, shape)).toBe(true);
    expect(isLoadedSling(a)).toBe(false);
    expect(isLoadedSling(b)).toBe(false);
  });

  it("is a card in the draft catalogue that pays off the Redeploy fence", () => {
    const cards = src("../public/cards.yml");
    expect(cards).toMatch(/- id: hot_reload\n {2}paysOff: \[rolling_redeploy\]/);
    expect(cards).toMatch(/slingExtraThrows: 1/);
  });
});
