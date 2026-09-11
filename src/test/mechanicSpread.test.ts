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
 *
 * THE LADDER IS TEN MAPS while acts II-IV are rebuilt, so the pinned numbers
 * describe act I on its own and the unused list below is twenty names long.
 * That list is not a backlog of bugs, it is the rebuild's checklist: every
 * mechanic the engine has and the ladder has not placed yet. A name coming off
 * it is a rebuilt map landing, which is exactly the conversation this file was
 * written to force - so it stays pinned rather than being softened to "> 0".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  MECHANICS, ACTS, mechanicSpread, spreadWarnings, actOf, MIN_HEADLINE_MAPS,
} from "@/lib/admin/mechanicSpread";
import type { LevelConfig } from "@/types/level";
import { LADDER, LADDER_END, ENGINE_MAPS } from "./fixtures/maps";

const LEVELS = LADDER;

const use = (key: string) => mechanicSpread(LEVELS).find(m => m.key === key)!;

describe("the ladder itself", () => {
  it("is one map per level number, with no gap in the middle", () => {
    // The b-variants were retired on 2026-08-31. Everything below assumes one
    // map per number, so this is the assumption stated out loud.
    //
    // The LENGTH is no longer pinned - the ladder grows a map at a time while
    // acts II-IV are rebuilt - but its SHAPE is: 1 to LADDER_END with nothing
    // missing and nothing doubled. A rebuilt map landing as 12 while 11 is
    // still unwritten would leave a hole a run walks straight into.
    const numbers = LEVELS.map(l => l.level);
    expect(new Set(numbers).size, "two maps share a level number")
      .toBe(LEVELS.length);
    expect(Math.min(...numbers)).toBe(1);
    expect(Math.max(...numbers)).toBe(LADDER_END);
    expect(LEVELS.length, `a level number is missing below ${LADDER_END}`)
      .toBe(LADDER_END);
  });

  it("puts every level in exactly one act", () => {
    for (const l of LEVELS) {
      expect(actOf(l.level), `level ${l.level} belongs to no act`).not.toBeNull();
    }
    const total = ACTS.reduce((n, a) =>
      n + LEVELS.filter(l => l.level >= a.from && l.level <= a.to).length, 0);
    expect(total, "the acts overlap or leave a gap").toBe(LEVELS.length);
  });

  it("leaves the unbuilt acts empty rather than half-populated", () => {
    // The acts still describe the whole plan, so acts II-IV are declared and
    // hold nothing. Naming that here means a map appearing in an act before
    // the act is designed shows up as a failure rather than as a surprise.
    for (const a of ACTS.filter(a => a.from > LADDER_END)) {
      expect(LEVELS.filter(l => l.level >= a.from && l.level <= a.to),
        `act ${a.name} is not built yet but has maps in it`).toEqual([]);
    }
  });
});

