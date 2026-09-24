/**
 * Only a monolith stacked on a monolith topples. A shard never does, and a
 * wall never does.
 *
 * Reported from play on level 9: a ball clipping the bottom shard of either
 * column brought the other four down with it. The stack graph (issue #38)
 * reads anything within 30 px above another obstacle as "resting on" it, and
 * runs of shards are authored 8 px apart, so every run on the ladder was a
 * hidden stack - and only on two deals of four, because "down" is the board
 * bottom and rotation does not turn it. The same tolerance read a room's side
 * walls as resting on its floor, so on levels 11 and 18 breaking the curtain or
 * the door toppled the architecture around it.
 */
import { describe, it, expect } from "vitest";
import { createInitialGameData } from "@/lib/initGame";
import { createBotGame } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { LADDER } from "./fixtures/maps";
import type { LevelConfig, LevelEntity } from "@/types/level";

const brick = (id: string, y: number, extra: Partial<LevelEntity> = {}): LevelEntity => ({
  id, kind: "wall", shape: "rect", x: 400, y, width: 60, height: 29, ...extra,
} as LevelEntity);

// Level 3 never rotates, so "above" in the fixture is "above" on the board.
const level = (entities: LevelEntity[]): LevelConfig => ({
  id: "stack-test", level: 3, name: "S", sizeThreshold: 30, expectedCuts: 4,
  points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1, entities,
} as unknown as LevelConfig);

const links = (entities: LevelEntity[]) =>
  createInitialGameData(level(entities), 3, DEFAULT_MODIFIERS).stackObjects
    .filter(o => o.supporterId !== null)
    .map(o => `${o.id}<${o.supporterId}`);

describe("the stack graph", () => {
  it("reads no stack in a column of shards 8 px apart", () => {
    expect(links([
      brick("s1", 400, { brittle: true }), brick("s2", 437, { brittle: true }),
      brick("s3", 474, { brittle: true }),
    ])).toEqual([]);
  });

  it("does not stand a monolith on a shard, or a shard on a monolith", () => {
    expect(links([
      brick("m1", 400, { breakable: true }), brick("s1", 437, { brittle: true }),
      brick("s2", 474, { brittle: true }), brick("m2", 511, { breakable: true }),
    ])).toEqual([]);
  });

  it("never lets a plain wall fall when the breakable under it goes", () => {
    expect(links([brick("jamb", 400), brick("door", 437, { breakable: true })])).toEqual([]);
  });

  it("still stacks a monolith on a monolith, which is what #38 is for", () => {
    expect(links([
      brick("top", 400, { breakable: true }), brick("base", 437, { breakable: true }),
    ])).toEqual(["top<base"]);
  });

  it("still stacks a chest on a monolith", () => {
    expect(links([
      brick("chest", 400, { chest: true }), brick("base", 437, { breakable: true }),
    ])).toEqual(["chest<base"]);
  });
});

describe("the shipped ladder", () => {
  it("has no hidden topple on any map, on any deal", () => {
    const found: string[] = [];
    for (const l of LADDER) {
      for (let s = 0; s < 12; s++) {
        setRunSeedText(`topple-audit-${s}`);
        const g = createBotGame(l, l.level).game;
        for (const o of g.stackObjects) {
          if (o.supporterId) found.push(`L${l.level} r${g.mapRotation}: ${o.id} rests on ${o.supporterId}`);
        }
      }
    }
    expect([...new Set(found)]).toEqual([]);
  });
});
