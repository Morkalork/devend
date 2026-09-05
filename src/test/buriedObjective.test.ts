/**
 * You cannot bury something you still have to break.
 *
 * A breakable is smashed by driving a BALL into it, so it needs two things to
 * stay possible: an unbroken slab, and open ground beside it for a ball to come
 * from. Fence that ground away and the second one is gone - while the slab is
 * still drawn, still yellow, still pulsing as a win target that nothing can now
 * reach. The map is over and keeps running until the clock says something true
 * and useless about the clock.
 *
 * Two rules, deliberately different, because the two situations are:
 *
 *   WITH A BALL INSIDE   the seal is REFUSED as a lock. The pocket stays open,
 *                        the ball keeps bouncing, the slab is still yours.
 *   WITH NO BALL INSIDE  nothing to refuse for and the ground is already
 *                        claimed, so the map is failed at that instant.
 *
 * These drive the real grid rather than a hand-set flag: the reachability test
 * reads ACTIVE cells that captureUnreachableCells has already pruned, so a
 * fixture that faked the grid would be testing the fake.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateWinConditions } from "@/lib/physics/applyCut";
import { checkAndUpdateBallWonStates } from "@/lib/physics/checkBallWonState";
import { setRunSeedText } from "@/lib/runRng";
import { worldToGridIndex, findGridRegions, buildGridRegionMap, findGridRegionForBall } from "@/lib/spaceGrid";
import { MAP_FAIL_KINDS, type MapFailure } from "@/lib/mapFailure";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { CellState } from "@/lib/spaceGrid";
import { resolveWinSpec } from "@/lib/winSpec";
import {
  canStillStrike, smashesStillPossible, smashRequirementLost,
  regionHoldsNeededSlab, requiredSmashes, strikeCells,
} from "@/lib/physics/smashReach";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { WinCondition } from "@/types/winSpec";

const SLAB = {
  id: "slab", kind: "wall", shape: "rect",
  x: 400, y: 300, width: 40, height: 200, breakable: true, hitsToBreak: 3,
};

function level(win: WinCondition[], entities = [SLAB]): LevelConfig {
  return {
    id: "buried-probe", level: 5, sizeThreshold: 40, expectedCuts: 6, points: 20,
    maxBalls: 2, variety: 0, randomShapes: 0, entities,
    win: { require: win, alsoWinIf: [] },
  } as unknown as LevelConfig;
}

const board = (lvl: LevelConfig): CanvasGameState =>
  createInitialGameData(lvl, 5, DEFAULT_MODIFIERS) as unknown as CanvasGameState;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Enough of the callback surface for the failure path, plus the life counter. */
function harness(lives = 3) {
  let current = lives;
  const calls = { timedOutWith: [] as unknown[], completed: 0 };
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
    onGameOver: () => {}, onGameEnd: () => {},
    onLevelComplete: () => { calls.completed++; },
    onMapComplete: () => {}, freezeOnComplete: () => {}, setPushMode: () => {},
    setScore: () => {}, setCutCount: () => {}, onBallCountChanged: () => {},
  } as unknown as GameCallbacks;
  return { callbacks, calls, lives: () => current };
}

it("carries the new kind in the exhaustive list", () => {
  expect(MAP_FAIL_KINDS).toContain("objectiveBuried");
});

/** Claim every cell in the slab's strike ring: the fence went round it. */
function buryTheSlab(game: CanvasGameState): number {
  const grid = game.spaceGrid!;
  const d = game.destructibles!.find(x => x.kind === "breakable")!;
  let claimed = 0;
  for (const i of strikeCells(grid, d, 18)) {
    if (grid.cells[i] === CellState.ACTIVE) { grid.cells[i] = CellState.REMOVED; claimed++; }
  }
  return claimed;
}

