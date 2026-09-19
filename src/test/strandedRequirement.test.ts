/**
 * A map that can no longer be won has to SAY so, whichever clause was lost.
 *
 * Two clauses already did. A gate zone no ball can enter fails as
 * `areaUnreachable`; a needed slab fenced off alone fails as `objectiveBuried`.
 * Both were written one per mechanic, and level 2 is what that left behind.
 *
 * Its win is `splitLocks 1`: one ball sealed on each side of the midline. Close
 * the doorway with both balls on the left and the right half captures as
 * claimed ground, so the right-hand lock is impossible forever - with both
 * balls still bouncing and the board looking perfectly playable. Nothing
 * noticed, and levels 1-3 have no map deadline (mapTiming: the tutorial band
 * plays without a clock), so there was not even a timeout to end it. Measured
 * before this existed: 100 seconds of play, no win, no failure, no life lost.
 * The only exit was to lock the last ball on the wrong side ON PURPOSE, which
 * trips `lockedOut`, and nothing on screen suggests that.
 *
 * So the question is asked once now, for the whole union (requirementReach.ts).
 * These tests cover both directions, and the second one matters more: this
 * costs a life, and a stranding check that is wrong takes a map the player
 * could still have won. The level 8 loop is the warning - a check that fires on
 * frame one costs the whole run, one retry at a time - so every "cannot tell"
 * here has to come out as "keep playing".
 */
import { describe, it, expect } from "vitest";
import {
  createBotGame, stepBot, plainModifiers, installClock, releaseClock, type BotGame,
} from "@/lib/bot/headlessGame";
import { LADDER, byLevel } from "./fixtures/maps";
import { runBot } from "@/lib/bot/runBot";
import { setRunSeedText } from "@/lib/runRng";
import { lostRequirement, clauseStillPossible } from "@/lib/physics/requirementReach";
import { evaluateWinConditions, readWinSnapshot } from "@/lib/physics/applyCut";
import { resolveWinSpec, NO_RUN_RULES } from "@/lib/winSpec";
import { CellState, findGridRegions, type SpaceGrid } from "@/lib/spaceGrid";
import { BOARD_WIDTH } from "@/lib/boardConstants";
import type { CanvasGameState } from "@/types/gameState";
import type { WinCondition, WinSnapshot } from "@/types/winSpec";

/** Give every surviving cell the id of the region it is actually in. */
function repaintRegions(grid: SpaceGrid): void {
  grid.cellRegionIds.fill(null);
  for (const region of findGridRegions(grid)) {
    for (const idx of region.cellIndices) grid.cellRegionIds[idx] = region.id;
  }
}

/** Claim every open cell on one side of a vertical line, as a capture would. */
function claimSideOf(grid: SpaceGrid, line: number, right: boolean): void {
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const x = grid.originX + col * grid.cellSize + grid.cellSize / 2;
      if ((x >= line) === right) grid.cells[row * grid.width + col] = CellState.REMOVED;
    }
  }
  repaintRegions(grid);
}

const LEVEL_2 = byLevel(LADDER, 2)!;
const SPEC_2 = resolveWinSpec(LEVEL_2, NO_RUN_RULES);

/** A dealt, stepped level 2 with both balls parked on the left of the midline. */
function level2(): BotGame {
  installClock();
  setRunSeedText("stranded-l2");
  const ctx = createBotGame(LEVEL_2, 2, plainModifiers());
  for (let i = 0; i < 60; i++) stepBot(ctx);
  const game = ctx.game;
  for (const ball of game.balls) {
    ball.position = { x: 200, y: 400 + game.balls.indexOf(ball) * 60 };
  }
  // The board has been cut at least once: both stranding checks describe what a
  // FENCE did, and before the first one there is nothing for them to be true
  // about. See the loop this guard closes in applyCut.
  game.wallCount = 1;
  repaintRegions(game.spaceGrid!);
  return ctx;
}

const snapOf = (ctx: BotGame): WinSnapshot => readWinSnapshot(ctx.game, ctx.level);

