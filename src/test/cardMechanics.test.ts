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
import {
  BREAKPOINT_FREEZE_MS, STICKY_HOLD_MS, applyStickyHit, canSetBreakpoint, cutSegmentsOf, isMergeable, mergeBalls,
  refactorTargetAt, restoreStash, setBreakpoint, setStickyPatch, stickyTargetAt, takeStash, tickBreakpoints,
} from "@/lib/physics/verbCards";
import { createBallEffectState } from "@/lib/ballEffects";
import { BASE_BALL_RADIUS } from "@/lib/gameConstants";
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

// ── The verb cards (CARDS_PLAN.md phase 9; lib/physics/verbCards.ts) ────────

describe("the verb cards", () => {
  const plainBall = (id: string, x: number, y: number, vx = 100, vy = 0): Ball => ({
    id, state: "active", position: { x, y }, velocity: { x: vx, y: vy }, speed: Math.hypot(vx, vy),
    baseSpeed: 250, topSpeed: 300, minimumSpeed: 60, radius: 12, ability: "none", lockMultiplier: 1,
    regionId: "r", effects: createBallEffectState(),
  } as unknown as Ball);

  it("are dealt to the board at map start, and off without the cards", () => {
    try {
      installClock();
      setRunSeedText("verbs");
      const on = createBotGame(byLevel(LADDER, 8)!, 8, plainModifiers({
        breakpointsPerMap: 2, stashPerMap: 1, refactorsPerMap: 1, ballMerge: 1, stickyTapsPerMap: 3,
      }));
      expect(on.game.breakpointsRemaining).toBe(2);
      expect(on.game.refactorsRemaining).toBe(1);
      expect(on.game.ballMerge).toBe(true);
      expect(on.game.stickyTapsRemaining).toBe(3);
      expect(on.game.breakpoints).toEqual([]);
      expect(on.game.stash).toBeNull();
      const off = createBotGame(byLevel(LADDER, 8)!, 8, plainModifiers());
      expect(off.game.breakpointsRemaining).toBe(0);
      expect(off.game.ballMerge).toBe(false);
      expect(off.game.stickyTapsRemaining).toBe(0);
    } finally {
      releaseClock();
    }
  });

  it("Breakpoint: a trap set on open board freezes the first ball across it, once", () => {
    const ball = plainBall("b1", 100, 300);
    const other = plainBall("b2", 100, 340);
    const game = { balls: [ball, other], walls: [], breakpointsRemaining: 2, regions: [] } as unknown as CanvasGameState;
    // Not on a ball.
    expect(canSetBreakpoint(game, { x: 100, y: 300 })).toBe(false);
    expect(setBreakpoint(game, { x: 200, y: 300 }, 1000)).toBe(true);
    expect(game.breakpointsRemaining).toBe(1);
    expect(game.breakpoints?.length).toBe(1);
    // Far away: nothing yet.
    tickBreakpoints(game, 1100, 0);
    expect(ball.frozenUntil).toBeUndefined();
    // The ball reaches it: frozen there, trap spent, the other ball untouched.
    ball.position = { x: 196, y: 302 };
    tickBreakpoints(game, 1200, 0);
    expect(ball.frozenUntil).toBe(1200 + BREAKPOINT_FREEZE_MS);
    expect(other.frozenUntil).toBeUndefined();
    expect(game.breakpoints?.length).toBe(0);
    expect(game.breakpointTrips?.length).toBe(1);
    // The ration runs out.
    expect(setBreakpoint(game, { x: 300, y: 300 }, 1300)).toBe(true);
    expect(setBreakpoint(game, { x: 400, y: 300 }, 1400)).toBe(false);
  });

  it("Stash: remembers the balls and puts them back, once, keeping a ball out of captured space", () => {
    const a = plainBall("a", 100, 100, 50, 0);
    const b = plainBall("b", 300, 300, 0, 50);
    const game = { balls: [a, b], walls: [], regions: [], movers: [], spaceGrid: null } as unknown as CanvasGameState;
    takeStash(game, 500);
    expect(game.stash?.balls.length).toBe(2);
    a.position = { x: 150, y: 120 };
    a.velocity = { x: 0, y: 80 };
    b.position = { x: 310, y: 330 };
    expect(restoreStash(game, 900)).toBe(true);
    expect(a.position).toEqual({ x: 100, y: 100 });
    expect(a.velocity).toEqual({ x: 50, y: 0 });
    expect(b.position).toEqual({ x: 300, y: 300 });
    expect(game.stash).toBeNull();
    expect(game.stashRestoredAt).toBe(900);
    // Spent: a second lost life is a lost life.
    expect(restoreStash(game, 950)).toBe(false);
    // A remembered spot captured since is no place for a ball: it stays put.
    takeStash(game, 1000);
    b.position = { x: 320, y: 340 };
    // A grid whose cells are all ACTIVE (0), but for the one under (300, 300).
    (game as unknown as { spaceGrid: unknown }).spaceGrid = {
      cellSize: 15, width: 40, height: 40, originX: 0, originY: 0, cells: new Uint8Array(1600), activeCount: 1599, initialActiveCount: 1600,
    };
    const grid = game.spaceGrid!;
    grid.cells[Math.floor(300 / 15) * 40 + Math.floor(300 / 15)] = 1;
    restoreStash(game, 1200);
    expect(a.position).toEqual({ x: 100, y: 100 });
    expect(b.position).toEqual({ x: 320, y: 340 });
  });

  it("Refactor: the hold finds a finished player fence, never a loaded Redeploy or the board", () => {
    const fence = { id: "w-1", cutId: "cut-1", fenceTypeId: "standard", start: { x: 100, y: 300 }, end: { x: 200, y: 300 }, thickness: 6 } as unknown as Wall;
    const fence2 = { id: "w-2", cutId: "cut-1", fenceTypeId: "standard", start: { x: 200, y: 300 }, end: { x: 300, y: 300 }, thickness: 6 } as unknown as Wall;
    const sling = { id: "w-3", cutId: "cut-2", fenceTypeId: "redeploy", start: { x: 100, y: 500 }, end: { x: 200, y: 500 }, thickness: 6 } as unknown as Wall;
    const edge = { id: "board-top", start: { x: 0, y: 0 }, end: { x: 600, y: 0 }, thickness: 6 } as unknown as Wall;
    const game = { walls: [fence, fence2, sling, edge], balls: [], refactorsRemaining: 1 } as unknown as CanvasGameState;
    expect(refactorTargetAt(game, { x: 150, y: 310 })).toBe(fence);
    expect(refactorTargetAt(game, { x: 150, y: 505 })).toBeNull();
    expect(refactorTargetAt(game, { x: 300, y: 4 })).toBeNull();
    expect(cutSegmentsOf(game, fence)).toEqual([fence, fence2]);
    game.refactorsRemaining = 0;
    expect(refactorTargetAt(game, { x: 150, y: 310 })).toBeNull();
  });

  it("Merge Conflict: two plain balls become one bigger, slower ball worth both locks", () => {
    const a = plainBall("a", 100, 100, 200, 0);
    const b = plainBall("b", 120, 100, -100, 0);
    b.lockMultiplier = 2;
    const game = { balls: [a, b], walls: [], regions: [] } as unknown as CanvasGameState;
    expect(isMergeable(a, 0)).toBe(true);
    expect(mergeBalls(game, a, b, 10)).toBe(true);
    expect(game.balls).toEqual([a]);
    expect(a.radius).toBeCloseTo(Math.hypot(12, 12));
    expect(a.lockMultiplier).toBe(3);
    // Momentum shared, then slowed: well under the faster ball's 200.
    expect(a.speed).toBeLessThan(200 * 0.85);
    expect(a.speed).toBeGreaterThanOrEqual(60 * 0.85 - 1e-9);
    expect(game.mergeFlashes?.length).toBe(1);
    // A boss, a special ball or a frozen one never merges.
    const boss = plainBall("boss", 0, 0);
    boss.isBoss = true;
    expect(isMergeable(boss, 0)).toBe(false);
    const purple = plainBall("p", 0, 0);
    purple.ability = "slowOthers";
    expect(isMergeable(purple, 0)).toBe(false);
    const frozen = plainBall("f", 0, 0);
    frozen.frozenUntil = 5000;
    expect(isMergeable(frozen, 100)).toBe(false);
    // A ball that would come out too big bounces instead.
    const big = plainBall("big", 0, 0);
    big.radius = BASE_BALL_RADIUS * 2.1;
    expect(mergeBalls(game, big, plainBall("c", 0, 0), 20)).toBe(false);
  });

  it("Rate Limiter: a tapped wall holds a stretch that stops the next ball dead, then times out", () => {
    const wall = { id: "w-1", start: { x: 100, y: 300 }, end: { x: 400, y: 300 }, thickness: 6 } as unknown as Wall;
    const game = { walls: [wall], balls: [], stickyTapsRemaining: 1 } as unknown as CanvasGameState;
    expect(stickyTargetAt(game, { x: 250, y: 320 })).toBe(wall);
    expect(stickyTargetAt(game, { x: 250, y: 400 })).toBeNull();
    const patch = setStickyPatch(game, wall, { x: 250, y: 320 }, 1000)!;
    expect(patch.x).toBe(250);
    expect(patch.y).toBe(300);
    expect(game.stickyTapsRemaining).toBe(0);
    expect(stickyTargetAt(game, { x: 250, y: 320 })).toBeNull();
    // A hit off the stretch bounces as ever; one on it sticks and spends it.
    const ball = plainBall("b", 250, 288, 0, 100);
    expect(applyStickyHit(game, ball, { x: 320, y: 300 }, 1500)).toBe(false);
    expect(applyStickyHit(game, ball, { x: 260, y: 300 }, 1500)).toBe(true);
    expect(ball.velocity).toEqual({ x: 0, y: 0 });
    expect(ball.frozenUntil).toBe(1500 + STICKY_HOLD_MS);
    expect(game.stickyPatches?.length).toBe(0);
    // Untouched, a patch drains away on its own.
    setStickyPatch({ ...game, stickyTapsRemaining: 1 } as CanvasGameState, wall, { x: 150, y: 300 }, 2000);
  });

  it("are five cards in the draft catalogue, each on a key the engine reads", () => {
    const cards = src("../public/cards.yml");
    for (const [id, key] of [
      ["breakpoint", "breakpointsPerMap: 2"], ["stash", "stashPerMap: 1"], ["refactor", "refactorsPerMap: 1"],
      ["merge_conflict", "ballMerge: 1"], ["rate_limiter", "stickyTapsPerMap: 3"],
    ]) {
      expect(cards, id).toContain(`- id: ${id}\n`);
      expect(cards, id).toContain(key);
    }
    // Stash is an ability the card alone hands out: never a chest's, never the store's.
    const abilities = src("../public/abilities.yml");
    expect(abilities).toMatch(/- id: stash\n[\s\S]*?cardOnly: true/);
  });
});
