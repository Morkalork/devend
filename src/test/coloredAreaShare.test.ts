/**
 * What a map's colored areas are worth.
 *
 * They used to pay purely as a multiplier on the locks made inside them, and
 * the Craft axis treats a zone lock as one route to a full axis among several -
 * superior locks, simultaneous cuts, money balls and frozen locks all reach the
 * same ceiling. A player who never went near a zone was not behind, so the
 * zones read as decoration.
 *
 * They now carry a SHARE of the map's own points, 40% by default, paid in
 * proportion to how many were satisfied. The properties that matter are about
 * the shape of that deal rather than the numbers in it:
 *
 *   - a map with no areas must score exactly as it always did;
 *   - the share comes OUT of the map's points, never on top, or a zone map pays
 *     more than a zone-free one for the same play and the ladder inflates;
 *   - partial credit, or the last zone is the only one that matters;
 *   - it can never take the whole map, or clearing pays nothing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  areaShareOf, effectiveBasePoints, areaProgress, clampAreaShare,
  DEFAULT_COLORED_AREA_SHARE, MAX_COLORED_AREA_SHARE,
} from "@/lib/coloredAreaShare";
import type { LevelConfig } from "@/types/level";

const level = (over: Partial<LevelConfig>) => over as LevelConfig;
const area = (satisfied = false) =>
  ({ kind: "var" as const, x: 0, y: 0, width: 10, height: 10, satisfied });

describe("how much of a map rides on its zones", () => {
  it("is nothing at all on a map with no areas", () => {
    // The guarantee that keeps every zone-free map scoring exactly as before.
    expect(areaShareOf(level({}))).toBe(0);
    expect(areaShareOf(level({ coloredAreas: [] }))).toBe(0);
    expect(areaShareOf(null)).toBe(0);
    // ...even if a share was authored on a map that has since lost its areas.
    expect(areaShareOf(level({ coloredAreas: [], coloredAreaShare: 0.6 }))).toBe(0);
  });

  it("defaults to 40% on any map that has one", () => {
    expect(areaShareOf(level({ coloredAreas: [area()] }))).toBe(DEFAULT_COLORED_AREA_SHARE);
    expect(DEFAULT_COLORED_AREA_SHARE).toBe(0.4);
  });

  it("takes the map's own number when it has one", () => {
    // The point of the per-map override: a board where the zones sit alongside
    // another demanding feature should be able to ask for less.
    expect(areaShareOf(level({ coloredAreas: [area()], coloredAreaShare: 0.15 }))).toBe(0.15);
    expect(areaShareOf(level({ coloredAreas: [area()], coloredAreaShare: 0 }))).toBe(0);
  });

  it("never lets the zones take the whole map", () => {
    // A share of 1 would pay nothing for clearing, which is a different game.
    expect(clampAreaShare(1)).toBe(MAX_COLORED_AREA_SHARE);
    expect(clampAreaShare(99)).toBe(MAX_COLORED_AREA_SHARE);
    expect(areaShareOf(level({ coloredAreas: [area()], coloredAreaShare: 5 })))
      .toBe(MAX_COLORED_AREA_SHARE);
  });

  it("never pays a bonus for ignoring them", () => {
    expect(clampAreaShare(-1)).toBe(0);
    expect(areaShareOf(level({ coloredAreas: [area()], coloredAreaShare: -0.5 }))).toBe(0);
  });
});

describe("what the map actually pays out of", () => {
  it("pays everything when every zone was taken", () => {
    expect(effectiveBasePoints(100, 0.4, 2, 2)).toBe(100);
  });

  it("withholds the share when none were", () => {
    // The whole point: clear the map, ignore the zones, bank 60%.
    expect(effectiveBasePoints(100, 0.4, 0, 2)).toBeCloseTo(60, 9);
  });

  it("gives partial credit, so a third zone is still worth attempting", () => {
    // All-or-nothing would make the LAST zone the only one that mattered, and a
    // player one zone short would have no reason to take the other two.
    expect(effectiveBasePoints(100, 0.4, 1, 2)).toBeCloseTo(80, 9);
    expect(effectiveBasePoints(90, 0.3, 2, 3)).toBeCloseTo(81, 9);
  });

  it("leaves a zone-free map completely untouched", () => {
    expect(effectiveBasePoints(100, 0, 0, 0)).toBe(100);
    expect(effectiveBasePoints(100, 0.4, 0, 0)).toBe(100);
  });

  it("never pays MORE than the map's points", () => {
    // The share is withheld, never added. If this ever inverted, every zone map
    // would out-pay a zone-free one for the same play.
    for (const taken of [0, 1, 2, 5]) {
      expect(effectiveBasePoints(100, 0.4, taken, 2)).toBeLessThanOrEqual(100);
    }
  });

  it("clamps a nonsense count rather than paying a negative map", () => {
    expect(effectiveBasePoints(100, 0.4, -3, 2)).toBeCloseTo(60, 9);
    expect(effectiveBasePoints(100, 0.4, 99, 2)).toBe(100);
  });

  it("survives a map with no points to pay", () => {
    expect(effectiveBasePoints(0, 0.4, 0, 2)).toBe(0);
    expect(effectiveBasePoints(Number.NaN, 0.4, 0, 2)).toBe(0);
  });

  it("always leaves something for clearing", () => {
    // Even at the hard ceiling, a player who ignores every zone still banks the
    // rest of the map. The zones are a target, not a gate.
    expect(effectiveBasePoints(100, MAX_COLORED_AREA_SHARE, 0, 1)).toBeGreaterThan(0);
  });
});

describe("counting the zones", () => {
  it("reads how many are satisfied", () => {
    expect(areaProgress([area(true), area(false), area(true)])).toEqual({ satisfied: 2, total: 3 });
    expect(areaProgress([])).toEqual({ satisfied: 0, total: 0 });
    expect(areaProgress(undefined)).toEqual({ satisfied: 0, total: 0 });
  });
});

describe("the payout actually uses it", () => {
  const SRC = readFileSync(
    resolve(process.cwd(), "src/components/game/GameCanvas.tsx"), "utf8");

  it("pays the map out of the share-adjusted points, not the raw ones", () => {
    // Everything above is a pure function agreeing with itself. None of it
    // proves the game calls it: leave `level.points` in the payout and every
    // assertion in this file stays green while the zones are worth nothing
    // again, silently.
    //
    // Source-level rather than a render harness, which is the weaker kind of
    // test and a deliberate trade - GameCanvas wants a live canvas, a level, a
    // run and a renderer, and a harness for it would be a large fragile thing
    // guarding one argument. botSoak.test.ts and hudObjectiveReadouts.test.tsx
    // both take the same trade for the same reason.
    expect(SRC).toContain("const payableBasePoints = effectiveBasePoints(");
    // From the call itself to its options object, so the destructuring brace on
    // the left of the assignment is not mistaken for the end of the arguments.
    const at = SRC.indexOf("= calculateScore(");
    expect(at, "the payout call has moved or been renamed").toBeGreaterThan(0);
    const args = SRC.slice(at, SRC.indexOf("{", at));
    expect(args, "the score is still computed from the unadjusted level.points")
      .toContain("payableBasePoints");
    expect(args).not.toContain("level.points");
  });

  it("counts the areas from the live board, not the authored list", () => {
    // game.coloredAreas carries the `satisfied` flags the lock pass writes.
    // level.coloredAreas is the authored config and never gets them, so
    // reading that would score every map as if no zone were ever taken.
    expect(SRC).toContain("areaProgress(game.coloredAreas)");
  });
});