describe("level 2, the map you could get stuck on", () => {
  it("is not lost while both sides are still open", () => {
    const ctx = level2();
    expect(lostRequirement(ctx.game, SPEC_2, snapOf(ctx)),
      "a fresh board reads as already lost - this would fail the map on sight")
      .toBeNull();
    releaseClock();
  });

  it("is lost once the unpaid side is claimed ground", () => {
    // THE regression, in one cut's worth of state: the right half captured with
    // both balls on the left, which is what closing the doorway does.
    const ctx = level2();
    claimSideOf(ctx.game.spaceGrid!, BOARD_WIDTH / 2, true);
    const lost = lostRequirement(ctx.game, SPEC_2, snapOf(ctx));
    expect(lost?.kind, "the far side is gone and nothing noticed").toBe("splitLocks");
    releaseClock();
  });

  it("ends the map with a life, rather than running on forever", () => {
    // What the player actually gets. Level 2 has no deadline, so before this
    // the alternative was not a slow ending, it was no ending.
    const ctx = level2();
    claimSideOf(ctx.game.spaceGrid!, BOARD_WIDTH / 2, true);
    evaluateWinConditions(ctx.game, ctx.level, 2, ctx.modifiers, ctx.callbacks);
    expect(ctx.game.failure?.kind).toBe("requirementUnreachable");
    expect(ctx.events.livesLost, "the map ended without costing anything").toBe(1);
    expect(ctx.events.levelComplete, "a stranded map was reported as won").toBe(false);
    releaseClock();
  });

  it("says what was still missing, not just that it ended", () => {
    const ctx = level2();
    claimSideOf(ctx.game.spaceGrid!, BOARD_WIDTH / 2, true);
    evaluateWinConditions(ctx.game, ctx.level, 2, ctx.modifiers, ctx.callbacks);
    const unmet = ctx.game.failure!.unmet.map(p => p.condition.kind);
    expect(unmet, "the reason names no requirement").toContain("splitLocks");
    releaseClock();
  });

  it("never fires before the player has cut", () => {
    // The loop that ate a run on level 8: a map failing on a board property at
    // frame one shows the overlay, the retry remounts into the same frame, and
    // it fails again until the lives are gone.
    const ctx = level2();
    ctx.game.wallCount = 0;
    claimSideOf(ctx.game.spaceGrid!, BOARD_WIDTH / 2, true);
    evaluateWinConditions(ctx.game, ctx.level, 2, ctx.modifiers, ctx.callbacks);
    expect(ctx.game.failure, "an untouched board failed itself").toBeUndefined();
    expect(ctx.events.livesLost).toBe(0);
    releaseClock();
  });

  it("leaves a side that is already paid alone", () => {
    // A clause satisfied by where the locks ALREADY are cannot be un-met by
    // ground going away afterwards, which is every map's endgame.
    const ctx = level2();
    ctx.game.lockPoints = [{ x: 200, y: 400 }, { x: 700, y: 400 }];
    claimSideOf(ctx.game.spaceGrid!, BOARD_WIDTH / 2, true);
    expect(lostRequirement(ctx.game, SPEC_2, snapOf(ctx))).toBeNull();
    releaseClock();
  });

  it("counts the paid side the way the gate counts it", () => {
    // One lock on the right, nothing on the left, and the LEFT half taken. The
    // side that is gone is the side that still owed, so the map is lost - and
    // if the two halves were swapped anywhere in here, this would pass by
    // reading the wrong one as already paid.
    const ctx = level2();
    ctx.game.lockPoints = [{ x: 700, y: 400 }];
    claimSideOf(ctx.game.spaceGrid!, BOARD_WIDTH / 2, false);
    expect(lostRequirement(ctx.game, SPEC_2, snapOf(ctx))?.kind).toBe("splitLocks");
    releaseClock();
  });
});

// ── The other clauses that name a place, on a board built by hand ──────────

