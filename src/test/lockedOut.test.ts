/**
 * Locking every ball is a move, not a free win.
 *
 * The complaint this answers: the opening maps were pointless, because sealing
 * the balls beat them with every object on the board untouched. Two things made
 * that true, and only fixing one of them would have changed nothing:
 *
 *   1. `resolveWinSpec` hands every derived map an `allLocked` ALTERNATIVE, so
 *      the last lock shipped the map whatever the board looked like.
 *   2. captureUnreachableCells writes off the entire board the instant nothing
 *      is in play, so `remaining` drops to ~0 and a `space` clause is met as a
 *      CONSEQUENCE of the last lock. Removing (1) alone leaves this route open.
 *
 * So the rule is not "you may not lock everything". It is that once no ball is
 * in play the requirements are FINAL: nothing can smash a slab or enter a zone
 * any more. Unmet at that moment means unwinnable, and the map says so rather
 * than sitting there unfinishable.
 *
 * The blast radius matters as much as the rule. A map whose requirements the
 * capture satisfies still wins exactly as it always did, which is every one of
 * the derived specs. Only a map that asks for something a lock cannot produce
 * can reach the new failure.
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

import { evaluateWinConditions, checkSpaceWin } from "@/lib/physics/applyCut";
import { createInitialGameData } from "@/lib/initGame";
import { captureUnreachableCells } from "@/lib/spaceGrid";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { mapFailure } from "@/lib/mapFailure";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { GameResult } from "@/types/game";
import type { WinCondition } from "@/types/winSpec";

const SLAB = {
  id: "slab", kind: "wall", shape: "rect",
  x: 400, y: 300, width: 40, height: 200, breakable: true, hitsToBreak: 4,
};

function level(win?: WinCondition[]): LevelConfig {
  return {
    id: "locked-out-probe", level: 5, sizeThreshold: 40, expectedCuts: 6, points: 20,
    maxBalls: 2, variety: 0, randomShapes: 0, entities: [SLAB],
    ...(win ? { win: { require: win, alsoWinIf: [] } } : {}),
  } as unknown as LevelConfig;
}

function harness(lives = 3) {
  let current = lives;
  const calls = { timedOutWith: [] as unknown[], endedWith: [] as GameResult[], completed: 0 };
  const callbacks = {
    getLives: () => current,
    setLivesRef: (n: number) => { current = n; },
    setDisplayLives: () => {}, onLivesChange: () => {},
    onMapTimedOut: (f: unknown) => { calls.timedOutWith.push(f); },
    setScreenFlash: () => {}, setIsShaking: () => {},
    shakeTimeoutRef: { current: null }, flashTimeoutRef: { current: null },
    setRemainingPercent: () => {}, repaintRegionCanvas: () => {},
    startDissolve: (done?: () => void) => { done?.(); },
    setClearedPercent: () => {}, setBestRemaining: () => {},
    onGameOver: () => {}, onGameEnd: (r: GameResult) => { calls.endedWith.push(r); },
    onLevelComplete: () => { calls.completed++; },
    onMapComplete: () => {}, freezeOnComplete: () => {}, setPushMode: () => {},
    setScore: () => {}, setCutCount: () => {}, onBallCountChanged: () => {},
  } as unknown as GameCallbacks;
  return { callbacks, calls };
}

/**
 * A board with every ball sealed and the slab intact: the lock rush, at the
 * moment it finishes. `remainingPercent` is driven to 0 the way the capture
 * cascade drives it, because that IS the state the win check sees.
 */
function lockedOutBoard(lvl: LevelConfig, over: Partial<CanvasGameState> = {}): CanvasGameState {
  const data = createInitialGameData(lvl, 5, DEFAULT_MODIFIERS);
  const balls = data.balls.map(b => ({ ...b, state: "won", speed: 0, velocity: { x: 0, y: 0 } }));
  // The real cascade, not a hand-set percent. With nothing in play this writes
  // off the whole board, and that is the entire reason dropping the allLocked
  // alternative would not have fixed anything: `space` is met as a CONSEQUENCE
  // of the last lock. A fixture that skipped it would leave space unmet and
  // these tests would pass for the wrong reason.
  if (data.spaceGrid) captureUnreachableCells(data.spaceGrid, balls as never, data.walls as never);
  return {
    ...data, balls, walls: data.walls, activeWalls: [],
    movers: data.movers ?? [], objectDebris: [], pendingDestroys: [],
    destructibles: [{ id: "slab", kind: "breakable", hits: 0, maxHits: 4, lastHitAt: 0, destroyed: false }],
    obstaclePolygons: data.obstaclePolygons ?? [], mirrorPolygons: data.mirrorPolygons ?? [],
    pickups: [], pickupFeedback: [], regions: data.regions ?? [], chestLoot: [],
    coloredAreas: [], activePlaySeconds: 10, lockedBallsCount: balls.length,
    levelComplete: false, gameOver: false, pushMode: "none", assimilations: new Map(),
    screenSize: { width: 900, height: 900 },
    boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
    ...over,
  } as unknown as CanvasGameState;
}

