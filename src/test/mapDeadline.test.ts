/**
 * The hard map deadline: out of time costs a life and restarts the map.
 *
 * Reported as "when the time runs out, nothing happens". The core path turned
 * out to be correct and wired end to end, and the report came from the admin
 * Playground, which supplied neither a lives callback nor onMapTimedOut, so the
 * deadline decremented a life into a no-op, flashed red and then called an
 * undefined callback.
 *
 * That is worth a test either way: the deadline had NONE. It is the only rule
 * in the game that can end a map with no player action at all, so a silent
 * regression in it would look exactly like the game having no timer, which is
 * how this was reported in the first place.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playBallLockSound: () => {}, playWallHitSound: () => {}, playBallCollideSound: () => {},
  playFenceBreakSound: () => {}, playDeathSound: () => {}, playCutClaimedSound: () => {},
  playLevelCompleteSound: () => {}, playBossChargeSound: () => {}, playPickupClaimedSound: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
  vibrateDeath: () => {}, vibrateGameOver: () => {},
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateWinConditions } from "@/lib/physics/applyCut";
import { getMapTimeLimit, isTimingExempt } from "@/lib/mapTiming";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";

const LEVEL = {
  id: "deadline-probe", level: 12, sizeThreshold: 40, expectedCuts: 6, points: 20,
  maxBalls: 1, variety: 0, randomShapes: 0, entities: [],
} as unknown as LevelConfig;

function harness(lives: number) {
  let current = lives;
  const shakeTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
  const flashTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
  const calls = {
    timedOut: 0, gameOver: 0, flashes: [] as string[],
    livesChanged: [] as number[],
  };
  const callbacks = {
    getLives: () => current,
    setLivesRef: (n: number) => { current = n; },
    setDisplayLives: () => {},
    onLivesChange: (n: number) => calls.livesChanged.push(n),
    onMapTimedOut: () => { calls.timedOut++; },
    setScreenFlash: (f: string) => calls.flashes.push(f),
    setIsShaking: () => {},
    shakeTimeoutRef, flashTimeoutRef,
    setRemainingPercent: () => {},
    repaintRegionCanvas: () => {},
    onGameOver: () => { calls.gameOver++; },
    onGameEnd: () => { calls.gameOver++; },
    setScore: () => {}, setCutCount: () => {}, onBallCountChanged: () => {},
  } as unknown as GameCallbacks;
  return { callbacks, calls, lives: () => current };
}

function gameAt(seconds: number): CanvasGameState {
  const data = createInitialGameData(LEVEL, 12, DEFAULT_MODIFIERS);
  return {
    ...data, balls: data.balls, walls: data.walls, activeWalls: [],
    movers: data.movers ?? [], objectDebris: [], destructibles: [], pendingDestroys: [],
    obstaclePolygons: data.obstaclePolygons ?? [], mirrorPolygons: data.mirrorPolygons ?? [],
    pickups: [], pickupFeedback: [], regions: data.regions ?? [], chestLoot: [],
    coloredAreas: [], activePlaySeconds: seconds,
    levelComplete: false, gameOver: false, pushMode: "none",
    screenSize: { width: 900, height: 900 },
    boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
  } as unknown as CanvasGameState;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("when the clock runs out", () => {
  const LIMIT = getMapTimeLimit(LEVEL, 12)!;

  it("has a limit to run out of in the first place", () => {
    expect(LIMIT).toBeGreaterThan(0);
  });

  it("does nothing at all before the limit", () => {
    const h = harness(3);
    evaluateWinConditions(gameAt(LIMIT - 0.1), LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);
    expect(h.calls.timedOut).toBe(0);
    expect(h.lives()).toBe(3);
  });

  it("costs exactly one life", () => {
    const h = harness(3);
    evaluateWinConditions(gameAt(LIMIT), LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);
    expect(h.lives()).toBe(2);
    expect(h.calls.livesChanged).toEqual([2]);
  });

  it("restarts the map once the flash has played", () => {
    const h = harness(3);
    evaluateWinConditions(gameAt(LIMIT), LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);
    expect(h.calls.flashes).toContain("red");
    expect(h.calls.timedOut, "restart is deferred until the flash finishes").toBe(0);
    vi.runAllTimers();
    expect(h.calls.timedOut).toBe(1);
  });

  /** The run ends only when the LAST life is spent, not on any timeout. */
  it("ends the run instead when it was the last life", () => {
    const h = harness(1);
    evaluateWinConditions(gameAt(LIMIT), LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();
    expect(h.calls.timedOut, "a finished run must not also restart the map").toBe(0);
  });

  it("freezes the loop so it cannot fire twice", () => {
    const h = harness(3);
    const game = gameAt(LIMIT);
    evaluateWinConditions(game, LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);
    expect(game.gameOver).toBe(true);
    evaluateWinConditions(game, LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();
    expect(h.lives(), "a second frame must not take another life").toBe(2);
  });

  it("leaves the tutorial band alone", () => {
    for (const lv of [1, 2, 3]) {
      expect(isTimingExempt(lv), `level ${lv}`).toBe(true);
      expect(getMapTimeLimit(LEVEL, lv)).toBeNull();
    }
    const h = harness(3);
    evaluateWinConditions(gameAt(9999), LEVEL, 2, DEFAULT_MODIFIERS, h.callbacks);
    expect(h.calls.timedOut).toBe(0);
    expect(h.lives()).toBe(3);
  });
});

/**
 * The Playground is a tester, not a run, so it has no lives to spend. It must
 * still RESTART, or the map sits there past its deadline doing nothing, which
 * is exactly how this was reported.
 */
describe("the Playground honours the deadline", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../components/admin/PlaygroundScreen.tsx"), "utf8",
  );

  it("passes onMapTimedOut to the canvas", () => {
    expect(
      SRC,
      "without this the deadline flashes red and then calls an undefined callback",
    ).toMatch(/onMapTimedOut=\{/);
  });

  it("restarts by remounting, the same way its own restart button does", () => {
    const handler = SRC.match(/onMapTimedOut=\{([\s\S]{0,120}?)\}\s*\n/);
    expect(handler).toBeTruthy();
    expect(handler![1]).toMatch(/setGameKey/);
  });
});
