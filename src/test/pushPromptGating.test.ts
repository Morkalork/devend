/**
 * Push Your Luck is a bet that you can keep clearing while the balls are still
 * loose. With every ball locked there is no bet to make, so offering it hands
 * the player an empty map and a spent decision.
 *
 * It was offered, and this is how. The old win chain checked
 * `areAllBallsWon(game)` BEFORE the space clear and shipped the map outright.
 * The WinSpec rewrite collapsed the win into one `isWinMet` boolean and then
 * decided how to finish from the shape of `require` - which for an ordinary
 * map is `[space]`, whatever clause actually won. So an all-balls-locked win
 * fell straight into the space-clear branch and opened the prompt.
 *
 * The rule is about WHICH clause ended the map, not what the map could have
 * asked for: an alternative win ends it outright, the requirements route
 * through the prompt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playWallHitSound: () => {}, playLevelCompleteSound: () => {}, playBallLockSound: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateWinConditions } from "@/lib/physics/applyCut";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { resolveWinSpec, metAlternative, requirementsMet } from "@/lib/winSpec";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";

const LEVEL = {
  id: "push-probe", level: 12, sizeThreshold: 40, expectedCuts: 6, points: 20,
  maxBalls: 2, variety: 0, randomShapes: 0, entities: [],
} as unknown as LevelConfig;

function harness() {
  const calls = { pushMode: [] as string[], completed: 0 };
  const callbacks = {
    getLives: () => 3, setLivesRef: () => {}, setDisplayLives: () => {},
    onLivesChange: () => {}, onMapTimedOut: () => {},
    setScreenFlash: () => {}, setIsShaking: () => {},
    shakeTimeoutRef: { current: null }, flashTimeoutRef: { current: null },
    setRemainingPercent: () => {}, repaintRegionCanvas: () => {},
    onGameOver: () => {}, onGameEnd: () => {},
    setScore: () => {}, setCutCount: () => {}, onBallCountChanged: () => {},
    setPushMode: (m: string) => calls.pushMode.push(m),
    setClearedPercent: () => {},
    onLevelComplete: () => { calls.completed++; },
    startDissolve: (fn: () => void) => fn(),
    onMapComplete: () => {}, freezeOnComplete: () => false,
  } as unknown as GameCallbacks;
  return { callbacks, calls };
}

/**
 * A board cleared past its threshold, with every ball either locked or still
 * in play depending on `allLocked`.
 */
function clearedGame(allLocked: boolean): CanvasGameState {
  const data = createInitialGameData(LEVEL, 12, DEFAULT_MODIFIERS);
  const balls = data.balls.map(b => allLocked
    ? { ...b, state: "won" as const, speed: 0, velocity: { x: 0, y: 0 } }
    : b);
  return {
    ...data, balls, walls: data.walls, activeWalls: [],
    movers: data.movers ?? [], objectDebris: [], destructibles: [], pendingDestroys: [],
    obstaclePolygons: data.obstaclePolygons ?? [], mirrorPolygons: data.mirrorPolygons ?? [],
    pickups: [], pickupFeedback: [], regions: data.regions ?? [], chestLoot: [],
    coloredAreas: [], activePlaySeconds: 5, assimilations: new Map(),
    gravityWells: [], slowAreas: [], abilityFx: [], lockMarkers: [],
    lockedBallsCount: allLocked ? balls.length : 0,
    superiorLockCount: 0, wallCount: 2,
    levelComplete: false, gameOver: false, pushMode: "none", pushPromptPending: false,
    // The board is well past the 40% threshold either way.
    spaceRemainingPercent: 10,
    screenSize: { width: 900, height: 900 },
    boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
  } as unknown as CanvasGameState;
}

/**
 * Drive the space grid down so the clear condition is genuinely met.
 *
 * getRemainingPercent reads the COUNTS, not the cell array, so zeroing cells
 * without moving activeCount leaves the board reading 100% full and the win
 * never fires - which is how the first version of this test managed to assert
 * that a cleared map does not open a prompt.
 */
function clearTheBoard(game: CanvasGameState): void {
  const grid = game.spaceGrid as unknown as
    { activeCount: number; initialActiveCount: number } | null;
  if (!grid) return;
  grid.activeCount = Math.floor(grid.initialActiveCount * 0.10); // 10% left vs a 40% bar
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a map won by locking every ball", () => {
  it("ships immediately instead of offering a push", () => {
    const h = harness();
    const game = clearedGame(true);
    clearTheBoard(game);
    evaluateWinConditions(game, LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);

    expect(h.calls.pushMode, "no push prompt with nothing left to push").not.toContain("prompt");
    expect(game.pushPromptPending ?? false).toBe(false);
    expect(game.levelComplete, "the map must still end").toBe(true);
  });

  it("reports the win as allLocked, not as a space clear", () => {
    const h = harness();
    const game = clearedGame(true);
    clearTheBoard(game);
    let reason: string | undefined;
    (h.callbacks as unknown as { onLevelComplete: (d: { winReason?: string }) => void })
      .onLevelComplete = (d) => { reason = d.winReason; };
    evaluateWinConditions(game, LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);
    // The payload arrives after the shatter beat, so the timers have to run.
    vi.runAllTimers();
    expect(reason).toBe("allLocked");
  });
});

