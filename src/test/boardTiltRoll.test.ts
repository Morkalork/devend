/**
 * Sporadic board tilts (issue #77): the map turns a quarter, rarely, unannounced.
 *
 * The point is what it does to a gravity well. A map is authored so no well
 * pulls into a wall it sits against; a tilt revokes that, because the pull is
 * screen-absolute and the board turns underneath it. A safe-looking map becomes
 * sinister, and a board you had already solved has to be re-read.
 *
 * Three properties carry the design, and each has an obvious wrong version that
 * would still "work":
 *
 *   1. Rolled on PROGRESS, not time. Ship Early windows are 6-15s per ball, so
 *      a time-based roll would never fire for good play and the tilt would only
 *      punish players already struggling.
 *   2. Only on maps with WELLS. A rigid rotation preserves everything inside it,
 *      so on a map with no well a tilt is disorientation with no meaning.
 *   3. Chance drawn per map. A fixed number is learnable across runs.
 */
import { describe, it, expect } from "vitest";
import {
  TILT_MIN_LEVEL, TILT_TIERS, TILT_CHANCE_MIN, TILT_CHANCE_MAX,
  rollTiltChance, mapCanTilt, tiersReached, newTiers, rollTilts, rollTiltDirection,
} from "@/lib/boardTiltRoll";
import { discreteTiltAngle, beginTilt, NO_TILT, TILT_SECONDS } from "@/lib/boardTilt";
import { tickBoardTilt } from "@/lib/physics/boardTiltTick";
import type { GravityWell, LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const WELL: GravityWell = { x: 300, y: 300, width: 200, height: 170 };
const QUARTER = Math.PI / 2;

describe("which maps tilt at all", () => {
  it("needs a well to have something to break", () => {
    expect(mapCanTilt(20, [WELL])).toBe(true);
    expect(mapCanTilt(20, [])).toBe(false);
    expect(mapCanTilt(20, undefined)).toBe(false);
  });

  it("stays out of the teaching band", () => {
    expect(mapCanTilt(TILT_MIN_LEVEL - 1, [WELL])).toBe(false);
    expect(mapCanTilt(TILT_MIN_LEVEL, [WELL])).toBe(true);
  });

  it("starts after level 10, where the one-idea-per-map band ends", () => {
    expect(TILT_MIN_LEVEL).toBeGreaterThan(10);
  });
});

describe("the tiers", () => {
  it("are progress, not seconds", () => {
    for (const t of TILT_TIERS) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(100);
    }
  });

  it("arrive in order as the board clears", () => {
    expect(tiersReached(0)).toEqual([]);
    expect(tiersReached(25)).toEqual([20]);
    expect(tiersReached(65)).toEqual([20, 40, 60]);
    expect(tiersReached(100)).toEqual([...TILT_TIERS]);
  });

  it("gives a well-played map real chances, unlike a time-based roll", () => {
    // A fast clear still crosses tiers, because clearing IS the progress.
    expect(tiersReached(85).length).toBeGreaterThanOrEqual(3);
  });

  it("never re-rolls a tier already spent", () => {
    expect(newTiers(65, [20, 40])).toEqual([60]);
    expect(newTiers(65, [20, 40, 60])).toEqual([]);
  });

  /**
   * One cut can capture a lot, and a destroy can reclaim more, so several tiers
   * can be crossed at once. Each is a separate chance: swallowing them into one
   * roll would quietly halve the tilt rate on exactly the biggest, most
   * board-changing cuts.
   */
  it("returns every tier crossed at once, not just the highest", () => {
    expect(newTiers(85, [])).toEqual([20, 40, 60, 80]);
  });
});

describe("the chance", () => {
  it("lands inside the band", () => {
    for (const r of [0, 0.5, 1]) {
      const c = rollTiltChance(() => r);
      expect(c).toBeGreaterThanOrEqual(TILT_CHANCE_MIN);
      expect(c).toBeLessThanOrEqual(TILT_CHANCE_MAX);
    }
  });

  it("is a band rather than a fixed number, so it cannot be learned", () => {
    expect(rollTiltChance(() => 0)).not.toBeCloseTo(rollTiltChance(() => 1), 4);
  });

  it("survives a nonsense generator", () => {
    for (const r of [-5, 42, Number.NaN]) {
      const c = rollTiltChance(() => r);
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(TILT_CHANCE_MIN);
      expect(c).toBeLessThanOrEqual(TILT_CHANCE_MAX);
    }
  });

  it("rolls once per tier", () => {
    expect(rollTilts([20, 40, 60], 1, () => 0)).toBe(3);   // certain
    expect(rollTilts([20, 40, 60], 0, () => 0.5)).toBe(0); // impossible
  });

  /** Rare is the whole point: a metronome is something you plan around. */
  it("stays rare across a whole map at the top of the band", () => {
    let tilted = 0;
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      let seed = i * 2654435761 % 2147483647;
      const rng = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
      if (rollTilts(TILT_TIERS, TILT_CHANCE_MAX, rng) > 0) tilted++;
    }
    const rate = tilted / runs;
    expect(rate).toBeGreaterThan(0.2);   // it does happen
    expect(rate).toBeLessThan(0.45);     // and it is still the exception
  });

  it("turns both ways, so the new orientation cannot be pre-planned", () => {
    expect(rollTiltDirection(() => 0.1)).toBe(1);
    expect(rollTiltDirection(() => 0.9)).toBe(-1);
  });
});

