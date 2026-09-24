/**
 * A gate map is playable on its first frame, on every deal.
 *
 * Reported from level 8: one ordinary cut to shrink the board, and the map
 * failed with "the zone can no longer be reached"; then the retry failed the
 * same way before the player touched it, and again, and again, a failure
 * overlay that dismissed into itself. Two defects, and this file pins both:
 *
 *   THE GUARD READ THE WRONG RECTANGLE. From level 4 up a map is dealt in one
 *     of four rotations, and the reachability check tested the level's authored
 *     zone rather than the dealt one - open floor somewhere else on three
 *     deals in four, "sealed" the moment a cut claimed it.
 *   THE GUARD READ A CURTAIN AS CLAIMED GROUND. On the un-rotated deal the
 *     authored rectangle was right, and it was entirely behind the curtain's
 *     reveal, whose cells start REMOVED. Zero active cells read as "claimed",
 *     which ended the map on frame one, every time.
 *
 * And the rule that turns any such mistake from a loop into, at worst, one
 * lost map: a stranding check never fires before the player's first cut.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LADDER, byLevel } from "./fixtures/maps";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { setRunSeedText } from "@/lib/runRng";
import { runBot } from "@/lib/bot/runBot";
import { evaluateWinConditions } from "@/lib/physics/applyCut";
import { anyGateTargetCanReach, gateAreas, sealedPendingCells, areaCellIndices } from "@/lib/coloredAreas";
import { CellState } from "@/lib/spaceGrid";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { GameCallbacks } from "@/lib/physics/gameCallbacks";
import type { MapFailure } from "@/lib/mapFailure";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function deal(level: LevelConfig, seed: number): CanvasGameState {
  setRunSeedText(`bot-${seed}`);
  try {
    return createInitialGameData(level, level.level ?? 1, DEFAULT_MODIFIERS) as unknown as CanvasGameState;
  } finally {
    setRunSeedText(null);
  }
}

const gateMaps = LADDER.filter(l => gateAreas(l.coloredAreas ?? []).length > 0);

describe("every gate map on the ladder", () => {
  it("has gate maps to check", () => {
    expect(gateMaps.map(l => l.level)).toContain(8);
  });

  for (const level of gateMaps) {
    it(`level ${level.level} can reach its zone on the first frame of every deal`, () => {
      const rotations = new Set<number>();
      const rotates = (level.level ?? 0) >= 4 && !level.neverRotates;
      // Deal on until every orientation has been seen, not for a fixed eight:
      // which seeds land on which rotation depends on the map's id, and a
      // fixed set covered three of four on levels 4 and 9 once they gained a
      // zone. The first eight always run.
      const seeds = [...SEEDS];
      for (let extra = 100; rotates && extra < 164; extra++) seeds.push(extra);
      for (const seed of seeds) {
        if (rotates && rotations.size === 4 && !SEEDS.includes(seed)) break;
        const game = deal(level, seed);
        rotations.add((game as unknown as { mapRotation: number }).mapRotation);
        const reachable = anyGateTargetCanReach(
          game.spaceGrid!, game.balls, gateAreas(game.coloredAreas), sealedPendingCells(game.destructibles),
        );
        expect(reachable, `level ${level.level} seed ${seed} is unwinnable before the first cut`).toBe(true);
      }
      // Every orientation a rotating map can be dealt in was checked, rather
      // than the one that happened.
      if (rotates) {
        expect(rotations.size, `seeds only dealt rotations ${[...rotations]}`).toBe(4);
      }
    });
  }
});

describe("level 8, the reported map", () => {
  const level = byLevel(LADDER, 8)!;

  it("keeps its whole zone behind the curtain, which is the shape that broke", () => {
    // Proves the fixture reproduces the report: on the un-rotated deal not one
    // zone cell is active, and every one of them is a curtain cell.
    const game = deal(level, 1);
    expect((game as unknown as { mapRotation: number }).mapRotation).toBe(0);
    const cells = areaCellIndices(game.spaceGrid!, gateAreas(game.coloredAreas));
    const pending = sealedPendingCells(game.destructibles);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every(i => game.spaceGrid!.cells[i] === CellState.REMOVED)).toBe(true);
    expect(cells.every(i => pending.has(i))).toBe(true);
  });

  it("never loses with no cut made, on any seed", () => {
    for (const seed of SEEDS) {
      const r = runBot(level, 8, seed, { maxFrames: 600, cutEvery: 1_000_000 });
      expect(r.lost, `seed ${seed} lost with ${r.cuts} cuts at frame ${r.frames}: ${r.failKind}`).toBe(false);
    }
  });

  it("never loses to the zone before the bot has cut, on any seed", () => {
    for (const seed of SEEDS) {
      const r = runBot(level, 8, seed, { maxFrames: 1800 });
      if (r.lost) {
        expect(r.cuts, `seed ${seed} lost at frame ${r.frames} with no cut: ${r.failKind}`).toBeGreaterThan(0);
        expect(r.frames, `seed ${seed} lost on frame ${r.frames}`).toBeGreaterThan(60);
      }
    }
  });
});

describe("a stranding check waits for the first cut", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness() {
    let lives = 3;
    const failures: MapFailure[] = [];
    const callbacks = {
      getLives: () => lives,
      setLivesRef: (n: number) => { lives = n; },
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

  const level = byLevel(LADDER, 8)!;

  /** The old bug's board: the curtain gone from the model with its cells still REMOVED. */
  function curtainGoneCellsStillRemoved(game: CanvasGameState): void {
    for (const d of game.destructibles) {
      if (d.sealedCells) d.destroyed = true;
    }
  }

  it("says nothing on the untouched board, even one that reads as claimed", () => {
    const game = deal(level, 1);
    curtainGoneCellsStillRemoved(game);
    game.activePlaySeconds = 5;
    const h = harness();
    evaluateWinConditions(game, level, 8, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();
    expect(h.failures).toHaveLength(0);
  });

  it("does end the map once a cut exists and the zone is genuinely gone", () => {
    // The claimed-ground rule itself is intact: the same board after a cut is
    // the stranding the guard exists for.
    const game = deal(level, 1);
    curtainGoneCellsStillRemoved(game);
    game.activePlaySeconds = 5;
    game.wallCount = 1;
    const h = harness();
    evaluateWinConditions(game, level, 8, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();
    expect(h.failures.map(f => f.kind)).toEqual(["areaUnreachable"]);
  });

  it("does not end the map behind an unbroken curtain, cut or no cut", () => {
    const game = deal(level, 1);
    game.activePlaySeconds = 5;
    game.wallCount = 1;
    const h = harness();
    evaluateWinConditions(game, level, 8, DEFAULT_MODIFIERS, h.callbacks);
    vi.runAllTimers();
    expect(h.failures).toHaveLength(0);
  });
});

describe("the wiring", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/physics/applyCut.ts"), "utf8");

  it("reads the DEALT zones, not the authored ones", () => {
    expect(src).toContain("gateAreas(game.coloredAreas ?? [])");
    expect(src, "the guard is back on the un-rotated rectangle")
      .not.toMatch(/anyGateTargetCanReach\([^;]*level\.coloredAreas/);
  });

  it("hands the guard the cells still behind a reveal", () => {
    expect(src).toContain("sealedPendingCells(game.destructibles)");
  });

  it("gates both stranding checks on the first cut", () => {
    expect(src).toContain("const playerHasCut = game.wallCount > 0;");
    expect(src).toMatch(/if \(playerHasCut && areaClause &&/);
    expect(src).toMatch(/if \(playerHasCut && !isWinMet\(spec, snap\)/);
  });
});
