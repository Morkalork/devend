/**
 * Every ladder map can be won by the roster a player actually has.
 *
 * MAP_DESIGN_CARD.md section 5: the balls are the player's, `maxBalls` is a
 * cap and never a floor, and every map must be clearable with ONE ball. A
 * goal counted in balls ("lock two") is a lean toward the fleet and needs a
 * one-ball route beside it.
 *
 * Found by the bot players (BOT_PLAYERS.md): archive map 2 asks for a lock on
 * each side of the board, which one ball cannot give, and was lost on all 216
 * attempts. This holds the new ladder to the rule before a map like that
 * lands on it.
 *
 * And section 3: every counted clause has a spare, per class. The archive's
 * own check (smashCutRefusal.test.ts) never read map.yml.
 */
import { describe, it, expect } from "vitest";
import { LADDER } from "./fixtures/maps";
import type { WinCondition } from "@/types/winSpec";
import type { LevelConfig } from "@/types/level";

/** The roster's balls are the catalogue's red; nothing else rolls onto a map under the tree. */
const ROSTER_BALL_TYPE = "red";

/** How many of the player's balls a clause needs, at the least. Infinity when no roster can meet it. */
export function ballsNeeded(c: WinCondition): number {
  switch (c.kind) {
    case "locks":
    case "superiorLocks":
    case "area":
    case "delivered":
      return c.count;
    case "splitLocks":
      // A lock on each side: twice the count.
      return c.count * 2;
    case "lockType":
      return c.ballType === ROSTER_BALL_TYPE ? c.count : Infinity;
    case "allLocked":
      return 1;
    default:
      return 0;
  }
}

/** The fewest balls the map can be won with: its requirements, or any one alternative. */
export function fewestBallsToWin(level: LevelConfig): number {
  const require = level.win?.require ?? [];
  const needRequire = Math.max(0, ...require.map(ballsNeeded));
  const alternatives = (level.win?.alsoWinIf ?? []).map(ballsNeeded);
  return Math.min(needRequire, ...alternatives);
}

describe("the ladder and the roster", () => {
  it.each(LADDER.map(l => [l.id, l] as const))("%s can be won with one ball", (_id, level) => {
    expect(level.maxBalls ?? 1, `${level.id}: maxBalls is a cap, at least 1`).toBeGreaterThanOrEqual(1);
    expect(fewestBallsToWin(level), `${level.id} needs more balls than a run may have`).toBeLessThanOrEqual(1);
  });

  it("reads clauses the way the rule means them", () => {
    const one = { id: "x", win: { require: [{ kind: "locks", count: 1 }] } } as unknown as LevelConfig;
    const two = { id: "x", win: { require: [{ kind: "locks", count: 2 }] } } as unknown as LevelConfig;
    const twoOrBricks = { id: "x", win: { require: [{ kind: "locks", count: 2 }], alsoWinIf: [{ kind: "smashed", count: 6 }] } } as unknown as LevelConfig;
    const split = { id: "x", win: { require: [{ kind: "splitLocks", count: 1 }] } } as unknown as LevelConfig;
    const blackBall = { id: "x", win: { require: [{ kind: "lockType", ballType: "black", count: 1 }] } } as unknown as LevelConfig;
    expect(fewestBallsToWin(one)).toBe(1);
    expect(fewestBallsToWin(two)).toBe(2);
    expect(fewestBallsToWin(twoOrBricks)).toBe(0);
    expect(fewestBallsToWin(split)).toBe(2);
    expect(fewestBallsToWin(blackBall)).toBe(Infinity);
  });
});

describe("the ladder's counted clauses", () => {
  it.each(LADDER.map(l => [l.id, l] as const))("%s leaves a spare on every smash clause", (_id, level) => {
    type Ent = { brittle?: boolean; chest?: boolean; breakable?: boolean };
    const entities = (level.entities ?? []) as Ent[];
    const shards = entities.filter(e => e.brittle === true).length;
    const monoliths = entities.filter(e => (e.chest === true || e.breakable === true) && e.brittle !== true).length;
    for (const c of level.win?.require ?? []) {
      if (c.kind !== "smashed") {
        continue;
      }
      const have = c.of === "shards" ? shards : c.of === "monoliths" ? monoliths : shards + monoliths;
      expect(c.count, `${level.id} asks for ${c.count} of ${c.of ?? "all"} and has ${have}: no spare`).toBeLessThan(have);
    }
  });
});