describe("an ordinary clear with balls still loose", () => {
  /** The prompt is the whole push mechanic and must survive the fix. */
  it("still opens the push prompt", () => {
    const h = harness();
    const game = clearedGame(false);
    clearTheBoard(game);
    evaluateWinConditions(game, LEVEL, 12, DEFAULT_MODIFIERS, h.callbacks);
    expect(h.calls.pushMode.includes("prompt") || game.pushPromptPending === true).toBe(true);
  });
});

/**
 * The second guard, and the case that reaches it.
 *
 * An AUTHORED win gets no alternatives it did not ask for, so a map whose spec
 * is a plain clear with no all-locked shortcut can genuinely arrive at the
 * space branch with every ball already sealed. The ordering fix above does not
 * help there: the requirements really are what won. Push Your Luck still has no
 * bet to offer, so it banks straight through.
 *
 * Banks rather than skips, deliberately. Skipping would leave the top bar
 * reading CLEAR on a map that never ends, which is the single thing the
 * per-frame win check exists to make impossible.
 */
describe("an authored clear with no all-locked shortcut", () => {
  const AUTHORED = {
    ...LEVEL, id: "authored-probe",
    win: { require: [{ kind: "space", threshold: 40 }], alsoWinIf: [] },
  } as unknown as LevelConfig;

  it("reaches the space branch with nothing left in play", () => {
    const spec = resolveWinSpec(AUTHORED);
    expect(spec.authored).toBe(true);
    expect(spec.alsoWinIf, "no shortcut to short-circuit on").toEqual([]);
  });

  it("banks the win instead of offering a push on an empty board", () => {
    const h = harness();
    const game = clearedGame(true);
    clearTheBoard(game);
    evaluateWinConditions(game, AUTHORED, 12, DEFAULT_MODIFIERS, h.callbacks);
    expect(h.calls.pushMode, "nothing to push with").not.toContain("prompt");
    expect(game.pushPromptPending ?? false).toBe(false);
    expect(game.levelComplete, "and the map must still end").toBe(true);
  });
});

/**
 * The distinction the fix turns on, at the level of the spec rather than the
 * board: `isWinMet` cannot tell these apart, which is precisely why deciding
 * how to finish from it was wrong.
 */
describe("an alternative win is not a requirement win", () => {
  const spec = resolveWinSpec(LEVEL);
  const snap = (over: Record<string, unknown>) => ({
    remainingPercent: 100, lockedBalls: 0, superiorLocks: 0, areaTargets: 0,
    lockedByType: {}, bossDefeated: false, allLocked: false,
    cuts: 0, par: 6, activeSeconds: 0, ...over,
  } as Parameters<typeof metAlternative>[1]);

  it("carries the all-locked shortcut as an alternative, not a requirement", () => {
    expect(spec.alsoWinIf).toEqual([{ kind: "allLocked" }]);
    expect(spec.require.some(c => c.kind === "allLocked")).toBe(false);
  });

  it("separates a win by locking everything from a win by clearing", () => {
    const locked = snap({ allLocked: true, remainingPercent: 90 });
    expect(metAlternative(spec, locked)).toEqual({ kind: "allLocked" });
    expect(requirementsMet(spec, locked), "the board is nowhere near clear").toBe(false);

    const cleared = snap({ remainingPercent: 10 });
    expect(metAlternative(spec, cleared)).toBeNull();
    expect(requirementsMet(spec, cleared)).toBe(true);
  });

  it("treats a win that is both as the alternative, which ends it outright", () => {
    const both = snap({ allLocked: true, remainingPercent: 10 });
    expect(metAlternative(spec, both), "locking everything wins on its own").toBeTruthy();
  });
});

/**
 * The structural guard. The bug was a decision made from the wrong value, so
 * pin that the alternatives are consulted before the requirements, which is the
 * order the old chain had and the rewrite lost.
 */
describe("the gate asks which clause won, not what the map could ask", () => {
  it("checks the alternatives before the requirements", () => {
    const src = readFileSync(resolve(__dirname, "../lib/physics/applyCut.ts"), "utf8");
    const alt = src.indexOf("if (metAlternative(spec, snap))");
    const req = src.indexOf("if (requirementsMet(spec, snap))");
    expect(alt, "the alternative check must exist").toBeGreaterThan(0);
    expect(req, "the requirement check must exist").toBeGreaterThan(0);
    expect(alt).toBeLessThan(req);
  });
});
