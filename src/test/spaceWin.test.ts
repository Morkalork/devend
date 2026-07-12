import { describe, it, expect } from "vitest";
import { checkSpaceWin } from "@/lib/physics/applyCut";
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