describe("no mechanic is introduced and then dropped", () => {
  it("has no headline mechanic sitting on a single map", () => {
    const singles = spreadWarnings(LEVELS).filter(w => w.kind === "single-use");
    // Pinned rather than asserted empty, because these are real and known.
    // Each is a decision someone should make, not a bug to fix silently.
    //
    //   Mirror    level 13 only, which is where it MEETS. A mechanic on its
    //             first map is on this list by definition, and it comes off
    //             when a later map gives it a second.
    //   Mutator   level 14 only, which pins one. A pinned mutator is Seasoning
    //             rather than a headline idea, so it is here as a count and not
    //             as a debt: it comes off when a second map wants a set-piece
    //             built around its own weather, and nothing is wrong if that
    //             takes a while.
    //
    // BOUNCER CAME OFF on 13, LAUNCHER on 12, REVEALS on 11 - each one map
    // after arriving. Three in a row is the rebuild's rhythm rather than luck:
    // every act II map so far Meets one thing and develops the one before it,
    // so a name is on this list for exactly one map.
    //
    // The rest (box, mutator, portal, thread lock) were single-use on maps
    // 11-35 and are on the UNUSED list below with everything else acts II-IV
    // carried. They come back to this list the day one rebuilt map places them,
    // and off it the day a second does.
    //   Mirror        level 13 only, where it MEETS.
    //   Gravity well  level 15 only, where it MEETS.
    //   Mutator       level 14 only, and this one is a DESIGN decision showing
    //                 up as a count rather than a debt to pay off. 15 used it
    //                 for a day and gave it back: a map teaching a local pull
    //                 cannot also carry a global one, or it reads as two
    //                 gravities instead of one new idea. Paying this debt is
    //                 worth a map that wants weather, not a map that does not.
    //
    // `boardEdges` stays off the list, which is the part that did carry over:
    // four symmetric live walls need no gravity to earn their keep.
    expect(singles.map(w => w.key).sort()).toEqual(["gravityWell", "mirror", "mutator"]);
  });

  it("has no headline mechanic the engine supports but no map uses", () => {
    const unused = spreadWarnings(LEVELS).filter(w => w.kind === "unused");
    // THE REBUILD'S CHECKLIST, and the reason this file is worth keeping while
    // the ladder is short. Every name is a mechanic the engine implements, the
    // map builder can place, and no shipped map uses - so nothing in the game
    // teaches it and nothing exercises it in play.
    //
    // The rule this list serves is unchanged: a mechanic the engine supports
    // and no map uses is dead weight, and the honest ways off the list are to
    // place it or to mark it `headline: false`. What is different is that all
    // twenty went unused in one edit rather than by drifting, so the list is
    // pinned as a target instead of asserted empty. Softening it to "> 0" would
    // delete the only record of what acts II-IV owe the player.
    //
    // Take a name off when a rebuilt map places the mechanic. When the list is
    // empty the assertion goes back to toEqual([]). LAUNCHER was the first off,
    // on level 11; BUMPER the second, on 12; MIRROR the third, on 13; PINNED
    // MUTATOR the fourth, on 14; GRAVITY WELL the fifth, on 15.
    expect(unused.map(w => w.label).sort(), "the unplaced list changed")
      .toEqual([
        "Ball gate", "Cage", "Charge", "Data stream", "Deformable",
        "Delivery box", "Fence ground", "Latch",
        "One-way", "Phasing", "Portal", "Rotor",
        "Terminals", "Thread lock", "WIP limit",
      ]);
  });

  it("holds the mechanics that ARE developed above the floor", () => {
    // Act I's five. The other five this listed (gravity well, mirror, one-way,
    // ball gate, fence ground) were developed on maps that no longer exist and
    // are on the unused list above; naming them here as well would report the
    // same gap twice and make this test fail for a reason it does not own.
    //
    // Reveals is deliberately absent: it is on one map, which is the finding
    // the single-use test states, not a second failure.
    for (const key of ["mover", "breakable", "chest", "coloredArea", "pickupSpots"]) {
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
    // Act I is clean. Act II reports two, and the denominator is why: the rule
    // divides by the maps an act HAS, and act II has four of its eventual ten.
    // Four of four carrying a breakable is not yet a monopoly, it is a small
    // sample - and the number will fall on its own as 15-20 land.
    //
    // It is pinned rather than suppressed because underneath the sampling there
    // is a real signal. Every act II map so far wins on `space` plus `smashed`,
    // because the guidelines' shape asks for "one clause a lock cannot produce"
    // and `smashed` is the only one available until terminals, a delivery box
    // or a data stream is placed. So the breakable count is really a WIN CLAUSE
    // count, and the act diversifies when those mechanics arrive rather than by
    // scattering slabs differently.
    //
    // Take these off when act II is finished and the fractions have settled. If
    // they are still here at ten maps, they mean what the warning says.
    // Both denominators moved with level 15, which is the sampling effect the
    // note predicts working: 4 of 4 became 4 of 5 without a slab being touched,
    // because the act got a map that has none.
    //
    // Stripping level 14 to a bare board moved the NUMERATORS, and down, which
    // was the first time that had happened here: colored areas fell off the
    // list entirely and breakables went 4 of 5 to 3 of 5. The denominator then
    // went to 4 when the ladder stopped at 14, and back to 5 when the new 15
    // arrived, without any of the three breakable maps changing.
    //
    // That round trip is the sampling effect the note above warns about, shown
    // twice in two commits: the same three maps read as 3 of 5, then 3 of 4,
    // then 3 of 5 again while nothing about them was touched.
    expect(monopolies).toEqual([
      "Breakable: on 3 of act II's 5 maps",
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
    //
    // Read against ENGINE_MAPS, not the ladder. This asks whether the DETECTOR
    // matches the schema, so it needs a board that carries each mechanic; the
    // ladder currently carries none of them, and a zero here would then mean
    // "no map has a charge" rather than "the detector is looking at the wrong
    // field" - the exact confusion the test exists to prevent.
    const use = (key: string) =>
      mechanicSpread(ENGINE_MAPS).find(m => m.key === key)!;
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