describe("the turn itself", () => {
  it("does nothing before one has happened", () => {
    expect(discreteTiltAngle(NO_TILT, 12)).toBe(0);
    expect(discreteTiltAngle(null, 12)).toBe(0);
  });

  it("eases a quarter turn and then settles", () => {
    const t = beginTilt(NO_TILT, 1, 10);
    expect(discreteTiltAngle(t, 10)).toBeCloseTo(0, 6);
    const mid = discreteTiltAngle(t, 10 + TILT_SECONDS / 2);
    expect(Math.abs(mid)).toBeGreaterThan(0.01);
    expect(Math.abs(mid)).toBeLessThan(QUARTER);
    expect(discreteTiltAngle(t, 10 + TILT_SECONDS)).toBeCloseTo(QUARTER, 6);
    expect(discreteTiltAngle(t, 999)).toBeCloseTo(QUARTER, 6);
  });

  it("turns the other way for the other direction", () => {
    const t = beginTilt(NO_TILT, -1, 0);
    expect(discreteTiltAngle(t, TILT_SECONDS)).toBeCloseTo(-QUARTER, 6);
  });

  /** A second tilt starts from where the board IS, not from upright. */
  it("accumulates across tilts", () => {
    let t = beginTilt(NO_TILT, 1, 0);
    t = beginTilt(t, 1, 10);
    expect(t.fromTurns).toBe(1);
    expect(discreteTiltAngle(t, 10 + TILT_SECONDS)).toBeCloseTo(QUARTER * 2, 6);
  });

  it("can turn back the way it came", () => {
    let t = beginTilt(NO_TILT, 1, 0);
    t = beginTilt(t, -1, 10);
    expect(discreteTiltAngle(t, 10 + TILT_SECONDS)).toBeCloseTo(0, 6);
  });

  it("holds the old angle if the clock somehow runs backwards", () => {
    const t = beginTilt(NO_TILT, 1, 10);
    expect(discreteTiltAngle(t, 9)).toBeCloseTo(0, 6);
  });
});

// ── The tick that fires it ──────────────────────────────────────────────────

/**
 * The bookkeeping, which is where the rules meet game state. The rules above
 * are pure and easy to get right; this is the part that can quietly do nothing.
 */
describe("firing a tilt from cleared space", () => {
  const LEVEL = { id: "tilt-probe" } as unknown as LevelConfig;

  function game(wells: GravityWell[] | undefined, over: Partial<CanvasGameState> = {}) {
    return {
      gravityWells: wells, activePlaySeconds: 12,
      boardTilt: undefined, tiltChance: undefined, firedTiltTiers: undefined,
      ...over,
    } as unknown as CanvasGameState;
  }

  it("never tilts a map with no wells, however much is cleared", () => {
    const g = game(undefined);
    tickBoardTilt(g, LEVEL, 20, 99);
    expect(g.boardTilt).toBeUndefined();
    expect(g.firedTiltTiers ?? []).toEqual([]);
  });

  it("never tilts inside the teaching band", () => {
    const g = game([WELL]);
    tickBoardTilt(g, LEVEL, TILT_MIN_LEVEL - 1, 99);
    expect(g.boardTilt).toBeUndefined();
  });

  it("records the tiers it has rolled, so none rolls twice", () => {
    const g = game([WELL], { tiltChance: 0 });   // never fires, but still spends
    tickBoardTilt(g, LEVEL, 20, 45);
    expect(g.firedTiltTiers).toEqual([20, 40]);
    tickBoardTilt(g, LEVEL, 20, 45);
    expect(g.firedTiltTiers, "the same tiers must not be spent again").toEqual([20, 40]);
  });

  it("turns the board when a roll comes up", () => {
    const g = game([WELL], { tiltChance: 1 });   // certain
    tickBoardTilt(g, LEVEL, 20, 25);
    expect(g.boardTilt).toBeTruthy();
    expect(Math.abs(g.boardTilt!.turns)).toBe(1);
    expect(g.boardTilt!.startedAt).toBe(12);
  });

  /**
   * Several tiers can be crossed by one big capture. Each is its own chance,
   * but they must produce ONE turn: two quarter-turns in a frame is a half-turn
   * nobody could follow, and the second would be invisible behind the first
   * still easing.
   */
  it("turns at most a quarter even when several tiers land at once", () => {
    const g = game([WELL], { tiltChance: 1 });
    tickBoardTilt(g, LEVEL, 20, 95);            // crosses all four
    expect(Math.abs(g.boardTilt!.turns)).toBe(1);
  });

  it("draws its chance once and keeps it for the map", () => {
    const g = game([WELL]);
    tickBoardTilt(g, LEVEL, 20, 25);
    const first = g.tiltChance;
    expect(first).toBeGreaterThanOrEqual(TILT_CHANCE_MIN);
    tickBoardTilt(g, LEVEL, 20, 45);
    expect(g.tiltChance).toBe(first);
  });

  it("does nothing before the first tier", () => {
    const g = game([WELL], { tiltChance: 1 });
    tickBoardTilt(g, LEVEL, 20, TILT_TIERS[0] - 1);
    expect(g.boardTilt).toBeUndefined();
  });
});
