/**
 * The roster (BALL_TREE_PLAN.md phase 1): the player's balls, carried onto the
 * board under the tree rule set.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  ROSTER_MAX, RUNG_IDS, RUNG_META, defaultRoster, getActiveRoster, parseRoster, rosterForMap, rungCount, setActiveRoster,
} from "@/lib/roster";
import { getActiveRuleSet, setActiveRuleSet } from "@/lib/cardRules";
import { createBotGame, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { LADDER, ARCHIVE, byLevel } from "./fixtures/maps";

describe("the roster", () => {
  it("starts as one plain ball and never carries more than the cap", () => {
    expect(defaultRoster()).toEqual([{ slot: 1, rungs: {} }]);
    expect(ROSTER_MAX).toBe(3);
    const four = parseRoster([{ rungs: {} }, { rungs: {} }, { rungs: {} }, { rungs: {} }]);
    expect(four.length).toBe(3);
    expect(four.map(b => b.slot)).toEqual([1, 2, 3]);
  });

  it("reads a saved roster, keeping only real rungs at real ranks", () => {
    const r = parseRoster([{ name: "Rocky", rungs: { weight: 2, worth: 9, bogus: 1 } }, { rungs: { frost: "1" } }]);
    expect(r[0]).toEqual({ slot: 1, name: "Rocky", rungs: { weight: 2 } });
    expect(r[1]).toEqual({ slot: 2, name: undefined, rungs: { frost: 1 } });
    expect(parseRoster(null)).toEqual(defaultRoster());
    expect(parseRoster([])).toEqual(defaultRoster());
    expect(rungCount(r[0])).toBe(2);
  });

  it("is trimmed to a map's cap, never padded to it", () => {
    const three = parseRoster([{ rungs: {} }, { rungs: {} }, { rungs: {} }]);
    expect(rosterForMap(three, 1).length).toBe(1);
    expect(rosterForMap(three, 5).length).toBe(3);
    expect(rosterForMap(three, undefined).length).toBe(3);
    expect(rosterForMap(three, 0).length).toBe(0);
  });

  it("names every rung's three ranks, each a sentence the player can read", () => {
    for (const id of RUNG_IDS) {
      expect(RUNG_META[id].ranks.length).toBe(3);
      for (const line of RUNG_META[id].ranks) {
        expect(line).toMatch(/\.$/);
        expect(line).not.toContain("\u2014");
      }
    }
  });

  it("keeps the live roster renumbered and copied", () => {
    setActiveRoster([{ slot: 7, rungs: { pace: 1 } }, { slot: 7, rungs: {} }]);
    expect(getActiveRoster().map(b => b.slot)).toEqual([1, 2]);
    setActiveRoster(defaultRoster());
  });
});

describe("the tree spawns the roster", () => {
  afterEach(() => {
    setActiveRuleSet("classic");
    setActiveRoster(defaultRoster());
    releaseClock();
  });

  it("puts the roster on the board, as red balls wearing their slot and rungs, capped by maxBalls", () => {
    installClock();
    setRunSeedText("roster");
    // An archive map that dealt several balls: under the tree it deals the roster instead.
    const level = byLevel(ARCHIVE, 5)!;
    expect((level.maxBalls ?? 0) >= 2 || (level.balls?.length ?? 0) >= 2).toBe(true);
    setActiveRuleSet("tree");
    setActiveRoster([{ slot: 1, rungs: { weight: 2 } }, { slot: 2, rungs: {} }]);
    const { game } = createBotGame(level, 5);
    const mine = game.balls.filter(b => b.slot !== undefined);
    expect(mine.map(b => b.slot)).toEqual([1, 2]);
    expect(mine[0].rungs).toEqual({ weight: 2 });
    expect(mine[0].id).toBe("roster-1");
    expect(mine.every(b => b.typeId === "red")).toBe(true);
    // The classic rule set still deals the map's own balls.
    setActiveRuleSet("classic");
    const { game: classic } = createBotGame(level, 5);
    expect(classic.balls.some(b => b.slot !== undefined)).toBe(false);
  });

  it("caps the roster at a map's maxBalls, and a one-ball map gets the first ball", () => {
    installClock();
    setRunSeedText("roster-cap");
    const one = byLevel(LADDER, 1)!;
    expect(one.maxBalls ?? one.balls?.length ?? 1).toBe(1);
    setActiveRuleSet("tree");
    setActiveRoster([{ slot: 1, rungs: { worth: 1 } }, { slot: 2, rungs: {} }, { slot: 3, rungs: {} }]);
    const { game } = createBotGame(one, 1);
    const mine = game.balls.filter(b => b.slot !== undefined);
    expect(mine.length).toBe(1);
    expect(mine[0].slot).toBe(1);
    expect(getActiveRuleSet()).toBe("tree");
  });
});
