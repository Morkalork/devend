/**
 * The ladder's vocabulary, held to a floor.
 *
 * Dev/End has around sixteen headline mechanics and a strong pull toward three
 * of them. Colored areas are on 19 of the 35 maps, breakables on 12, movers on
 * 11; thread-lock is on one. Nothing stopped that happening, because nothing
 * was counting - each map is a reasonable local choice and the drift is only
 * visible from above.
 *
 * So this counts. It is deliberately a FLOOR and not a schedule: it does not
 * say which map should use what, only that a mechanic which exists should
 * appear more than once, and that no single idea should own an act. Both are
 * low bars on purpose - a test that encodes the whole design would fail on
 * every honest edit and get deleted within a month.
 *
 * The numbers here are the current state, pinned. When a count changes the test
 * fails, and that is the point: the failure is the conversation about whether
 * the change was intended.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  MECHANICS, ACTS, mechanicSpread, spreadWarnings, actOf, MIN_HEADLINE_MAPS,
} from "@/lib/admin/mechanicSpread";
import type { LevelConfig, LevelData } from "@/types/level";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];

const use = (key: string) => mechanicSpread(LEVELS).find(m => m.key === key)!;

describe("the ladder itself", () => {
  it("is 35 maps, one per level number", () => {
    // The b-variants were retired on 2026-08-31. Everything below assumes one
    // map per number, so this is the assumption stated out loud.
    expect(LEVELS).toHaveLength(35);
    const numbers = LEVELS.map(l => l.level);
    expect(new Set(numbers).size).toBe(35);
    expect(Math.min(...numbers)).toBe(1);
    expect(Math.max(...numbers)).toBe(35);
  });

  it("puts every level in exactly one act", () => {
    for (const l of LEVELS) {
      expect(actOf(l.level), `level ${l.level} belongs to no act`).not.toBeNull();
    }
    const total = ACTS.reduce((n, a) =>
      n + LEVELS.filter(l => l.level >= a.from && l.level <= a.to).length, 0);
    expect(total, "the acts overlap or leave a gap").toBe(35);
  });
});

describe("no mechanic is introduced and then dropped", () => {
  it("has no headline mechanic sitting on a single map", () => {
    const singles = spreadWarnings(LEVELS).filter(w => w.kind === "single-use");
    // Pinned rather than asserted empty, because these are real and known.
    // Each is a decision someone should make, not a bug to fix silently:
    //
    //   Thread lock    level 19 only, and it is act II's whole Break beat
    //   Pinned mutator level 34 only, the one map that pins a mutator
    //
    // Bent shape came OFF this list when the designer bent walls on 2, 6 and 7.
    // That is the intended direction of travel for every name here.
    //
    // When one of these gains a second map the test fails and the line comes
    // out. When a NEW name appears here, something was introduced once and
    // forgotten - which is the failure this file exists to catch.
    expect(singles.map(w => w.key).sort()).toEqual(["mutator", "threadLock"]);
  });

  it("has no headline mechanic the engine supports but no map uses", () => {
    const unused = spreadWarnings(LEVELS).filter(w => w.kind === "unused");
    // Empty again. One-way, ball gates and fence ground spent a day on this
    // list between shipping as engine + editor and being placed on maps 23/31,
    // 33/34 and 24/27 - which is exactly the window this rule exists to make
    // visible rather than let become permanent.
    expect(unused.map(w => w.label), "a supported mechanic is on no map at all").toEqual([]);
  });

  it("holds the mechanics that ARE developed above the floor", () => {
    for (const key of ["mover", "breakable", "chest", "gravityWell", "coloredArea", "reveals", "mirror",
                       "oneWay", "gate", "fenceGround"]) {
      expect(use(key).levels.length, `${key} fell below the floor`)
        .toBeGreaterThanOrEqual(MIN_HEADLINE_MAPS);
    }
  });
});

describe("no single idea owns an act", () => {
  it("pins the acts one mechanic currently dominates", () => {
    const monopolies = spreadWarnings(LEVELS)
      .filter(w => w.kind === "act-monopoly")
      .map(w => `${w.label}: ${w.detail}`)
      .sort();
    // Act I is six maps of mover, act II six of breakable, act III seven
    // colored areas, act IV four of five. Pinned so the number moving is
    // visible in either direction.
    //
    // Gravity well used to be on this list at 6 of act III's 10. Giving 23 and
    // 24 to the membrane and to fence ground took it to 4, which is the first
    // time one of these warnings has been cleared rather than added to - and it
    // was cleared as a side effect of having somewhere to put new mechanics,
    // not by trimming the well for its own sake.
    expect(monopolies).toEqual([
      "Breakable: on 6 of act II's 10 maps",
      "Colored area: on 4 of act IV's 5 maps",
      "Colored area: on 7 of act III's 10 maps",
      "Mover: on 6 of act I's 10 maps",
    ]);
  });

  it("does not complain about furniture", () => {
    // Circles are on most maps and always will be. A rule that reports them
    // buries the findings that matter.
    const keys = spreadWarnings(LEVELS).map(w => w.key);
    expect(keys).not.toContain("circle");
    expect(keys).not.toContain("polygon");
  });
});

describe("the detectors themselves", () => {
  it("finds nothing in an empty map", () => {
    const blank = { id: "x", level: 1, entities: [] } as unknown as LevelConfig;
    for (const m of MECHANICS) {
      expect(m.detect(blank), `${m.key} fired on an empty map`).toBe(false);
    }
  });

  it("tells a chest from a plain breakable", () => {
    // A chest IS a breakable, so a naive detector counts every chest twice and
    // the two lines stop meaning different things.
    const chest = {
      id: "x", level: 1,
      entities: [{ id: "c", kind: "wall", shape: "rect", x: 0, y: 0, width: 10, height: 10, breakable: true, chest: true }],
    } as unknown as LevelConfig;
    expect(MECHANICS.find(m => m.key === "chest")!.detect(chest)).toBe(true);
    expect(MECHANICS.find(m => m.key === "breakable")!.detect(chest)).toBe(false);
  });

  it("counts a bend and a curve as the same idea", () => {
    const bent = (e: Record<string, unknown>) => ({
      id: "x", level: 1,
      entities: [{ id: "w", kind: "wall", shape: "rect", x: 0, y: 0, width: 10, height: 10, ...e }],
    } as unknown as LevelConfig);
    const detect = MECHANICS.find(m => m.key === "bend")!.detect;
    expect(detect(bent({ bend: 0.3 }))).toBe(true);
    expect(detect(bent({ curves: [0, 0.2] }))).toBe(true);
    expect(detect(bent({ curves: [0, 0] })), "a row of zeroes is not a curve").toBe(false);
    expect(detect(bent({}))).toBe(false);
  });

  it("reads the field names the schema actually uses", () => {
    // Both of these were wrong on the first pass - `charge` for `charges`, and
    // `maxFenceBudget` for `fenceBudget` - and a wrong name does not throw, it
    // silently reports zero. A mechanic that is quietly invisible to the very
    // tool meant to find quiet mechanics is the worst possible failure here.
    expect(use("charge").levels.length).toBeGreaterThan(0);
    expect(use("fenceBudget").levels.length).toBeGreaterThan(0);
    expect(use("dataStream").levels.length).toBeGreaterThan(0);
    expect(use("circuit").levels.length).toBeGreaterThan(0);
    expect(use("pickupSpots").levels.length).toBeGreaterThan(0);
    expect(use("phasing").levels.length).toBeGreaterThan(0);
    expect(use("threadLock").levels.length).toBeGreaterThan(0);
    expect(use("mutator").levels.length).toBeGreaterThan(0);
  });
});
