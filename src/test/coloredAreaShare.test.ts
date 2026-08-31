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
  areaShareOf, effectiveBasePoints, areaProgress, clampAreaShare, missedAreaShare,
  withheldFromPay,
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

describe("the share the scorer is handed", () => {
  it("is zero when every area was taken", () => {
    const l = level({ coloredAreas: [area(), area()] });
    expect(missedAreaShare(l, [area(true), area(true)])).toBe(0);
  });

  it("is the whole share when none were", () => {
    const l = level({ coloredAreas: [area(), area()] });
    expect(missedAreaShare(l, [area(false), area(false)])).toBeCloseTo(0.4, 9);
  });

  it("is proportional in between", () => {
    const l = level({ coloredAreas: [area(), area()] });
    expect(missedAreaShare(l, [area(true), area(false)])).toBeCloseTo(0.2, 9);
  });

  it("is zero on a map with no areas at all", () => {
    expect(missedAreaShare(level({}), [])).toBe(0);
    expect(missedAreaShare(null, undefined)).toBe(0);
  });
});

describe("what it is worth on a real payout", () => {
  it("comes off the map's pay, not off basePoints alone", () => {
    // The level-3 run that exposed the first attempt: base 20h, axes and lock
    // payouts 105h, 130h earned. basePoints feeds only the first term of
    // `multipliedBase + axes.total`, so scaling IT withheld 8h - about 6% of
    // the map - on a rule that says 40%.
    const base = 20, axes = 105;
    const grossMapPay = base + axes;
    const viaBasePoints = base - effectiveBasePoints(base, 0.4, 0, 1);
    const viaMapPay = grossMapPay * 0.4;
    expect(viaBasePoints).toBeCloseTo(8, 6);
    expect(viaMapPay).toBeCloseTo(50, 6);
    // The rule has to bite on the order of the second number, not the first.
    expect(viaMapPay / grossMapPay).toBeCloseTo(0.4, 6);
    expect(viaBasePoints / grossMapPay).toBeLessThan(0.07);
  });
});

describe("what is actually withheld", () => {
  it("takes the share off a positive pay", () => {
    expect(withheldFromPay(125, 0.4)).toBe(50);
    expect(withheldFromPay(125, 0.2)).toBe(25);
    expect(withheldFromPay(125, 0)).toBe(0);
  });

  it("takes NOTHING off a pay that is already negative", () => {
    // Tempo can go negative - the level-3 run that prompted all this showed
    // -24h - and if the axes drive the total below zero, multiplying by the
    // missed share makes it LESS negative. Ignoring the zones would soften the
    // penalty, so the worse you played the more skipping them would help.
    expect(withheldFromPay(-40, 0.4)).toBe(0);
    expect(withheldFromPay(0, 0.4)).toBe(0);
  });

  it("survives a nonsense pay or share rather than paying NaN", () => {
    expect(withheldFromPay(Number.NaN, 0.4)).toBe(0);
    expect(withheldFromPay(100, Number.NaN)).toBe(0);
    expect(withheldFromPay(100, 5)).toBe(100);
    expect(withheldFromPay(100, -5)).toBe(0);
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
    // The share is passed as an OPTION now, not baked into basePoints, so the
    // check is that the option reaches the call.
    const at = SRC.indexOf("= calculateScore(");
    expect(at, "the payout call has moved or been renamed").toBeGreaterThan(0);
    const optionsBlock = SRC.slice(at, at + 1200);
    expect(optionsBlock, "the scorer is not told what the zones cost")
      .toContain("zoneShareMissed,");
  });

  it("counts the areas from the live board, not the authored list", () => {
    // game.coloredAreas carries the `satisfied` flags the lock pass writes.
    // level.coloredAreas is the authored config and never gets them, so
    // reading that would score every map as if no zone were ever taken.
    expect(SRC).toContain("missedAreaShare(level, game.coloredAreas)");
  });
});