/** A 10x10 board of 10-unit cells, all open, all one region. */
function openGrid(): SpaceGrid {
  const cells = new Uint8Array(100).fill(CellState.ACTIVE);
  return {
    cellSize: 10, width: 10, height: 10, originX: 0, originY: 0,
    cells, initialActiveCount: 100, activeCount: 100,
    cellRegionIds: new Array(100).fill("region-1"),
  } as unknown as SpaceGrid;
}

function boardWith(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    spaceGrid: openGrid(),
    balls: [{ id: "b1", state: "active", position: { x: 5, y: 5 } }],
    destructibles: [], deliveryBoxes: [], circuit: null, dataStream: null,
    ...over,
  } as unknown as CanvasGameState;
}

/** Claim one cell, by its row and column. */
function claim(grid: SpaceGrid, col: number, row: number): void {
  grid.cells[row * grid.width + col] = CellState.REMOVED;
  grid.cellRegionIds[row * grid.width + col] = null;
}

const snap = (over: Partial<WinSnapshot> = {}): WinSnapshot => ({
  remainingPercent: 50, lockedBalls: 0, superiorLocks: 0, areaTargets: 0,
  lockedByType: {}, lockPoints: [], mapRotation: 0, delivered: 0, smashed: 0, terminals: 0,
  harvested: 0, bossDefeated: false, allLocked: false, cuts: 1, par: 6,
  activeSeconds: 0, ...over,
});

describe("a terminal is lit by a fence, so it is lost when its ground is", () => {
  const term = (x: number, y: number, lit = false) => ({ x, y, radius: 6, lit, ballId: "d1" });
  const clause: WinCondition = { kind: "terminals", count: 1 };

  it("is fine while the terminal still stands on open ground", () => {
    const game = boardWith({ circuit: { terminals: [term(55, 55)] } as never });
    expect(clauseStillPossible(game, clause, snap())).toBe(true);
  });

  it("is lost once every unlit terminal is under claimed space", () => {
    const game = boardWith({ circuit: { terminals: [term(55, 55)] } as never });
    const grid = game.spaceGrid!;
    for (let c = 4; c <= 6; c++) {
      for (let r = 4; r <= 6; r++) claim(grid, c, r);
    }
    expect(clauseStillPossible(game, clause, snap())).toBe(false);
  });

  it("counts a terminal already lit, and the ones still reachable", () => {
    // Two terminals, one buried, one open, and the map wants one lit: still on.
    const game = boardWith({ circuit: { terminals: [term(55, 55), term(15, 15)] } as never });
    const grid = game.spaceGrid!;
    for (let c = 4; c <= 6; c++) {
      for (let r = 4; r <= 6; r++) claim(grid, c, r);
    }
    expect(clauseStillPossible(game, clause, snap())).toBe(true);
    expect(clauseStillPossible(game, { kind: "terminals", count: 2 }, snap()),
      "two are wanted and only one can still be lit").toBe(false);
  });
});

describe("a seam span is harvested by a fence, and reads the same way", () => {
  const stream = (harvested: boolean[]) => ({
    path: [{ x: 5, y: 5 }, { x: 5, y: 45 }, { x: 5, y: 95 }],
    width: 8, reward: { kind: "overtime", value: 1 }, harvested, freezeProgress: 0,
  });

  it("is fine while a span still has open ground", () => {
    const game = boardWith({ dataStream: stream([false, false]) as never });
    expect(clauseStillPossible(game, { kind: "harvested", count: 1 }, snap())).toBe(true);
  });

  it("is lost when every unharvested span is buried", () => {
    const game = boardWith({ dataStream: stream([false, false]) as never });
    const grid = game.spaceGrid!;
    for (let r = 0; r < 10; r++) claim(grid, 0, r);
    expect(clauseStillPossible(game, { kind: "harvested", count: 1 }, snap())).toBe(false);
  });
});

