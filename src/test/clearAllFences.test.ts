/**
 * Clear Fences ability (#38, the risky one).
 *
 * Three versions, and the first two are why this file is worth reading.
 *
 * v1 dropped EVERY fence and kept only the locked CELLS captured, leaving a
 * tinted pocket floating in reopened space with no walls around it. v2 kept the
 * fences that bordered locked ground, which left walls running to the far side
 * of the board. v3 trimmed those to the bordering stretch, which still left
 * stubs. All three failed the same way: whether a given fence is "part of" a
 * pocket is not a question a proximity probe answers well.
 *
 * v4 stops asking. Every fence goes, and each pocket's own outline is traced,
 * straightened to its real corners, and rebuilt as fresh walls. What this file
 * pins down is that the two halves hold together: the mess goes (space reopens,
 * remaining % rises) and what remains is the pockets, drawn on the lines the
 * player cut, standing on captured ground, and nothing else anywhere.
 *
 * Built on a real grid via createInitialGameData + a couple of cuts that lock a
 * ball, mirroring destroyRecapture.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({
  playBallLockSound: () => {}, playWallHitSound: () => {}, playBallCollideSound: () => {},
  playFenceBreakSound: () => {}, playDeathSound: () => {}, playCutClaimedSound: () => {},
  playLevelCompleteSound: () => {},
}));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
}));

import { createInitialGameData } from "@/lib/initGame";
import { applyCutFn } from "@/lib/physics/applyCut";
import { clearAllFences } from "@/lib/abilityEffects";
import { CellState, getRemainingPercent } from "@/lib/spaceGrid";
import { pointToSegmentDistance } from "@/lib/polygon";
import { GameModifiers } from "@/hooks/useActiveModifiers";
import { LevelConfig } from "@/types/level";
import { GrowingWall, Vector2 } from "@/types/game";
import { CanvasGameState } from "@/types/gameState";
import { BALL_WON_REGION_THRESHOLD } from "@/lib/gameConstants";

const MODS: GameModifiers = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1, fenceGenerationSpeedMultiplier: 1,
  scoreMultiplier: 1, shopDiscountMultiplier: 1, pushBonusMultiplier: 1,
  instantFencesPerMap: 0, additionalConcurrentFences: 0, extraLives: 0, extraShopItems: 0,
  shopRestockCount: 0, extraContinues: 0, extraCertificateHours: 0,
  startingCapturePercent: 0, fenceDurabilityBonus: 0, microManagerPerLock: 0,
  fastestBallSlowPercent: 0,
  ballPathPredictionBounces: 0, ballPathPredictionBalls: 0, disablePushYourLuck: 0, ballFreezeDuration: 0,
  freezeUsesPerMap: 0, slowOneBallFactor: 0, freezePickups: 0, ballFreezeCount: 0, autoFreezeDuration: 0, showHighscoreProgress: 0,
  overtimePerLock: 0, overtimePerSuperiorLock: 0, fenceSpeedPerLock: 0, frozenLockBonus: 0, gravityLockBonus: 0, gravityBendMultiplier: 1,
  simultaneousLockBonus: 0, freezeNoCooldown: 0, fenceSpeedPerFence: 0, fenceSpeedPerMapCleared: 0, underParInstantFence: 0,
  bankedSlowPer50h: 0, spaceBonusMultiplier: 1, overtimeCapBonus: 0, freeCheapestOffer: 0,
  wallShieldsPerMap: 0, fenceGraceMs: 0, shipEarlySecondsPerBall: 0,
  scopeCreepImmediate: 0, shipEarlyBonusMultiplier: 1,
  runwayInstantFenceAt: 0, runwayConcurrentFenceAt: 0, runwayFreezeAt: 0,
  spendInstantFencePerChunk: 0, spendFenceSpeedPerChunk: 0, spendCapturePerChunk: 0, spendChunkCapBonus: 0,
  lockThresholdBonus: 0, spawnFreezeSeconds: 0, pickupChanceBonus: 0, pickupPayoutLevel: 0,
  destructibleHitsReduction: 0, breakMultiplierBonus: 0, smashKeepsLockMultiplier: 0,
  startingOvertime: 0, storeLockRelief: 0, parBonus: 0, underParBonusMultiplier: 1,
};

// Obstacle top-left; no random shapes (cell-coverage test, per the flaky-locktint
// lesson) so capture is deterministic.
const LEVEL: LevelConfig = {
  id: "clear-fences", level: 2, sizeThreshold: 40, expectedCuts: 5, points: 40,
  maxBalls: 2, variety: 0, randomShapes: 0,
  entities: [
    { id: "wall-1", kind: "wall", shape: "rect", x: -11, y: -11, width: 400, height: 180 },
  ],
} as unknown as LevelConfig;

function makeGame(): CanvasGameState {
  const data = createInitialGameData(LEVEL, 2, MODS);
  return {
    spaceGrid: data.spaceGrid, gridRegions: data.gridRegions, regions: data.regions,
    walls: data.walls, obstaclePolygons: data.obstaclePolygons, mirrorPolygons: data.mirrorPolygons,
    boardPolygon: data.boardPolygon, originalArea: data.originalArea,
    basePlayableArea: data.basePlayableArea, balls: data.balls, movers: data.movers,
    activeWalls: [], gameOver: false, levelComplete: false,
    swipeStart: null, swipeRegionId: null, currentSwipePos: null, swipePointerId: null,
    swipeTrail: null, lastTime: 0, accumulator: 0, animationId: 0, lastAutoFreezeAt: 0,
    screenSize: { width: 900, height: 900 },
    boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
    backgroundColor: "#0a1a10", regionColor: "#1a3020", wallCount: 0,
    wallShieldsRemaining: 0, fastestBallId: data.fastestBallId,
    pushMode: "none", bestRemainingPercent: 100, pushStartPercent: 100,
    levelClearedTime: 0, shimmerStart: 0, shimmerFrozen: false, gameLoopFn: null,
    isRecovering: false, recoveryEndTime: 0, initialSamplePoints: data.initialSamplePoints,
    frozenBallId: null, frozenBallVelocity: null, frozenBallPosition: null,
    lockedBallsCount: 0, lockBonus: 0, superiorLockCount: 0, superiorLockBonus: 0, moneyMultiplier: 1, ballSpeedScale: 1,
    assimilations: new Map(), dissolve: null, bonusCutCells: new Set(),
    lockWinThresholdPercent: BALL_WON_REGION_THRESHOLD, lockMinRegionCells: 0,
    fenceDurability: null, pendingWallBreaks: [], destructibles: data.destructibles,
    pendingDestroys: [], objectDebris: [], stackObjects: data.stackObjects,
    fallingObjects: [], objectivesTotal: data.objectivesTotal, objectivesBroken: 0,
    breakBonus: 0, lastDudAt: 0, activePlaySeconds: 0,
  } as unknown as CanvasGameState;
}

const noopCallbacks = new Proxy({}, {
  get: (_t, prop) => (prop === "then" ? undefined : () => {}),
}) as never;

function completedWall(origin: Vector2, a: Vector2, b: Vector2): GrowingWall {
  return {
    origin, direction: { x: 0, y: 0 },
    startWaypoints: [origin, a], endWaypoints: [origin, b],
    startSegmentIndex: 0, endSegmentIndex: 0,
    startPoint: a, endPoint: b, targetStart: a, targetEnd: b,
    thickness: 6, isComplete: true, activeRegionId: "",
  };
}

/** Seal the top-left pocket with two cuts; the pocket ball locks. */
function sealPocket(game: CanvasGameState): void {
  game.balls = game.balls.slice(0, 2);
  const [A, B] = game.balls;
  A.position = { x: 200, y: 210 }; A.velocity = { x: 80, y: 60 }; A.speed = 100;
  B.position = { x: 620, y: 420 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;
  applyCutFn(completedWall({ x: 64, y: 500 }, { x: 64, y: 169 }, { x: 64, y: 855 }), game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
  applyCutFn(completedWall({ x: 175, y: 320 }, { x: 285, y: 169 }, { x: 64, y: 472 }), game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
}

const isFenceWall = (id: string) => !id.startsWith("board-") && !id.startsWith("obstacle-");

/**
 * Seal the BOTTOM-RIGHT board corner with one diagonal cut, so the pocket is
 * bounded by two board edges and nothing else. The outline's two loose ends
 * then have only the frame to reach, which is the case the fixture above
 * cannot produce: its pocket lands on an obstacle face instead.
 */
function sealCornerPocket(game: CanvasGameState): void {
  game.balls = game.balls.slice(0, 2);
  const [A, B] = game.balls;
  A.position = { x: 780, y: 780 }; A.velocity = { x: 40, y: 40 }; A.speed = 57;
  B.position = { x: 300, y: 500 }; B.velocity = { x: -70, y: 90 }; B.speed = 114;
  applyCutFn(
    completedWall({ x: 780, y: 640 }, { x: 855, y: 620 }, { x: 620, y: 855 }),
    game, LEVEL, 2, MODS, false, false, 0, noopCallbacks,
  );
}

// Mirrors the constants in abilityEffects.ts, in cells (cellSize is 15 here).
const LOCK_ADJACENCY = 2;
const TRIM_MARGIN = 1.5;

const clear = (game: CanvasGameState) =>
  clearAllFences(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {} });

/** Fence walls remaining, as "(x,y)->(x,y)" for readable assertions. */
const fenceSegments = (game: CanvasGameState) =>
  game.walls.filter(w => isFenceWall(w.id))
    .map(w => `(${Math.round(w.start.x)},${Math.round(w.start.y)})->(${Math.round(w.end.x)},${Math.round(w.end.y)})`);

const fenceWalls = (game: CanvasGameState) => game.walls.filter(w => isFenceWall(w.id));

const midpoint = (w: { start: Vector2; end: Vector2 }) => ({
  x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2,
});

/** World point -> cell index. */
const cellAt = (game: CanvasGameState, p: Vector2) => {
  const g = game.spaceGrid!;
  const col = Math.floor((p.x - g.originX) / g.cellSize);
  const row = Math.floor((p.y - g.originY) / g.cellSize);
  return row * g.width + col;
};

/** True when any cell within `cells` of p is locked ground. */
function nearLocked(game: CanvasGameState, p: Vector2, cells: number): boolean {
  const g = game.spaceGrid!;
  const lock = g.lockCaptured!;
  const span = Math.ceil(cells);
  const col0 = Math.floor((p.x - g.originX) / g.cellSize);
  const row0 = Math.floor((p.y - g.originY) / g.cellSize);
  for (let row = row0 - span; row <= row0 + span; row++) {
    for (let col = col0 - span; col <= col0 + span; col++) {
      if (row < 0 || col < 0 || row >= g.height || col >= g.width) continue;
      if (lock[row * g.width + col] >= 1) return true;
    }
  }
  return false;
}

describe("Clear All Fences (#38)", () => {
  it("removes every fence the player drew", () => {
    const game = makeGame();
    sealPocket(game);
    const drawn = fenceSegments(game);
    expect(drawn).toHaveLength(4);

    expect(clear(game)).toBe(true);

    for (const segment of drawn) expect(fenceSegments(game)).not.toContain(segment);
  });

  /**
   * The point of the rewrite. Two earlier versions worked out which of the
   * player's fences to KEEP, and both left walls running off across the board
   * with nothing behind them. The pocket's outline is drawn instead, so what is
   * left is the pocket and only the pocket.
   */
  it("redraws the pocket as the few edges it really has", () => {
    const game = makeGame();
    sealPocket(game);
    clear(game);

    const seals = fenceWalls(game);
    expect(seals.length).toBeGreaterThan(0);
    // A triangle against the board's top edge: two edges, not a lattice trace.
    // The bound is loose enough to survive re-tuning and tight enough to fail
    // if the outline is ever handed over unsimplified (it traced 7+ before).
    expect(seals.length).toBeLessThanOrEqual(4);
  });

  /**
   * The outline is snapped to the player's own fences before those are thrown
   * away, so the wall lands on the line they actually cut rather than a cell
   * inside it, wandering with the lattice.
   */
  it("draws the outline along the lines the player cut", () => {
    const game = makeGame();
    sealPocket(game);
    clear(game);

    const segments = fenceWalls(game);
    // The diagonal that sealed the pocket: (285,169) -> (64,472).
    const diagonal = segments.find(w =>
      Math.min(w.start.x, w.end.x) < 100 && Math.max(w.start.x, w.end.x) > 250);
    expect(diagonal, "the sealing diagonal is redrawn").toBeTruthy();

    // The vertical stretch at x=64 that closed its left side.
    const vertical = segments.find(w =>
      Math.abs(w.start.x - w.end.x) < 20 && Math.abs(w.start.x - 64) < 20);
    expect(vertical, "the vertical edge is redrawn").toBeTruthy();
    // ...and it stops at the pocket rather than running the height of the board,
    // which is what the previous version left behind.
    expect(Math.max(vertical!.start.y, vertical!.end.y)).toBeLessThan(550);
  });

  /** No wall is left anywhere that is not a pocket edge. THE screenshot bug. */
  it("leaves no wall standing away from a pocket", () => {
    const game = makeGame();
    sealPocket(game);
    clear(game);

    for (const w of fenceWalls(game)) {
      expect(nearLocked(game, midpoint(w), 3), `${w.id} at ${JSON.stringify(midpoint(w))}`)
        .toBe(true);
    }
  });

  /** The board edge already has a wall; drawing a fence over it doubles the line. */
  it("draws nothing along an edge the board already walls", () => {
    const game = makeGame();
    sealPocket(game);
    clear(game);

    // The pocket's top side runs along the board's top edge.
    const boardTop = Math.min(...game.walls.filter(w => w.id.startsWith("board-"))
      .flatMap(w => [w.start.y, w.end.y]));
    for (const w of fenceWalls(game)) {
      const alongTop = Math.abs(w.start.y - boardTop) < 20 && Math.abs(w.end.y - boardTop) < 20;
      expect(alongTop, `${w.id} duplicates the board's top edge`).toBe(false);
    }
  });

  /**
   * grid.lockCaptured is never cleaned: restoreCells leaves it set, and
   * assimilations are kept for the badge, so a pocket that has since reopened
   * stays marked forever. The board layer gets away with that because live
   * space is painted over the top. This does not, and reading the marks
   * unfiltered is what grew walls in the middle of an empty board.
   */
  it("ignores lock marks left over ground that has already reopened", () => {
    const game = makeGame();
    sealPocket(game);

    // Fake the residue of an older pocket: marked locked, but live space now.
    const grid = game.spaceGrid!;
    const stale: number[] = [];
    for (let row = 40; row < 46; row++) {
      for (let col = 40; col < 46; col++) {
        const idx = row * grid.width + col;
        if (grid.cells[idx] !== CellState.ACTIVE) continue;
        grid.lockCaptured![idx] = 1;
        stale.push(idx);
      }
    }
    expect(stale.length).toBeGreaterThan(0);

    clear(game);

    const ghost = { x: grid.originX + 43 * grid.cellSize, y: grid.originY + 43 * grid.cellSize };
    for (const w of fenceWalls(game)) {
      const m = midpoint(w);
      expect(Math.hypot(m.x - ghost.x, m.y - ghost.y), `${w.id} walls a pocket that is gone`)
        .toBeGreaterThan(grid.cellSize * 6);
    }
  });

  /**
   * The lock TINT and the redrawn outline must describe the same pockets.
   *
   * They came from different records and disagreed both ways. applyCut only
   * paints grid.lockCaptured when a lock CAPTURES something, so a ball sealed
   * into ground that was already captured is recorded in `assimilations` alone
   * and never gets a tint; and neither record is ever cleaned, so both keep
   * pockets that have since reopened. Reported as "the lock tint is gone" on a
   * board that still had the walls drawn round it.
   */
  it("leaves a tint behind every outline it draws", () => {
    const game = makeGame();
    sealPocket(game);

    // A pocket the tint never knew about: recorded by the won ball's
    // assimilation, absent from lockCaptured.
    const grid = game.spaceGrid!;
    const orphan: number[] = [];
    for (let i = 0; i < grid.lockCaptured!.length; i++) {
      if (grid.lockCaptured![i] >= 1) { orphan.push(i); grid.lockCaptured![i] = 0; }
    }
    expect(orphan.length).toBeGreaterThan(0);
    expect(game.assimilations.size).toBeGreaterThan(0);

    clear(game);

    // Every cell still held as locked ground carries a tint again.
    for (const idx of orphan) {
      if (grid.cells[idx] !== CellState.REMOVED) continue;
      expect(grid.lockCaptured![idx], `cell ${idx} is walled but not tinted`)
        .toBeGreaterThanOrEqual(1);
    }
  });

  it("clears the tint of a pocket that no longer exists", () => {
    const game = makeGame();
    sealPocket(game);

    const grid = game.spaceGrid!;
    const stale: number[] = [];
    for (let row = 40; row < 46; row++) {
      for (let col = 40; col < 46; col++) {
        const idx = row * grid.width + col;
        if (grid.cells[idx] !== CellState.ACTIVE) continue;
        grid.lockCaptured![idx] = 1;
        stale.push(idx);
      }
    }
    expect(stale.length).toBeGreaterThan(0);

    clear(game);

    // The board layer hides a stale tint by painting live space over it, so it
    // was invisible rather than absent. It is now actually gone.
    for (const idx of stale) expect(grid.lockCaptured![idx]).toBe(0);
  });

  /**
   * A fence must run all the way into whatever bounds it. Never ending in
   * mid-air, a few pixels short of the frame: that is visibly wrong, and it is
   * a hole a ball can be pushed through.
   *
   * The trace works on cell centres, so an outline naturally stops about a cell
   * shy of the edge it is heading for; loose ends are pushed out along their
   * own direction until they meet it.
   */
  it("never leaves an outline end floating in mid-air", () => {
    for (const build of [sealPocket, sealCornerPocket]) {
      const game = makeGame();
      build(game);
      clear(game);

      const seals = fenceWalls(game);
      expect(seals.length).toBeGreaterThan(0);
      const solid = game.walls.filter(w => !isFenceWall(w.id));

      for (const w of seals) {
        for (const [which, pt] of [["start", w.start], ["end", w.end]] as const) {
          // Either another edge of the outline carries on from here...
          const joins = seals.some(o => o !== w
            && (Math.hypot(o.start.x - pt.x, o.start.y - pt.y) < 1
              || Math.hypot(o.end.x - pt.x, o.end.y - pt.y) < 1));
          if (joins) continue;
          // ...or it has reached a wall, exactly. The extension solves a
          // line intersection, so this lands on zero rather than merely near
          // it; a single unit of slack is float noise, not a gap. Without the
          // extension these come out around half a cell short.
          const gap = Math.min(...solid.map(b => pointToSegmentDistance(pt, b.start, b.end)));
          expect(gap, `${w.id}.${which} ends ${gap.toFixed(2)} from anything`)
            .toBeLessThan(0.5);
        }
      }
    }
  });

  /**
   * The pocket may be nudged out to meet its own outline, and no further.
   *
   * The touch-up that closes the gap between a straightened outline and the
   * cells it wraps used to run as an unbounded flood, trusting the outline to
   * be a closed ring and a bounding box to catch it if it was not. It was not:
   * one gap and it walked out through it, taking everything captured inside
   * that box and merging two separate locks into a single blob across half the
   * board. It is now capped by DISTANCE, so the worst a hole in the outline can
   * cost is a couple of cells of fringe.
   *
   * Measured on this fixture the fill adds five cells to a pocket of 158, which
   * is what closing a sliver should look like.
   */
  it("grows a pocket by a fringe, never by a spread", () => {
    for (const build of [sealPocket, sealCornerPocket]) {
      const game = makeGame();
      build(game);
      const grid = game.spaceGrid!;

      const before = new Set<number>();
      for (let i = 0; i < grid.lockCaptured!.length; i++) {
        if (grid.lockCaptured![i] >= 1) before.add(i);
      }
      expect(before.size).toBeGreaterThan(0);

      clear(game);

      const after: number[] = [];
      for (let i = 0; i < grid.lockCaptured!.length; i++) {
        if (grid.lockCaptured![i] >= 1) after.push(i);
      }

      // Every cell that became locked is a neighbour of one that already was:
      // a dilation, not a journey.
      const reach = 3;
      for (const idx of after) {
        if (before.has(idx)) continue;
        const row = (idx / grid.width) | 0;
        const col = idx % grid.width;
        let near = false;
        for (let r = row - reach; r <= row + reach && !near; r++) {
          for (let c = col - reach; c <= col + reach; c++) {
            if (r < 0 || c < 0 || r >= grid.height || c >= grid.width) continue;
            if (before.has(r * grid.width + c)) { near = true; break; }
          }
        }
        expect(near, `cell ${idx} became locked ${reach}+ cells from any pocket`).toBe(true);
      }

      // ...and the pocket as a whole did not balloon.
      expect(after.length).toBeLessThan(before.size * 1.5);
    }
  });

  it("leaves board and obstacle walls alone", () => {
    const game = makeGame();
    sealPocket(game);
    const boardCount = game.walls.filter(w => w.id.startsWith("board-")).length;
    const obstacleCount = game.walls.filter(w => w.id.startsWith("obstacle-")).length;

    clear(game);

    expect(game.walls.filter(w => w.id.startsWith("board-")).length).toBe(boardCount);
    expect(game.walls.filter(w => w.id.startsWith("obstacle-")).length).toBe(obstacleCount);
  });

  /**
   * A fence occupies the strip it is drawn over, and a real cut rasterises that
   * strip as it lands. A redrawn outline has to do the same, or it is a wall
   * painted over live space: a fence floating above the board.
   */
  it("stands the redrawn outline on captured ground", () => {
    const game = makeGame();
    sealPocket(game);
    clear(game);

    const grid = game.spaceGrid!;
    for (const w of fenceWalls(game)) {
      for (const t of [0.25, 0.5, 0.75]) {
        const p = {
          x: w.start.x + (w.end.x - w.start.x) * t,
          y: w.start.y + (w.end.y - w.start.y) * t,
        };
        expect(grid.cells[cellAt(game, p)], `under ${w.id} at t=${t}`).toBe(CellState.REMOVED);
      }
    }
  });

  /**
   * A board already reduced to its outlines has nothing left to clear, and a
   * press that cannot change anything must not cost a charge.
   */
  it("declines a second press, when only the outlines are left", () => {
    const game = makeGame();
    sealPocket(game);
    expect(clear(game)).toBe(true);

    const after = fenceSegments(game);
    const pct = getRemainingPercent(game.spaceGrid!);

    expect(clear(game)).toBe(false);
    expect(fenceSegments(game)).toEqual(after);
    expect(getRemainingPercent(game.spaceGrid!)).toBe(pct);
  });

  it("reopens captured space so remaining % rises", () => {
    const game = makeGame();
    sealPocket(game);
    const before = getRemainingPercent(game.spaceGrid!);
    expect(before).toBeLessThan(100); // the seal captured space

    clear(game);

    const after = getRemainingPercent(game.spaceGrid!);
    expect(after).toBeGreaterThan(before); // non-locked space reopened
  });

  it("keeps locked balls locked and their pocket cells captured", () => {
    const game = makeGame();
    sealPocket(game);
    expect(game.balls[0].state).toBe("won"); // pocket ball locked
    const lockedCount = game.lockedBallsCount;
    const lockBonus = game.lockBonus;
    const lockCap = game.spaceGrid!.lockCaptured!;
    const pocketCells: number[] = [];
    for (let i = 0; i < lockCap.length; i++) if (lockCap[i] >= 1) pocketCells.push(i);
    expect(pocketCells.length).toBeGreaterThan(0);

    clear(game);

    // Points + locked ball untouched.
    expect(game.balls[0].state).toBe("won");
    expect(game.lockedBallsCount).toBe(lockedCount);
    expect(game.lockBonus).toBe(lockBonus);
    // Every locked-pocket cell is still captured (REMOVED), never reopened.
    for (const idx of pocketCells) {
      expect(game.spaceGrid!.cells[idx]).toBe(CellState.REMOVED);
    }
  });

  it("shatters the cleared fences into debris (not a silent vanish)", () => {
    const game = makeGame();
    sealPocket(game);
    game.objectDebris = [];
    clearAllFences(game, { repaintRegionCanvas: () => {}, setRemainingPercent: () => {}, fenceColor: '#00ff88' });
    expect(game.objectDebris.length).toBeGreaterThan(0);
    // Each burst carries flying shard particles.
    expect(game.objectDebris[0].particles.length).toBeGreaterThan(0);
  });

  it("is a no-op, and declines, when there are no fences at all", () => {
    const game = makeGame();
    const wallsBefore = game.walls.length;
    const pctBefore = getRemainingPercent(game.spaceGrid!);

    expect(clear(game)).toBe(false);

    expect(game.walls.length).toBe(wallsBefore);
    expect(getRemainingPercent(game.spaceGrid!)).toBe(pctBefore);
  });
});

describe("concurrent fences (#38)", () => {
  it("applyCut finalizes ONLY its own wall, leaving the other still growing", () => {
    const game = makeGame();
    const w1 = completedWall({ x: 64, y: 500 }, { x: 64, y: 169 }, { x: 64, y: 855 });
    const w2 = completedWall({ x: 800, y: 500 }, { x: 800, y: 169 }, { x: 800, y: 855 });
    game.activeWalls = [w1, w2];
    applyCutFn(w1, game, LEVEL, 2, MODS, false, false, 0, noopCallbacks);
    // w1 is committed and removed; w2 keeps growing.
    expect(game.activeWalls).toEqual([w2]);
  });
});
