/**
 * Act I asks for something, and what it asks for is on the board.
 *
 * The maps used to be beatable two ways that ignored them entirely: seal every
 * ball (the allLocked alternative shipped the map whatever the board looked
 * like, and the capture cascade met the space clause as a consequence), or
 * never lock anything at all and just shrink to a 40-22% threshold. Bot runs
 * confirmed both: locks == maxBalls with 0% remaining on every derived map, and
 * maps 1-7 won with ZERO locks once the push prompt was out of the way.
 *
 * Every act I map now states its win, and the statement names the map's own
 * content. These tests are about the specs being HONEST rather than about
 * difficulty: an unwinnable map is silent - it simply never finishes - and
 * winSpecProblems exists because that failure has no other symptom.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { resolveWinSpec, winSpecProblems, NO_RUN_RULES } from "@/lib/winSpec";
import { gateAreas } from "@/lib/coloredAreas";
import { goalAtRisk, type Goal } from "@/lib/goalTracker";
import type { LevelConfig, LevelData } from "@/types/level";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];

const ACT_ONE = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const at = (n: number) => LEVELS.find(l => l.level === n)!;

const breakables = (l: LevelConfig) =>
  (l.entities ?? []).filter(e => e.kind === "wall" && e.breakable).length;

describe("every act I map states its own win", () => {
  it("authors a win rather than inheriting one from legacy fields", () => {
    // A derived spec is the one that carries the free allLocked alternative.
    // Any act I map still on the derivation is still on the old shortcut.
    for (const n of ACT_ONE) {
      expect(resolveWinSpec(at(n), NO_RUN_RULES).authored, `level ${n} has no win: block`).toBe(true);
    }
  });

  it("passes the authoring guard on every map", () => {
    for (const n of ACT_ONE) {
      expect(winSpecProblems(resolveWinSpec(at(n), NO_RUN_RULES), at(n)), `level ${n}`).toEqual([]);
    }
  });

  it("keeps the free all-locked alternative off every act I map", () => {
    // THE shortcut. An authored spec keeps no alternative unless it asks for
    // one, which is why authoring is the fix rather than a stylistic tidy-up.
    for (const n of ACT_ONE) {
      expect(resolveWinSpec(at(n), NO_RUN_RULES).alsoWinIf, `level ${n} still offers a shortcut`).toEqual([]);
    }
  });

  it("never asks for more smashes than the map puts on the board", () => {
    // The guard above covers this, but it is worth its own failure message:
    // this is the number most likely to drift when a map is re-cut, and a map
    // that asks for a slab it no longer has can never be finished.
    for (const n of ACT_ONE) {
      const smash = resolveWinSpec(at(n), NO_RUN_RULES).require.find(c => c.kind === "smashed");
      if (smash?.kind !== "smashed") continue;
      expect(smash.count, `level ${n} asks for more than it offers`)
        .toBeLessThanOrEqual(breakables(at(n)));
    }
  });

  it("never asks for more locks than the map spawns balls", () => {
    for (const n of ACT_ONE) {
      const locks = resolveWinSpec(at(n), NO_RUN_RULES).require.find(c => c.kind === "locks");
      if (locks?.kind !== "locks") continue;
      expect(locks.count, `level ${n} asks for more locks than balls`)
        .toBeLessThanOrEqual(at(n).maxBalls ?? 1);
    }
  });
});

/**
 * The free route the ladder used to allow, stated as a property of the specs.
 *
 * Deliberately checked on the SPEC rather than by playing: "can this map be
 * won by sealing everything" is a question about what it asks for, and a bot
 * that happens not to find the route proves nothing about whether it exists.
 */
describe("the lock rush is closed where it can be", () => {
  it("prices no lock on an act I map that closes the rush with content", () => {
    // This used to assert the opposite for route 2: that no map could be
    // cleared without locking a ball. Route 2 is not an exploit, it is the
    // Ship It assignment, which pays for clearing a map without sealing one -
    // and `blockSpaceWinnableMaps` drops that mission from any block whose
    // maps all demand a lock. Requiring locks across the ladder made that
    // every block and deleted the mission outright.
    //
    // A lock count closes nothing against the rush anyway: the rush PRODUCES
    // locks. So on a map that already closes it with content, the lock count
    // was pure cost, and it goes. Maps 1-4 keep theirs: with nothing to smash
    // they have no other ask, and the rush stays open on them by admission
    // (see the pinned list in ladderWins.test.ts).
    for (const n of ACT_ONE) {
      const spec = resolveWinSpec(at(n), NO_RUN_RULES);
      const closesTheRush = spec.require.some(c => c.kind === "smashed");
      if (!closesTheRush) continue;
      const pricesALock = spec.require.some(c =>
        (c.kind === "locks" && c.count > 0) || c.kind === "superiorLocks" || c.kind === "lockType");
      expect(pricesALock, `level ${n} closes the rush AND still bills a lock`).toBe(false);
    }
  });

  it("asks every map carrying a feature to use it", () => {
    // Route 1: sealing everything with the board untouched. A map whose only
    // requirement is space (plus locks, which the sealing itself provides) is
    // still beatable that way, because the capture cascade meets the space
    // clause. Only a clause a lock cannot produce closes it.
    for (const n of ACT_ONE) {
      const level = at(n);
      // A `required: false` area is a BONUS pocket by design, not content the
      // win is allowed to demand: level 3 is the first map to show the symbol
      // and its whole job is that misreading it cannot cost you anything. Read
      // through gateAreas rather than re-stating the rule, so this cannot
      // disagree with the runtime about what counts.
      const hasFeature =
        breakables(level) > 0 || gateAreas(level.coloredAreas ?? []).length > 0;
      if (!hasFeature) continue;
      const spec = resolveWinSpec(level, NO_RUN_RULES);
      const usesIt = spec.require.some(c => c.kind === "smashed" || c.kind === "area");
      expect(usesIt, `level ${n} carries a feature its win never mentions`).toBe(true);
    }
  });
});