/**
 * Cleared well past the threshold with a ball still bouncing: the state the
 * space path sees on an ordinary win.
 */
function clearedBoard(
  lvl: LevelConfig, data: ReturnType<typeof createInitialGameData>,
): CanvasGameState {
  const grid = data.spaceGrid!;
  // Remove all but a sliver, the way a run of fences would.
  const keep = Math.floor(grid.cells.length * 0.05);
  let active = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] !== 0) continue;
    if (active < keep) { active++; continue; }
    grid.cells[i] = 1;
  }
  grid.activeCount = active;
  return {
    ...data, balls: data.balls.map(b => ({ ...b, state: "active", speed: 5 })),
    walls: data.walls, activeWalls: [], movers: data.movers ?? [], objectDebris: [],
    pendingDestroys: [], assimilations: new Map(),
    destructibles: [{ id: "slab", kind: "breakable", hits: 0, maxHits: 4, lastHitAt: 0, destroyed: false }],
    obstaclePolygons: data.obstaclePolygons ?? [], mirrorPolygons: data.mirrorPolygons ?? [],
    pickups: [], pickupFeedback: [], regions: data.regions ?? [], chestLoot: [],
    coloredAreas: [], activePlaySeconds: 10, lockedBallsCount: 1,
    levelComplete: false, gameOver: false, pushMode: "none",
    screenSize: { width: 900, height: 900 },
    boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
  } as unknown as CanvasGameState;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("stranding the map by locking everything", () => {
  it("ends the map rather than leaving it unfinishable", () => {
    // The map asks for the slab. Every ball is sealed and the slab is whole, so
    // nothing on the board can ever change again.
    const h = harness();
    const lvl = level([{ kind: "space", threshold: 40 }, { kind: "smashed", count: 1 }]);
    evaluateWinConditions(lockedOutBoard(lvl), lvl, 5, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();

    expect(h.calls.timedOutWith, "the map was left sitting there unwinnable").toHaveLength(1);
    const failure = h.calls.timedOutWith[0] as ReturnType<typeof mapFailure>;
    expect(failure.kind).toBe("lockedOut");
  });

  it("names the requirement that was stranded", () => {
    // "You lost" is a rule the player can learn nothing from. "You still needed
    // 1 smashed, you had 0" is the whole lesson of the map.
    const h = harness();
    const lvl = level([{ kind: "space", threshold: 40 }, { kind: "smashed", count: 1 }]);
    evaluateWinConditions(lockedOutBoard(lvl), lvl, 5, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();

    const failure = h.calls.timedOutWith[0] as ReturnType<typeof mapFailure>;
    const smashed = failure.unmet.find(p => p.condition.kind === "smashed");
    expect(smashed, "the stranded requirement was not named").toBeTruthy();
    expect(smashed!.current).toBe(0);
    expect(smashed!.target).toBe(1);
  });

  it("does not fire once the requirement was actually met", () => {
    // Locking everything AFTER breaking the slab is a perfectly good win, and
    // the commonest way to finish these maps. A rule that punished the last
    // lock rather than the unmet requirement would break every map at once.
    const h = harness();
    const lvl = level([{ kind: "space", threshold: 40 }, { kind: "smashed", count: 1 }]);
    const board = lockedOutBoard(lvl, {
      destructibles: [{ id: "slab", kind: "breakable", hits: 4, maxHits: 4, lastHitAt: 0, destroyed: true }],
    } as Partial<CanvasGameState>);
    evaluateWinConditions(board, lvl, 5, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();

    expect(h.calls.timedOutWith, "a met requirement was treated as stranded").toHaveLength(0);
  });

  /**
   * THE blast-radius guard. Every map with no authored `win:` derives
   * `require: [space]` plus the allLocked alternative, and the capture cascade
   * means the last lock satisfies that space clause. Those maps must be
   * untouched: 27 of the 35 shipped maps are in this shape, and turning any of
   * them into a loss would be a far worse bug than the one being fixed.
   */
  it("leaves a map that only asks for space winning exactly as before", () => {
    const h = harness();
    const lvl = level();  // no authored win: the derived space + allLocked spec
    evaluateWinConditions(lockedOutBoard(lvl), lvl, 5, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();

    expect(h.calls.timedOutWith, "an ordinary map now loses on its last lock").toHaveLength(0);
    expect(h.calls.completed, "the ordinary all-locked win stopped firing").toBeGreaterThan(0);
  });

  it("stays quiet while a ball is still in play", () => {
    // The requirements are only final once nothing can change them. An unmet
    // slab with a ball still bouncing is an unfinished map, not a lost one.
    const h = harness();
    const lvl = level([{ kind: "space", threshold: 40 }, { kind: "smashed", count: 1 }]);
    const data = createInitialGameData(lvl, 5, DEFAULT_MODIFIERS);
    const board = lockedOutBoard(lvl, {
      balls: data.balls.map((b, i) => (i === 0 ? { ...b, speed: 5, state: "active" } : { ...b, state: "won", speed: 0 })),
    } as Partial<CanvasGameState>);
    evaluateWinConditions(board, lvl, 5, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();

    expect(h.calls.timedOutWith, "lost a map that was still being played").toHaveLength(0);
  });
});

/**
 * The space clear does not walk past the rest of the win.
 *
 * checkSpaceWin used to complete the level from `level.sizeThreshold` and
 * `level.threadLockRequired` read directly off the LevelConfig - the same win
 * stated twice, in two places free to disagree. Every caller reaches it on a
 * path where the spec has NOT been satisfied (the per-frame HUD update, a
 * destroy that captured pocket cells), so any requirement those two fields
 * cannot model was simply skipped.
 *
 * That was live: bot runs won level 8 five times out of five with ZERO locks,
 * on a map whose authored win is "clear to 19% AND lock a ball in the zone".
 * Nothing in the suite noticed, because every test of the gate drove the spec
 * path rather than the space path.
 */
describe("clearing to the threshold is not a win on its own", () => {
  it("does not complete a map whose other requirements are unmet", () => {
    const h = harness();
    const lvl = level([{ kind: "space", threshold: 40 }, { kind: "smashed", count: 1 }]);
    // Cleared past the threshold, slab intact, and a ball still in play - so
    // the lock-out rule is not what is being measured here.
    const data = createInitialGameData(lvl, 5, DEFAULT_MODIFIERS);
    const board = clearedBoard(lvl, data);
    checkSpaceWin(board, lvl, h.callbacks, 5, DEFAULT_MODIFIERS);
    vi.runAllTimers();

    // The symptom is the OFFER, not the completion: reaching the threshold with
    // balls still loose opens the push-your-luck prompt, and banking from that
    // prompt ends the map. So a map that is not actually won must never get
    // that far. Asserting only "did not complete" passes under the old
    // legacy-field reading too, because that reading opened the prompt rather
    // than banking - which is exactly how level 8 was beatable with its zone
    // empty.
    expect(board.pushMode, "offered to bank a map that was not won").not.toBe("prompt");
    expect(board.pushPromptPending, "queued the bank offer instead").toBeFalsy();
    expect(h.calls.completed, "the clear walked past the unmet requirement").toBe(0);
  });

  it("still completes a map whose requirements the clear satisfies", () => {
    // The other half: a derived spec is exactly "space plus threadLockRequired",
    // so reading the spec instead of those two fields must be a no-op on the
    // 26 maps that never authored a win. A guard that refused everything would
    // pass the test above and break the whole ladder.
    const h = harness();
    const lvl = level([{ kind: "space", threshold: 40 }]);
    const data = createInitialGameData(lvl, 5, DEFAULT_MODIFIERS);
    const board = clearedBoard(lvl, data);
    checkSpaceWin(board, lvl, h.callbacks, 5, DEFAULT_MODIFIERS);
    vi.runAllTimers();

    // Reaching the threshold with balls still loose opens the push-your-luck
    // prompt rather than banking outright - that IS the ordinary clear, and it
    // is the behaviour a guard that refused everything would have killed.
    expect(board.pushMode, "an ordinary clear no longer reaches the win").toBe("prompt");
  });
});
