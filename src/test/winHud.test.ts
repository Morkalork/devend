/**
 * The board says out loud when it wants something unusual.
 *
 * "I want the win-scenarios to be as clear as day." Three of the forty
 * authored maps require something beyond fencing off space and locking balls -
 * a superior lock (32), a named type sealed (33), a ball locked in a coloured
 * area (34) - and the only place that said so was an item inside the hamburger
 * menu. Checked every frame, invisible unless you went looking.
 *
 * The thing these tests are really protecting is that the readouts cannot
 * disagree with the gate. A chip that says a requirement is met on a map that
 * then refuses to finish is worse than no chip: it turns a rule the player
 * could have learned into a bug they have to work around. So the selectors run
 * the same evaluator the win check runs, and the tests below check them
 * against isWinMet rather than against their own arithmetic.
 */
import { describe, it, expect } from "vitest";
import { extraGates, gateSatisfied, hasOutstandingGate, isExtraGate } from "@/lib/winHud";
import { isWinMet } from "@/lib/winSpec";
import type { WinSnapshot, WinSpec } from "@/types/winSpec";

const snap = (over: Partial<WinSnapshot> = {}): WinSnapshot => ({
  remainingPercent: 40, lockedBalls: 0, superiorLocks: 0, areaTargets: 0,
  lockedByType: {}, delivered: 0, smashed: 0, bossDefeated: false, allLocked: false,
  cuts: 0, par: 6, activeSeconds: 0, ...over,
});

/** Level 32's shape: clear the board AND land a superior lock. */
const L32: WinSpec = {
  require: [{ kind: "space", threshold: 7 }, { kind: "superiorLocks", count: 1 }],
  alsoWinIf: [{ kind: "allLocked" }],
  authored: true,
};

describe("which requirements get a chip", () => {
  it("says nothing at all on an ordinary map", () => {
    // THE property that makes a chip mean something. It appears on three maps
    // in forty; one that appeared on every map would be chrome the eye learns
    // to skip, which is the state this replaces.
    const plain: WinSpec = {
      require: [{ kind: "space", threshold: 10 }, { kind: "locks", count: 2 }],
      alsoWinIf: [{ kind: "allLocked" }], authored: false,
    };
    expect(extraGates(plain, snap())).toEqual([]);
    expect(hasOutstandingGate(plain, snap())).toBe(false);
  });

  it("leaves out space and locks, which the top bar already reports", () => {
    // Both have their own readout: space as "12% to go" / CLEAR, locks on the
    // lock chip. Repeating them would push the unusual one off the end of a row
    // that is already full on a phone.
    expect(isExtraGate({ kind: "space", threshold: 10 })).toBe(false);
    expect(isExtraGate({ kind: "locks", count: 2 })).toBe(false);
    expect(extraGates(L32, snap()).map(p => p.condition.kind)).toEqual(["superiorLocks"]);
  });

  it("picks up every unusual kind", () => {
    for (const c of [
      { kind: "superiorLocks", count: 1 }, { kind: "area", count: 1 },
      { kind: "lockType", ballType: "green", count: 1 }, { kind: "boss" },
      { kind: "allLocked" }, { kind: "underPar", delta: 0 },
      { kind: "speedClear", seconds: 40 },
    ] as const) {
      expect(isExtraGate(c), `${c.kind} was treated as ordinary`).toBe(true);
    }
  });

  it("never shows an alternative as a requirement", () => {
    // alsoWinIf is a way OUT of the map, not a demand. Rendering "all balls
    // locked" as an unmet requirement would tell the player they must lock
    // everything on a map where that is merely one of two options.
    expect(extraGates(L32, snap()).map(p => p.condition.kind)).not.toContain("allLocked");
  });

  it("reports live progress, not just presence", () => {
    // "0/1" is the part a border could never carry, and it is what the player
    // needs while the map is running.
    const [g] = extraGates(
      { require: [{ kind: "superiorLocks", count: 3 }], alsoWinIf: [], authored: true },
      snap({ superiorLocks: 2 }),
    );
    expect(g.current).toBe(2);
    expect(g.target).toBe(3);
    expect(g.met).toBe(false);
  });
});

describe("the board frame", () => {
  it("is lit while the unusual requirement is outstanding", () => {
    expect(hasOutstandingGate(L32, snap())).toBe(true);
  });

  it("resolves the moment that requirement is satisfied", () => {
    expect(hasOutstandingGate(L32, snap({ superiorLocks: 1 }))).toBe(false);
  });

  it("ignores the ordinary clear entirely", () => {
    // The frame is about "this map is not a normal clear", so a board still
    // full of space must not light it, and a cleared board must not resolve it.
    expect(hasOutstandingGate(L32, snap({ remainingPercent: 90, superiorLocks: 1 }))).toBe(false);
    expect(hasOutstandingGate(L32, snap({ remainingPercent: 0, superiorLocks: 0 }))).toBe(true);
  });

  it("does not treat a live constraint as an achievement", () => {
    // THE subtle one. A limit clause is met until it is blown, so under-par
    // reads as satisfied on the very first frame. Calling that done would
    // resolve the frame on a map the player has not begun to earn.
    const underPar: WinSpec = {
      require: [{ kind: "underPar", delta: 0 }], alsoWinIf: [], authored: true,
    };
    const fresh = evaluateFirst(underPar);
    expect(fresh.met, "the evaluator no longer reports a fresh limit as met").toBe(true);
    expect(gateSatisfied(fresh), "a limit was banked as an achievement").toBe(false);
    expect(hasOutstandingGate(underPar, snap())).toBe(true);
  });

  function evaluateFirst(spec: WinSpec) {
    return extraGates(spec, snap())[0];
  }
});

describe("the readouts against the gate itself", () => {
  it("never calls a map's extra requirement done while the map refuses to win", () => {
    // The failure this whole file exists to prevent, checked directly: sweep
    // the states of level 32 and assert the frame only ever resolves where the
    // real win check agrees the requirement is behind you.
    for (const superiorLocks of [0, 1, 2]) {
      for (const remainingPercent of [40, 7, 0]) {
        const s = snap({ superiorLocks, remainingPercent });
        if (!hasOutstandingGate(L32, s)) {
          // The extra part is claimed done, so clearing the board must finish
          // the map. If it would not, the chip is lying.
          expect(
            isWinMet(L32, { ...s, remainingPercent: 0 }),
            `frame resolved at superiorLocks=${superiorLocks} but the map would not win`,
          ).toBe(true);
        }
      }
    }
  });

  it("stays outstanding on a map won only by its alternative", () => {
    // Locking everything wins level 32 without a superior lock. The map is won,
    // but the REQUIREMENT was never met, and the frame reports the requirement.
    // Getting this backwards would have the frame resolve for a reason the
    // chips cannot explain.
    const s = snap({ allLocked: true, remainingPercent: 40 });
    expect(isWinMet(L32, s), "the alternative no longer wins the map").toBe(true);
    expect(hasOutstandingGate(L32, s)).toBe(true);
  });
});