/**
 * The warning that has to arrive before the life is gone.
 *
 * Stranding a map costs a life, so the rule is only fair if the board says it
 * is coming. The chip already reports what the map wants; at one ball left it
 * turns to a warning, because from there every outstanding requirement rides
 * on that ball and locking it ends the map for good.
 */
describe("the last ball is flagged before it strands the map", () => {
  const gate = (met: boolean): Goal => ({
    key: "smashed", kind: "smashed", tier: "requirement", labelKey: "winGate.smashed",
    current: met ? 1 : 0, target: 1, done: met, over: false, progress: null,
  });

  it("warns once one ball is left and the gate is outstanding", () => {
    expect(goalAtRisk(gate(false), 1)).toBe(true);
  });

  it("stays quiet while there is still a ball to spare", () => {
    // Two balls is a choice, not a trap: seal one and break with the other.
    // Crying wolf here would make the warning worth ignoring at one.
    expect(goalAtRisk(gate(false), 2)).toBe(false);
    expect(goalAtRisk(gate(false), 3)).toBe(false);
  });

  it("stays quiet once the gate is satisfied", () => {
    expect(goalAtRisk(gate(true), 1)).toBe(false);
  });

  it("still warns on an empty board, where the map is already lost", () => {
    // Not a live warning so much as a guard against reading `=== 1`: the state
    // it describes is strictly worse, and a chip that went calm at zero would
    // say the map was fine at the moment it became unwinnable.
    expect(goalAtRisk(gate(false), 0)).toBe(true);
  });

  /**
   * A limit clause is met until it is blown, so it reads as satisfied from the
   * first frame. gateSatisfied already refuses to call that done, and the
   * warning inherits it: "finish under par" is a constraint you are living
   * under, and it is not something the last ball can strand.
   */
  it("treats a limit clause as outstanding, the way the chip does", () => {
    const underPar: Goal = {
      key: "underPar", kind: "underPar", tier: "requirement", labelKey: "winGate.underPar",
      current: 0, target: 6, done: false, over: false, progress: null,
    };
    expect(goalAtRisk(underPar, 1)).toBe(true);
  });
});

/**
 * How hard the early breakables are allowed to be.
 *
 * `maxHits` is not a count of contacts: the force model gives a standard ball
 * striking head-on at nominal speed ~1.0 damage, and scales with the closing
 * speed along the normal to the power 1.6, so a glancing hit does a fraction of
 * that and a crawling graze does 0.15. A slab authored at 6 is therefore a good
 * deal MORE than six touches in practice, which is how level 5 came to read as
 * hardcore on the map that introduces breaking at all.
 *
 * Three is the ceiling for act I. The Meet/Fight escalation lives inside that
 * range rather than above it.
 */
describe("act I breakables stay inside three solid hits", () => {
  const breakables = (l: LevelConfig) =>
    (l.entities ?? []).filter(
      (e): e is Extract<typeof e, { kind: "wall" }> => e.kind === "wall" && !!e.breakable,
    );

  it.each(ACT_ONE)("level %i asks for no more than three", (n) => {
    for (const e of breakables(at(n))) {
      expect(e.hitsToBreak ?? 1, `level ${n} ${e.id} takes ${e.hitsToBreak} hits`)
        .toBeLessThanOrEqual(3);
    }
  });

  it("still escalates: the map that introduces breaking is the gentlest", () => {
    // A flat 3 everywhere would satisfy the cap and teach nothing. Level 5 is
    // the Meet, level 6 the Fight, and the Fight has to cost more.
    const meet = breakables(at(5)).map(e => e.hitsToBreak ?? 1);
    const fight = breakables(at(6)).map(e => e.hitsToBreak ?? 1);
    expect(Math.max(...meet), "the first breakable is not the gentlest")
      .toBeLessThan(Math.max(...fight));
  });

  // "leaves the late-ladder set-pieces alone" used to live here, pinning level
  // 25's 40-hit slab plug as proof that the three-hit cap is an ACT I rule and
  // not a ladder-wide nerf. Map 25 is retired, so there is no deep set-piece to
  // point at and the assertion had nothing left to say.
  //
  // The rule it guarded is unchanged: the cap applies to act I, and a rebuilt
  // map is free to author a slab that takes forty hits if the build by then can
  // answer it. Re-add the check against the first deep map that does.
});
