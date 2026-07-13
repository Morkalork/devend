import { describe, it, expect, vi } from "vitest";
import { checkSpaceWin, evaluateWinConditions, triggerLevelComplete } from "@/lib/physics/applyCut";
import type { GameModifiers } from "@/hooks/useActiveModifiers";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";

// Minimal game state for the space-win check. No spaceGrid, so the remaining
// percent falls back to regions' estimatedArea / originalArea — which lets a
// test dial in an EXACT percentage.
function mkGame(remainingPercent: number, overrides: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    spaceGrid: null,
    regions: [{ estimatedArea: remainingPercent } as never],
    originalArea: 100,
    balls: [],
    walls: [],
    assimilations: new Map(),
    pushMode: "none",
    pushPromptPending: false,
    levelComplete: false,
    lockedBallsCount: 0,
    bestRemainingPercent: 100,
    pushStartPercent: 100,
    levelClearedTime: 0,
    activePlaySeconds: 12,
    clearedActiveSeconds: null,
    ...overrides,
  } as unknown as CanvasGameState;
}

const LEVEL = { sizeThreshold: 25 } as LevelConfig;

function mkCallbacks() {
  const calls = { remaining: [] as number[], cleared: [] as number[], pushMode: [] as string[] };
  return {
    calls,
    setRemainingPercent: (p: number) => calls.remaining.push(p),
    setClearedPercent: (p: number) => calls.cleared.push(p),
    setPushMode: (m: "none" | "prompt" | "pushing") => calls.pushMode.push(m),
  };
}

describe("checkSpaceWin (top bar CLEAR must equal an actual win)", () => {
  it("opens the prompt on an EXACT landing (remaining == threshold)", () => {
    // Regression: the HUD shows CLEAR at remaining <= threshold, but the win
    // used strictly-less — an exact landing celebrated without finishing.
    const game = mkGame(25);
    const cb = mkCallbacks();
    checkSpaceWin(game, LEVEL, cb);
    expect(game.pushMode).toBe("prompt");
    expect(cb.calls.pushMode).toEqual(["prompt"]);
    expect(game.clearedActiveSeconds).toBe(12);
  });

  it("opens the prompt below the threshold", () => {
    const game = mkGame(24);
    const cb = mkCallbacks();
    checkSpaceWin(game, LEVEL, cb);
    expect(game.pushMode).toBe("prompt");
  });

  it("does nothing above the threshold", () => {
    const game = mkGame(26);
    const cb = mkCallbacks();
    const percent = checkSpaceWin(game, LEVEL, cb);
    expect(percent).toBe(26);
    expect(game.pushMode).toBe("none");
    expect(cb.calls.pushMode).toEqual([]);
  });

  it("never double-opens (already prompting / pending / complete)", () => {
    for (const overrides of [
      { pushMode: "prompt" as const },
      { pushPromptPending: true },
      { levelComplete: true },
    ]) {
      const game = mkGame(20, overrides);
      const cb = mkCallbacks();
      checkSpaceWin(game, LEVEL, cb);
      expect(cb.calls.pushMode).toEqual([]);
    }
  });

  it("while pushing, only tracks the best remaining", () => {
    const game = mkGame(18, { pushMode: "pushing", bestRemainingPercent: 22 });
    const cb = mkCallbacks();
    checkSpaceWin(game, LEVEL, cb);
    expect(game.bestRemainingPercent).toBe(18);
    expect(cb.calls.pushMode).toEqual([]);
  });

  it("defers to the pending flag while a lock flash is playing", () => {
    const game = mkGame(25, {
      assimilations: new Map([["a", { startTime: performance.now() } as never]]),
    });
    const cb = mkCallbacks();
    checkSpaceWin(game, LEVEL, cb);
    expect(game.pushPromptPending).toBe(true);
    expect(game.pushMode).toBe("none");
    expect(cb.calls.pushMode).toEqual([]);
  });

  it("respects a thread-lock requirement", () => {
    const level = { sizeThreshold: 25, threadLockRequired: 1 } as LevelConfig;
    const short = mkGame(25);
    const cb1 = mkCallbacks();
    checkSpaceWin(short, level, cb1);
    expect(short.pushMode).toBe("none");

    const met = mkGame(25, { lockedBallsCount: 1 });
    const cb2 = mkCallbacks();
    checkSpaceWin(met, level, cb2);
    expect(met.pushMode).toBe("prompt");
  });
});

