/**
 * A chained boss pair is ONE win, and neither trap ends the map alone.
 *
 * checkBallWonState has always known that - "a single trap can't end the map or
 * pop its partner", guarded by `allShipped` before it sets `bossDefeated`. The
 * WIN CHECK was not asking it. Every boss map fences its boss into a var zone,
 * and the derivation matched the gate-area branch BEFORE the boss branch, so
 * all four bosses on the ladder won through `area count 1`: any target ball
 * locked inside the zone, counted once.
 *
 * On a single boss those are the same moment, which is why nothing showed. On
 * the chained pairs (20 "Sprint Review" and 35 "Ship It") trapping one of the
 * two satisfied `area count 1` and shipped the map with the other still loose -
 * the second half of the fight simply never happened.
 *
 * The fix is an ordering: boss before gate. These pin both halves, because the
 * ordering is the kind of thing a later tidy-up reverses on the grounds that
 * the two branches "look independent".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { resolveWinSpec, requirementsMet } from "@/lib/winSpec";
import type { WinSnapshot } from "@/types/winSpec";
import type { LevelConfig, LevelData } from "@/types/level";

const LEVELS = (yaml.load(
  readFileSync(resolve(process.cwd(), "public/map.yml"), "utf8"),
) as LevelData).levels as LevelConfig[];
const BOSSES = LEVELS.filter(l => l.boss);
const at = (n: number) => LEVELS.find(l => l.level === n)!;

/** A board where one target is sitting in the zone and the boss is not beaten. */
const oneInTheZone = (over: Partial<WinSnapshot> = {}): WinSnapshot => ({
  remainingPercent: 100, lockedBalls: 1, superiorLocks: 0, delivered: 0,
  smashed: 0, terminals: 0, harvested: 0, areaTargets: 1, lockedByType: {},
  bossDefeated: false, allLocked: false, cuts: 1, par: 9, activeSeconds: 10,
  ...over,
});

describe("the boss is the win, not the zone", () => {
  it("finds the chained pairs, so this is testing something", () => {
    const pairs = BOSSES.filter(l => (l.boss?.bossBall?.count ?? 1) > 1).map(l => l.level);
    expect(pairs, "the pairs were retired: is this file still needed?").toEqual([20, 35]);
  });

  it.each(BOSSES.map(l => [l.level as number, l] as const))(
    "level %i states its win as the boss", (_n, level) => {
      expect(resolveWinSpec(level).require.map(c => c.kind), `${level.id}`).toEqual(["boss"]);
    });

  it.each(BOSSES.map(l => [l.level as number, l] as const))(
    "level %i is not finished by one ball in the zone", (_n, level) => {
      // THE bug. Every boss map carries a var zone, so before the ordering fix
      // this snapshot met `area count 1` and shipped the map.
      expect(
        requirementsMet(resolveWinSpec(level), oneInTheZone()),
        `${level.id} ships on a target in the zone with the boss still loose`,
      ).toBe(false);
    });

  it("waits for BOTH halves of a pair, and no longer", () => {
    // bossDefeated is the flag checkBallWonState sets only once every boss ball
    // is shipped, so reading it IS reading "both".
    const spec = resolveWinSpec(at(20));
    expect(requirementsMet(spec, oneInTheZone({ bossDefeated: false }))).toBe(false);
    expect(requirementsMet(spec, oneInTheZone({ bossDefeated: true }))).toBe(true);
  });

  it("keeps the gate branch working for maps that are not boss maps", () => {
    // The ordering must not have deleted the gate derivation, only moved it
    // behind the boss. Level 34's gate is authored, so this reads the branch
    // through a map that derives one.
    const gateOnly = {
      id: "x", level: 1, sizeThreshold: 30, expectedCuts: 5, points: 20,
      coloredAreas: [{ x: 0, y: 0, width: 100, height: 100, kind: "var", required: true }],
    } as unknown as LevelConfig;
    expect(resolveWinSpec(gateOnly).require).toEqual([{ kind: "area", count: 1 }]);
  });
});