describe("reading whether a slab can still be hit", () => {
  it("finds an ordinary slab reachable on a fresh board", () => {
    const game = board(level([{ kind: "smashed", count: 1 }]));
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    expect(d, "the fixture grew no breakable").toBeTruthy();
    expect(canStillStrike(game, d), "an untouched board already reads as buried").toBe(true);
  });

  it("reads it as unreachable once the ground beside it is claimed", () => {
    const game = board(level([{ kind: "smashed", count: 1 }]));
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    expect(buryTheSlab(game), "the fixture claimed nothing").toBeGreaterThan(0);
    expect(canStillStrike(game, d)).toBe(false);
  });

  it("treats a slab it cannot MEASURE as reachable, not as lost", () => {
    // Unknown is not lost, and the direction matters: this rule ends maps, so a
    // slab with no polygon has to be assumed fine. A fixture whose destructible
    // carried no polygon failed a map that was perfectly playable.
    const game = board(level([{ kind: "smashed", count: 1 }]));
    game.destructibles = [{
      id: "no-shape", kind: "breakable", hits: 0, maxHits: 3,
      lastHitAt: 0, destroyed: false,
    }] as unknown as CanvasGameState["destructibles"];
    expect(smashRequirementLost(game, resolveWinSpec(level([{ kind: "smashed", count: 1 }]))))
      .toBe(false);
  });

  it("counts a SMASHED slab as still satisfying the clause", () => {
    // It is already spent. Reading a broken slab as unreachable would fail the
    // map for the very act that was supposed to finish it.
    const game = board(level([{ kind: "smashed", count: 1 }]));
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    buryTheSlab(game);
    d.destroyed = true;
    expect(smashesStillPossible(game)).toBe(1);
    expect(smashRequirementLost(game, resolveWinSpec(level([{ kind: "smashed", count: 1 }]))))
      .toBe(false);
  });
});

describe("the requirement, not any one slab", () => {
  const TWO = [SLAB, { ...SLAB, id: "slab-2", x: 200 }];

  it("lets a map with slack lose a slab it did not need", () => {
    // Four slabs and a `smashed 1` clause can lose three and be fine. Failing a
    // map for burying a slab it never needed would be its own bug.
    const lvl = level([{ kind: "smashed", count: 1 }], TWO);
    const game = board(lvl);
    expect(game.destructibles!.filter(d => d.kind === "breakable").length).toBe(2);
    buryTheSlab(game);   // buries whichever comes first
    expect(smashesStillPossible(game)).toBe(1);
    expect(smashRequirementLost(game, resolveWinSpec(lvl))).toBe(false);
  });

  it("fails once the count can no longer be reached", () => {
    const lvl = level([{ kind: "smashed", count: 2 }], TWO);
    const game = board(lvl);
    buryTheSlab(game);
    expect(smashesStillPossible(game)).toBe(1);
    expect(smashRequirementLost(game, resolveWinSpec(lvl))).toBe(true);
  });

  it("says nothing at all on a map that asks for no smashes", () => {
    const lvl = level([{ kind: "space", threshold: 40 }]);
    const game = board(lvl);
    buryTheSlab(game);
    expect(requiredSmashes(resolveWinSpec(lvl))).toBe(0);
    expect(smashRequirementLost(game, resolveWinSpec(lvl))).toBe(false);
  });

  it("says nothing when the map carries no breakables to lose", () => {
    // A smash clause with nothing to smash was unwinnable before the player
    // touched it - an authoring fault winSpecProblems already refuses - and
    // blaming their cut for it would name the wrong cause.
    const lvl = level([{ kind: "smashed", count: 1 }], []);
    const game = board(lvl);
    expect(game.destructibles?.filter(d => d.kind === "breakable") ?? []).toEqual([]);
    expect(smashRequirementLost(game, resolveWinSpec(lvl))).toBe(false);
  });
});