describe("a delivery box needs a ball that can still get into it", () => {
  const box = (x: number, delivered = 0, reserved: number[] = []) => ({
    id: "box", inner: { x, y: 10, width: 20, height: 20 },
    mouth: "left", capacity: 1, delivered, reservedCells: reserved,
  });
  const clause: WinCondition = { kind: "delivered", count: 1 };

  it("is fine while a ball shares a region with the box", () => {
    expect(clauseStillPossible(boardWith({ deliveryBoxes: [box(60)] as never }), clause, snap()))
      .toBe(true);
  });

  it("is lost when the box interior is claimed ground", () => {
    const game = boardWith({ deliveryBoxes: [box(60)] as never });
    const grid = game.spaceGrid!;
    for (let c = 6; c <= 8; c++) {
      for (let r = 1; r <= 3; r++) claim(grid, c, r);
    }
    expect(clauseStillPossible(game, clause, snap())).toBe(false);
  });

  it("keeps playing while the box is holding its own cells off the board", () => {
    // A reserving box removes its cells until it is full. They read exactly
    // like claimed ground and are nothing of the sort, which is the same trap
    // level 8's unbroken reveal set for the gate check.
    const game = boardWith({ deliveryBoxes: [box(60, 0, [])] as never });
    const grid = game.spaceGrid!;
    const reserved: number[] = [];
    for (let c = 6; c <= 8; c++) {
      for (let r = 1; r <= 3; r++) {
        claim(grid, c, r);
        reserved.push(r * grid.width + c);
      }
    }
    (game.deliveryBoxes![0] as unknown as { reservedCells: number[] }).reservedCells = reserved;
    expect(clauseStillPossible(game, clause, snap()),
      "a box that reserves its own space failed the map").toBe(true);
  });
});

describe("what this check refuses to have an opinion about", () => {
  it("never loses a clause that only counts", () => {
    // Locks, superior locks, a named ball: these run out of BALLS, never out of
    // board, and that ending already has a truer reason (lockedOut). A count
    // check here would also have to model balls that have not spawned yet.
    const game = boardWith({ balls: [] as never });
    const counting: WinCondition[] = [
      { kind: "locks", count: 3 },
      { kind: "superiorLocks", count: 2 },
      { kind: "lockType", ballType: "red", count: 1 },
      { kind: "allLocked" },
    ];
    for (const c of counting) {
      expect(clauseStillPossible(game, c, snap()), `${c.kind} was called lost`).toBe(true);
    }
  });

  it("leaves the area and smash clauses to the guards that own them", () => {
    // Both were written first and know more than this does - a gate's target
    // roster, a slab's striking radius. Two checks racing to fail the same map
    // would make the reason a coin toss.
    const game = boardWith();
    expect(clauseStillPossible(game, { kind: "area", count: 1 }, snap())).toBe(true);
    expect(clauseStillPossible(game, { kind: "smashed", count: 1 }, snap())).toBe(true);
  });

  it("says nothing about a board it cannot read", () => {
    const game = boardWith({ spaceGrid: null });
    expect(clauseStillPossible(game, { kind: "terminals", count: 1 }, snap())).toBe(true);
  });

  it("treats a map with none of the thing as an authoring fault, not a loss", () => {
    // winSpecProblems refuses a clause the map has no furniture for, and the
    // builder flags it. Failing the player for it would report their cut as the
    // cause of a map that never had a chance.
    const game = boardWith();
    expect(clauseStillPossible(game, { kind: "delivered", count: 1 }, snap())).toBe(true);
    expect(clauseStillPossible(game, { kind: "terminals", count: 1 }, snap())).toBe(true);
    expect(clauseStillPossible(game, { kind: "harvested", count: 1 }, snap())).toBe(true);
  });
});

