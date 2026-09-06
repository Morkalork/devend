/**
 * A gate map that ends says which of its two demands went unmet.
 *
 * Reported after a play of level 8: "I thought I saw a map say that all balls
 * had to be locked in a Colored area to win, when just 1 ball was enough."
 *
 * They had, and the same misreading ran through both halves of the feature.
 * Level 8 spawns THREE balls and asks for ONE in the zone plus an 81% clear:
 *
 *   THE TEXT   the Acceptance Criteria said "You trap a ball outside the area."
 *              under LOSE A LIFE IF, which reads as "any ball outside is
 *              fatal", so as "all of them have to go in". The engine loses the
 *              map only when NO target is left that could reach the zone
 *              (anyGateTargetInPlay) - every ball locked, none of them in it.
 *              Covered in acceptanceCriteria.test.ts.
 *   THE REASON this file. The areaUnreachable check asked whether the WHOLE win
 *              was met, so a player who landed the zone and fell short on the
 *              clear was told "The zone can no longer be reached" about a zone
 *              they had already reached.
 *
 * The second is the one the player cannot argue with: it is the game's own
 * account of what just happened, and it named the wrong thing. The truthful
 * reason there is the lock-out - every ball is sealed with the job unfinished -
 * which is exactly the guard the smash check beside it already applies.
 *
 * Drives the real win check rather than a predicate, because the bug was in
 * which question got asked and in what order, and a test of the predicate alone
 * would have gone on passing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { evaluateWinConditions } from "@/lib/physics/applyCut";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { MapFailure } from "@/lib/mapFailure";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { WinCondition } from "@/types/winSpec";

/** Level 8's shape: a gate zone, a clear to make, and three balls to do it with. */
const GATE_AREA = { kind: "var", x: 600, y: 60, width: 240, height: 240 };

function level(win: WinCondition[]): LevelConfig {
  return {
    id: "gate-probe", level: 8, sizeThreshold: 19, expectedCuts: 8, points: 20,
    maxBalls: 3, variety: 0, randomShapes: 0, entities: [],
    coloredAreas: [GATE_AREA],
    win: { require: win, alsoWinIf: [] },
  } as unknown as LevelConfig;
}

const GATE_WIN: WinCondition[] = [
  { kind: "space", threshold: 19 }, { kind: "area", count: 1 },
];

const board = (lvl: LevelConfig): CanvasGameState =>
  createInitialGameData(lvl, 8, DEFAULT_MODIFIERS) as unknown as CanvasGameState;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Enough of the callback surface to catch the failure and the life it costs. */
function harness(lives = 3) {
  let current = lives;
  const failures: MapFailure[] = [];
  const callbacks = {
    getLives: () => current,
    setLivesRef: (n: number) => { current = n; },
    setDisplayLives: () => {}, onLivesChange: () => {},
    onMapTimedOut: (f: unknown) => { failures.push(f as MapFailure); },
    setScreenFlash: () => {}, setIsShaking: () => {},
    shakeTimeoutRef: { current: null }, flashTimeoutRef: { current: null },
    setRemainingPercent: () => {}, repaintRegionCanvas: () => {},
    startDissolve: (done?: () => void) => { done?.(); },
    setClearedPercent: () => {}, setBestRemaining: () => {},
    onGameOver: () => {}, onGameEnd: () => {},
    onLevelComplete: () => {}, onMapComplete: () => {},
    freezeOnComplete: () => {}, setPushMode: () => {},
    setScore: () => {}, setCutCount: () => {}, onBallCountChanged: () => {},
  } as unknown as GameCallbacks;
  return { callbacks, failures };
}

/** Every ball sealed: the state both failure paths are about. */
function lockEveryBall(game: CanvasGameState): void {
  game.balls = game.balls.map(b => ({ ...b, state: "won", speed: 0 })) as typeof game.balls;
  game.lockedBallsCount = game.balls.length;
}

const endOf = (game: CanvasGameState, lvl: LevelConfig) => {
  const h = harness();
  game.activePlaySeconds = 5;
  evaluateWinConditions(game, lvl, 8, DEFAULT_MODIFIERS, h.callbacks);
  vi.runAllTimers();
  return h.failures;
};

describe("a gate map that runs out of balls", () => {
  it("blames the zone when the zone really was never reached", () => {
    const lvl = level(GATE_WIN);
    const game = board(lvl);
    lockEveryBall(game);
    game.coloredAreaTargets = 0;         // nothing ever landed in it
    const [fail] = endOf(game, lvl);
    expect(fail, "locking every ball outside the zone ended nothing").toBeTruthy();
    expect(fail.kind).toBe("areaUnreachable");
  });

  it("blames the LOCK-OUT when the zone was reached and the clear was not", () => {
    // The bug. The player did the hard half - a ball in the zone - and was told
    // the zone could no longer be reached, which is a sentence about a thing
    // they had already done.
    const lvl = level(GATE_WIN);
    const game = board(lvl);
    lockEveryBall(game);
    game.coloredAreaTargets = 1;         // the area clause is MET
    const [fail] = endOf(game, lvl);
    expect(fail, "a stranded gate map ended nothing").toBeTruthy();
    expect(fail.kind, "still blaming the zone the player already reached")
      .toBe("lockedOut");
  });

  it("says nothing at all while a ball is still in play", () => {
    // Dormant and frozen balls count as live targets; so does an ordinary one.
    // This rule ends maps, so it must never fire early.
    const lvl = level(GATE_WIN);
    const game = board(lvl);
    game.coloredAreaTargets = 0;
    expect(endOf(game, lvl)).toHaveLength(0);
  });
});