describe("the map is failed, and named", () => {
  it("costs a life and says WHICH mistake, with a ball still in play", () => {
    // End to end through the real win check. The lesson has to be specific: a
    // zone you can no longer deliver to and a slab you can no longer hit are
    // different mistakes, so this is its own kind rather than areaUnreachable.
    const lvl = level([{ kind: "space", threshold: 40 }, { kind: "smashed", count: 1 }]);
    const game = board(lvl);
    game.activePlaySeconds = 5;
    buryTheSlab(game);
    const h = harness();
    evaluateWinConditions(game, lvl, 5, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();
    expect(h.calls.timedOutWith, "burying the slab ended nothing").toHaveLength(1);
    expect((h.calls.timedOutWith[0] as MapFailure).kind).toBe("objectiveBuried");
    expect(h.lives(), "the run ended instead of costing a life").toBe(2);
  });

  it("stays quiet while the slab is still reachable", () => {
    const lvl = level([{ kind: "space", threshold: 40 }, { kind: "smashed", count: 1 }]);
    const game = board(lvl);
    game.activePlaySeconds = 5;
    const h = harness();
    evaluateWinConditions(game, lvl, 5, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();
    expect(h.calls.timedOutWith, "failed a map that was still playable").toHaveLength(0);
  });

  it("leaves the lock-out to say it when nothing is in play", () => {
    // With every ball sealed the slab is unreachable because nothing is moving,
    // not because of where the fences went. Blaming the slab would point at the
    // last cut for a decision made several cuts earlier.
    const lvl = level([{ kind: "space", threshold: 40 }, { kind: "smashed", count: 1 }]);
    const game = board(lvl);
    game.activePlaySeconds = 5;
    game.balls = game.balls.map(b => ({ ...b, state: "won", speed: 0 })) as typeof game.balls;
    game.lockedBallsCount = game.balls.length;
    buryTheSlab(game);
    const h = harness();
    evaluateWinConditions(game, lvl, 5, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();
    expect(h.calls.timedOutWith).toHaveLength(1);
    expect((h.calls.timedOutWith[0] as MapFailure).kind).toBe("lockedOut");
  });

  it("has words for the new kind in all three locales", () => {
    for (const lang of ["en", "es", "sv"]) {
      const node = JSON.parse(readFileSync(
        resolve(process.cwd(), `src/i18n/locales/${lang}.json`), "utf8"),
      ).mapFailure as Record<string, string>;
      expect(node.objectiveBuried, `${lang} cannot name objectiveBuried`).toBeTruthy();
    }
  });
});

/**
 * The refusal is WIRED, not merely available.
 *
 * The helper below had four passing tests while the call site was deleted:
 * every one of them asked `regionHoldsNeededSlab` a question directly, and none
 * asked the lock decision anything. A guard nothing calls refuses nothing.
 *
 * Same shape as portal.test.ts, which pins the sibling rule: a control that
 * proves the pocket DOES lock, and then the same pocket refusing.
 */
describe("the lock decision actually asks", () => {
  /**
   * Seal a ring around the ball, on the slab, and report what the ball became.
   *
   * Takes a RUN SEED because the deal is rotated off it and the fixture has to
   * survive every rotation. `setRunSeedText` is global and leaks in from
   * whichever test file ran before this one, so a fixture that only worked on
   * one deal is a fixture that passes locally and fails on CI - which is
   * exactly what this one did. Measured: the same slab lands at 420,400 or
   * 480,500 or 500,420 (rotated 90 degrees, 40x200 becoming 200x40) depending
   * on the seed.
   */
  const sealOnTheSlab = (smashedAlready: boolean, seed: string | null = null): string => {
    setRunSeedText(seed);
    const lvl = level([{ kind: "smashed", count: 1 }]);
    const game = board(lvl);
    // The lock path writes to counters createInitialGameData does not seed
    // (it builds a BOARD, not a run in progress), so they are set here the way
    // portal.test.ts does for the sibling rule.
    game.assimilations = new Map();
    game.lockBonus = 0; game.lockDeliveryBonus = 0; game.superiorLockBonus = 0;
    game.superiorLockCount = 0; game.zoneLockBonus = 0; game.zoneLockCount = 0;
    game.multiLockBonus = 0; game.multiLockBest = 1;
    game.lockedBallsCount = 0; game.moneyMultiplier = 1;
    const grid = game.spaceGrid!;
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    d.destroyed = smashedAlready;

    // Park the ball beside the slab, then wall a small box round the pair, so
    // the pocket is tiny enough to lock by percent and demonstrably holds it.
    //
    // Placed from the slab's RUNTIME polygon, never from the authored SLAB
    // constant. Authored coordinates are not runtime coordinates - the deal is
    // rotated off the level id (MAP_DESIGN_GUIDELINES 7.3) - so `SLAB.x - 30`
    // is beside the slab on some rotations and across the board on others.
    // That is exactly how this test passed locally and failed on CI: vitest
    // ordered the files differently, the seed differed, and the ball landed
    // nowhere near the slab, so the pocket held nothing and locked.
    const verts = d.obstaclePolygon!.vertices;
    const cx = verts.reduce((a, v) => a + v.x, 0) / verts.length;
    const cy = verts.reduce((a, v) => a + v.y, 0) / verts.length;
    const half = Math.max(...verts.map(v => Math.abs(v.x - cx)));
    const ball = game.balls[0];
    ball.position = { x: cx - half - 22, y: cy };
    ball.state = "active";
    ball.speed = 100;
    for (const other of game.balls.slice(1)) { other.state = "won"; other.speed = 0; }

    const idx = worldToGridIndex(grid, ball.position.x, ball.position.y);
    const col = idx % grid.width, row = Math.floor(idx / grid.width);
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== 4) continue;
        const c = col + dc, r = row + dr;
        if (c >= 0 && c < grid.width && r >= 0 && r < grid.height) {
          grid.cells[r * grid.width + c] = CellState.REMOVED;
        }
      }
    }
    // The pocket must actually CONTAIN the slab, or "it did not lock" would be
    // true for the wrong reason and "it locked" would prove nothing. The
    // control (already-smashed) cannot catch a mis-placed ball, because with
    // the slab spent there is no refusal either way.
    const region = findGridRegionForBall(grid, buildGridRegionMap(findGridRegions(grid)),
      ball.position.x, ball.position.y);
    const held = region
      ? regionHoldsNeededSlab({ ...game, destructibles: [{ ...d, destroyed: false }] } as CanvasGameState,
          resolveWinSpec(lvl), region.cellIndices)
      : false;
    expect(held, "the fixture sealed a pocket that does not hold the slab").toBe(true);

    const noop = () => {};
    checkAndUpdateBallWonStates(
      game, DEFAULT_MODIFIERS, 0,
      { setLockedBallsCount: noop, onBallTypeLocked: () => false, onBallCountChanged: noop, onBossState: noop },
      null, null, resolveWinSpec(lvl),
    );
    return ball.state;
  };

  // The deals that put the slab in three different places, including the one
  // that rotates it. Running every case on all of them is the point.
  const SEEDS = [null, "a", "b", "c"];

  it.each(SEEDS)("locks that pocket once the slab is smashed (seed %s)", (seed) => {
    // The control. Without it the next test passes on any pocket that simply
    // never locks, which is most of them.
    expect(sealOnTheSlab(true, seed), "the control pocket does not lock at all").toBe("won");
  });

  it.each(SEEDS)("refuses it while the slab still has to be broken (seed %s)", (seed) => {
    expect(sealOnTheSlab(false, seed), "sealed a ball in with the slab it still had to break")
      .not.toBe("won");
  });
});