describe("evaluateWinConditions (per-frame safety net: CLEAR must never outlast the map)", () => {
  const MODS = {} as GameModifiers;
  // The safety net is called from the game loop with the full GameCallbacks;
  // only the space-check subset is exercised when no ball has locked.
  const mkGc = () => {
    const cb = mkCallbacks();
    return { cb, gc: cb as unknown as GameCallbacks };
  };

  it("opens the prompt on an already-cleared map with NO cut this frame", () => {
    // The regression: space reached the goal by some path that never re-ran the
    // win check, so the top bar showed CLEAR but the level never ended. The
    // per-frame safety net must close that gap.
    const game = mkGame(25);
    const { cb, gc } = mkGc();
    const percent = evaluateWinConditions(game, LEVEL, 13, MODS, gc);
    expect(percent).toBe(25);
    expect(game.pushMode).toBe("prompt");
    expect(cb.calls.pushMode).toEqual(["prompt"]);
  });

  it("is an inert no-op above the goal (no false finish while still playing)", () => {
    const game = mkGame(40);
    const { cb, gc } = mkGc();
    evaluateWinConditions(game, LEVEL, 13, MODS, gc);
    expect(game.pushMode).toBe("none");
    expect(cb.calls.pushMode).toEqual([]);
  });

  it("short-circuits once the level is already complete", () => {
    const game = mkGame(10, { levelComplete: true });
    const { cb, gc } = mkGc();
    const percent = evaluateWinConditions(game, LEVEL, 13, MODS, gc);
    expect(percent).toBeNull();
    expect(cb.calls.remaining).toEqual([]); // never even recomputed the percent
  });
});

describe("triggerLevelComplete (one delivery per map, pushes end cleanly)", () => {
  const SCORE_MODS = {
    scoreMultiplier: 1, pushBonusMultiplier: 1, spaceBonusMultiplier: 1,
    overtimeCapBonus: 0, shipEarlySecondsPerBall: 0, shipEarlyBonusMultiplier: 1,
  } as unknown as GameModifiers;
  const SCORE_LEVEL = { id: "t", level: 13, sizeThreshold: 25, expectedCuts: 8, points: 40 } as LevelConfig;

  function mkCompleteCallbacks() {
    const delivered: Array<{ pushBonus?: number }> = [];
    const pushModes: string[] = [];
    return {
      delivered,
      pushModes,
      callbacks: {
        setRemainingPercent: () => {},
        setPushMode: (m: "none" | "prompt" | "pushing") => pushModes.push(m),
        onLevelComplete: (d: { pushBonus?: number }) => delivered.push(d),
        startDissolve: (onComplete: () => void) => onComplete(),
      } as unknown as GameCallbacks,
    };
  }

  it("ends an in-flight push: HUD leaves pushing and the banked chunks pay out", () => {
    // Regression: locking the last ball mid-push completed the level via the
    // per-frame check but left pushMode "pushing" (Bank button still live) and
    // silently dropped the push bonus earned so far.
    vi.useFakeTimers();
    const game = mkGame(10, {
      pushMode: "pushing", pushStartPercent: 20, bestRemainingPercent: 10,
      wallCount: 6, lockBonus: 0, breakBonus: 0,
    });
    const { delivered, pushModes, callbacks } = mkCompleteCallbacks();
    triggerLevelComplete(game, SCORE_LEVEL, 13, SCORE_MODS, callbacks);
    expect(game.pushMode).toBe("none");
    expect(pushModes).toEqual(["none"]);
    vi.runAllTimers();
    expect(delivered).toHaveLength(1);
    // Cleared 10 of a 20% push start = two full 25% chunks banked.
    expect(delivered[0].pushBonus).toBe(2);
    vi.useRealTimers();
  });

  it("delivers the completion exactly once (re-entry is a no-op)", () => {
    // Regression: a second completion pipeline for the same map re-scored it
    // and resurrected the level-complete overlay over the next screen - seen
    // in the wild as two Promotion drafts right after each other.
    vi.useFakeTimers();
    const game = mkGame(10, { wallCount: 6, lockBonus: 0, breakBonus: 0 });
    const { delivered, callbacks } = mkCompleteCallbacks();
    triggerLevelComplete(game, SCORE_LEVEL, 13, SCORE_MODS, callbacks);
    triggerLevelComplete(game, SCORE_LEVEL, 13, SCORE_MODS, callbacks);
    vi.runAllTimers();
    expect(delivered).toHaveLength(1);
    vi.useRealTimers();
  });
});