describe("and it stays out of the way of every other map", () => {
  /**
   * The check costs a life, so the thing to prove is not only that it fires
   * where it should. A sweep of real play over the whole ladder: the maps whose
   * win names no place (a clear, a lock count, a smash, a boss) must never see
   * this ending, whatever the bot does to their boards.
   *
   * Level 2 is excluded from the assertion rather than from the sweep - it is
   * the one shipped map that CAN legitimately end this way, which is the whole
   * point - and the run is printed so a sudden crop of them is visible.
   */
  const POSITIONAL = new Set(["splitLocks", "delivered", "terminals", "harvested"]);

  // An explicit timeout, and not a generous default: this plays two real runs
  // of every shipped map, which took 15s here and past vitest's 30s default on
  // CI once the cut refusal (smashReach.cutWouldBurySmashes) started simulating
  // each fence. A sweep that fails for being slow teaches nothing about maps.
  it("never strands a map that names no place", () => {
    const stranded: string[] = [];
    for (const level of LADDER) {
      const n = level.level ?? 0;
      const spec = resolveWinSpec(level, NO_RUN_RULES);
      const positional = spec.require.some(c => POSITIONAL.has(c.kind));
      for (const seed of [1, 2]) {
        const result = runBot(level, n, seed, { maxFrames: 1800 });
        if (result.failKind !== "requirementUnreachable") continue;
        stranded.push(`L${n} seed ${seed}${positional ? " (positional)" : ""}`);
        expect(positional, `level ${n} was stranded on a win with no place in it`).toBe(true);
      }
    }
    if (stranded.length > 0) console.log("stranded runs:", stranded.join(", "));
  }, 180000);
});

describe("a map that never had a chance is not the player's fault", () => {
  /**
   * The trap this check could have walked into. `clauseStillPossible` asks
   * whether the board can still deliver what the clause wants - and on a map
   * that asks for three terminals and carries two, the answer is no on the
   * first frame, so the first cut would have failed the map and blamed the cut.
   *
   * That is an authoring fault: winSpecProblems refuses these counts and the
   * builder flags them. Nothing can be LOST that was never there, which is the
   * argument smashRequirementLost already makes about a map with no breakables.
   */
  it("ignores a clause the map was never furnished for", () => {
    const game = boardWith({
      circuit: { terminals: [{ x: 15, y: 15, radius: 6, lit: false, ballId: "d" }] } as never,
      dataStream: {
        path: [{ x: 5, y: 5 }, { x: 5, y: 45 }], width: 8,
        reward: { kind: "overtime", value: 1 }, harvested: [false], freezeProgress: 0,
      } as never,
      deliveryBoxes: [{
        id: "box", inner: { x: 60, y: 10, width: 20, height: 20 },
        mouth: "left", capacity: 1, delivered: 0, reservedCells: [],
      }] as never,
    });
    const grid = game.spaceGrid!;
    for (let c = 0; c < 10; c++) {
      for (let r = 0; r < 10; r++) claim(grid, c, r);   // nothing open anywhere
    }
    for (const c of [
      { kind: "terminals", count: 2 },
      { kind: "harvested", count: 2 },
      { kind: "delivered", count: 2 },
    ] as WinCondition[]) {
      expect(clauseStillPossible(game, c, snap()),
        `${c.kind} blamed the player for a map that asked for more than it had`).toBe(true);
    }
  });

  it("still fails the same board when the map asked for what it had", () => {
    // The other side of it: one of each is what the map carries, one of each is
    // what it wants, and all of it is now under claimed ground.
    const game = boardWith({
      circuit: { terminals: [{ x: 15, y: 15, radius: 6, lit: false, ballId: "d" }] } as never,
      dataStream: {
        path: [{ x: 5, y: 5 }, { x: 5, y: 45 }], width: 8,
        reward: { kind: "overtime", value: 1 }, harvested: [false], freezeProgress: 0,
      } as never,
      deliveryBoxes: [{
        id: "box", inner: { x: 60, y: 10, width: 20, height: 20 },
        mouth: "left", capacity: 1, delivered: 0, reservedCells: [],
      }] as never,
    });
    const grid = game.spaceGrid!;
    for (let c = 0; c < 10; c++) {
      for (let r = 0; r < 10; r++) claim(grid, c, r);
    }
    for (const c of [
      { kind: "terminals", count: 1 },
      { kind: "harvested", count: 1 },
      { kind: "delivered", count: 1 },
    ] as WinCondition[]) {
      expect(clauseStillPossible(game, c, snap()), `${c.kind} survived a buried board`).toBe(false);
    }
  });
});