describe("a pocket around an unbroken slab is not a pocket", () => {
  it("refuses a region that holds one", () => {
    const lvl = level([{ kind: "smashed", count: 1 }]);
    const game = board(lvl);
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    const ring = strikeCells(game.spaceGrid!, d, 18);
    expect(regionHoldsNeededSlab(game, resolveWinSpec(lvl), ring)).toBe(true);
  });

  it("allows a region nowhere near one", () => {
    const lvl = level([{ kind: "smashed", count: 1 }]);
    const game = board(lvl);
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    const ring = new Set(strikeCells(game.spaceGrid!, d, 18));
    const far = [...game.spaceGrid!.cells.keys()].filter(i => !ring.has(i)).slice(0, 40);
    expect(far.length, "the board has no cells away from the slab").toBeGreaterThan(0);
    expect(regionHoldsNeededSlab(game, resolveWinSpec(lvl), far)).toBe(false);
  });

  it("stops refusing once the clause is satisfied", () => {
    // Past the requirement the slabs stop being objectives, and a pocket around
    // one is an ordinary lock again. Refusing forever would take a legitimate
    // seal away on every breakable map for no benefit.
    const lvl = level([{ kind: "smashed", count: 1 }]);
    const game = board(lvl);
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    const ring = strikeCells(game.spaceGrid!, d, 18);
    d.destroyed = true;
    expect(regionHoldsNeededSlab(game, resolveWinSpec(lvl), ring)).toBe(false);
  });

  it("frees the OTHER slab once the count is met", () => {
    // Where "stop refusing" actually bites, and the version above cannot see:
    // with one slab it is unbroken-or-nothing, so skipping broken slabs in the
    // loop gives the same answer as the satisfied check and the check looks
    // redundant. Two slabs and a `smashed 1` clause separate them - break one,
    // and a pocket round the second must become an ordinary lock.
    const lvl = level([{ kind: "smashed", count: 1 }], [SLAB, { ...SLAB, id: "slab-2", x: 200 }]);
    const game = board(lvl);
    const [first, second] = game.destructibles!.filter(x => x.kind === "breakable");
    const ring = strikeCells(game.spaceGrid!, second, 18);
    expect(regionHoldsNeededSlab(game, resolveWinSpec(lvl), ring),
      "the second slab was not refused while a smash was still owed").toBe(true);
    first.destroyed = true;
    expect(regionHoldsNeededSlab(game, resolveWinSpec(lvl), ring),
      "still refusing a pocket on a map whose smash clause is already met").toBe(false);
  });

  it("does not refuse on a map with no smash clause", () => {
    const lvl = level([{ kind: "space", threshold: 40 }]);
    const game = board(lvl);
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    const ring = strikeCells(game.spaceGrid!, d, 18);
    expect(regionHoldsNeededSlab(game, resolveWinSpec(lvl), ring)).toBe(false);
  });
});
