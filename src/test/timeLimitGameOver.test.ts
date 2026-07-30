/**
 * Time-limit behavior (evaluateWinConditions): once the active-play clock
 * reaches the map's limit, the map is lost even against a would-be win on the
 * same frame. Running out of time now costs ONE life and restarts the map; the
 * run ends only when the last life is spent. The tutorial band is exempt.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
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

afterEach(() => vi.useRealTimers());

function makeGame(activePlaySeconds: number): CanvasGameState {
  return {
    levelComplete: false, gameOver: false, activePlaySeconds,
    pushMode: "none", regions: [], originalArea: 1000, wallCount: 0,
    balls: [], spaceGrid: null, assimilations: new Map(),
  } as unknown as CanvasGameState;
}

function makeCallbacks(lives = 3) {
  let curLives = lives;
  return {
    setScreenFlash: () => {}, setIsShaking: () => {}, onGameEnd: vi.fn(),
    onLivesChange: vi.fn(), onMapTimedOut: vi.fn(),
    getLives: () => curLives, setLivesRef: (n: number) => { curLives = n; }, setDisplayLives: () => {},
    flashTimeoutRef: { current: null }, shakeTimeoutRef: { current: null },
    setRemainingPercent: () => {}, setClearedPercent: () => {}, setPushMode: () => {},
  };
}

describe("time-limit behavior", () => {
  it("docks ONE life and restarts the map when lives remain (level 4+)", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks(3);
    const game = makeGame(DEFAULT_MAP_TIME_LIMIT); // exactly at the limit
    evaluateWinConditions(game, LEVEL, 5, MODS, cb as never);
    expect(game.gameOver).toBe(true);
    expect(cb.onLivesChange).toHaveBeenCalledWith(2); // one life docked
    expect(cb.onGameEnd).not.toHaveBeenCalled();      // NOT a whole-run loss
    vi.advanceTimersByTime(700);
    expect(cb.onMapTimedOut).toHaveBeenCalled();        // map restarts
  });

  it("time beats a would-be win on the same frame (still docks a life)", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks(3);
    // 0 balls would otherwise register an all-balls-won victory; the time check
    // runs first, so an expired clock is still a loss.
    const game = makeGame(DEFAULT_MAP_TIME_LIMIT + 5);
    evaluateWinConditions(game, LEVEL, 8, MODS, cb as never);
    expect(game.gameOver).toBe(true);
    expect(game.levelComplete).toBe(false);
    expect(cb.onLivesChange).toHaveBeenCalledWith(2);
  });

  it("ends the run only when the last life is spent", () => {
    vi.useFakeTimers();
    const cb = makeCallbacks(1); // last life
    const game = makeGame(DEFAULT_MAP_TIME_LIMIT);
    evaluateWinConditions(game, LEVEL, 5, MODS, cb as never);
    expect(cb.onLivesChange).toHaveBeenCalledWith(0);
    expect(cb.onMapTimedOut).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); // handleGameOverFn's shake -> onGameEnd
    expect(cb.onGameEnd).toHaveBeenCalled();
  });

  it("does not fire before the limit", () => {
    const game = makeGame(DEFAULT_MAP_TIME_LIMIT - 1);
    // one active ball so the empty-board all-won path doesn't complete the level
    (game as unknown as { balls: unknown[] }).balls = [{ state: "active", speed: 100 }];
    (game as unknown as { regions: unknown[] }).regions = [{ estimatedArea: 900, polygon: [] }];
    evaluateWinConditions(game, LEVEL, 5, MODS, makeCallbacks() as never);
    expect(game.gameOver).toBe(false);
  });

  it("exempts the tutorial band even past the default limit", () => {
    const game = makeGame(DEFAULT_MAP_TIME_LIMIT + 30);
    (game as unknown as { balls: unknown[] }).balls = [{ state: "active", speed: 100 }];
    (game as unknown as { regions: unknown[] }).regions = [{ estimatedArea: 900, polygon: [] }];
    evaluateWinConditions(game, LEVEL, 2, MODS, makeCallbacks() as never);
    expect(game.gameOver).toBe(false);
  });
});
