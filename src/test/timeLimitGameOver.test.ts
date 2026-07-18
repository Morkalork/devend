/**
 * Time-limit game over (evaluateWinConditions): once the active-play clock
 * reaches the map's limit, the map is lost even with a would-be win on the same
 * frame, and the tutorial band is exempt. Drives the real win/lose entry point.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playDeathSound: () => {}, playLevelCompleteSound: () => {}, playCutClaimedSound: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({ vibrateDeath: () => {} }));

import { evaluateWinConditions } from "@/lib/physics/applyCut";
import { CanvasGameState } from "@/types/gameState";
import { LevelConfig } from "@/types/level";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { DEFAULT_MAP_TIME_LIMIT } from "@/lib/mapTiming";

const LEVEL = { id: "m", sizeThreshold: 70, expectedCuts: 3, points: 20, maxBalls: 1 } as unknown as LevelConfig;
const MODS = {} as unknown as GameModifiers;

function makeGame(activePlaySeconds: number): CanvasGameState {
  return {
    levelComplete: false, gameOver: false, activePlaySeconds,
    pushMode: "none", regions: [], originalArea: 1000, wallCount: 0,
    balls: [], spaceGrid: null, assimilations: new Map(),
  } as unknown as CanvasGameState;
}

// evaluateWinConditions returns after firing game over, so callbacks only need
// the fields handleGameOverFn touches on the non-pushing path.
function makeCallbacks() {
  return {
    setScreenFlash: () => {}, setIsShaking: () => {}, onGameEnd: vi.fn(),
    flashTimeoutRef: { current: null }, shakeTimeoutRef: { current: null },
    setRemainingPercent: () => {}, setClearedPercent: () => {}, setPushMode: () => {},
  } as never;
}

describe("time-limit game over", () => {
  it("loses the map the moment the clock reaches the limit (level 4+)", () => {
    const game = makeGame(DEFAULT_MAP_TIME_LIMIT); // exactly at the limit
    evaluateWinConditions(game, LEVEL, 5, MODS, makeCallbacks());
    expect(game.gameOver).toBe(true);
  });

  it("time beats a would-be win on the same frame", () => {
    // 0 balls would otherwise register an all-balls-won victory; the time check
    // runs first, so an expired clock is still a loss.
    const game = makeGame(DEFAULT_MAP_TIME_LIMIT + 5);
    evaluateWinConditions(game, LEVEL, 8, MODS, makeCallbacks());
    expect(game.gameOver).toBe(true);
    expect(game.levelComplete).toBe(false);
  });

  it("does not fire before the limit", () => {
    const game = makeGame(DEFAULT_MAP_TIME_LIMIT - 1);
    // one active ball so the empty-board all-won path doesn't complete the level
    (game as unknown as { balls: unknown[] }).balls = [{ state: "active", speed: 100 }];
    (game as unknown as { spaceGrid: unknown }).spaceGrid = null;
    // regions carry remaining area so checkSpaceWin sees the board unfinished
    (game as unknown as { regions: unknown[] }).regions = [{ estimatedArea: 900, polygon: [] }];
    evaluateWinConditions(game, LEVEL, 5, MODS, makeCallbacks());
    expect(game.gameOver).toBe(false);
  });

  it("exempts the tutorial band even past the default limit", () => {
    const game = makeGame(DEFAULT_MAP_TIME_LIMIT + 30);
    (game as unknown as { balls: unknown[] }).balls = [{ state: "active", speed: 100 }];
    (game as unknown as { regions: unknown[] }).regions = [{ estimatedArea: 900, polygon: [] }];
    evaluateWinConditions(game, LEVEL, 2, MODS, makeCallbacks());
    expect(game.gameOver).toBe(false);
  });
});
