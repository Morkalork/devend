/**
 * Full-map gravity always has a bouncer on every side.
 *
 * Gravity drives every ball into whichever wall is "down" right now, and a
 * plain wall there is where balls slide and pool. So a map running a
 * `behavior: gravity` mutator gets a kick on all four edges unless it authors
 * its own, and every other map keeps exactly what it authored.
 */
import { describe, it, expect } from "vitest";
import {
  resolveBoardEdges, BOARD_SIDES, FULL_GRAVITY_EDGE_KICK,
} from "@/lib/physics/boardEdges";
import { createBotGame } from "@/lib/bot/headlessGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { LevelConfig } from "@/types/level";

const BARE = {
  id: "edges-probe", level: 14, sizeThreshold: 40, expectedCuts: 6, points: 5,
  maxBalls: 1, variety: 0, randomShapes: 0, entities: [],
} as unknown as LevelConfig;

describe("resolveBoardEdges", () => {
  it("leaves a map without full gravity exactly as authored", () => {
    expect(resolveBoardEdges(undefined, false)).toBeUndefined();
    const authored = { bottom: { kick: 1.2 } };
    expect(resolveBoardEdges(authored, false)).toBe(authored);
  });

  it("gives a bare full-gravity map a bouncer on all four sides", () => {
    const edges = resolveBoardEdges(undefined, true)!;
    for (const side of BOARD_SIDES) {
      expect(edges[side], `${side} is a plain wall`).toEqual({ kick: FULL_GRAVITY_EDGE_KICK });
    }
  });

  it("keeps the sides a map authored and only fills the rest", () => {
    const authored = { left: { bearing: "right" as const } };
    const edges = resolveBoardEdges(authored, true)!;
    expect(edges.left).toEqual({ bearing: "right" });
    expect(edges.top).toEqual({ kick: FULL_GRAVITY_EDGE_KICK });
    // The authored object is not written to: it is the level's own config.
    expect(Object.keys(authored)).toEqual(["left"]);
  });
});

describe("a full-gravity map as the game deals it", () => {
  it("bounces on every side even when the map authors no edges", () => {
    const edges = createBotGame(BARE, 14, DEFAULT_MODIFIERS, { mutator: "tipping" }).game.boardEdges;
    for (const side of BOARD_SIDES) {
      expect(edges?.[side]?.kick, `${side} is a plain wall`).toBeGreaterThan(1);
    }
  });

  it("does not add edges to a map with no global pull", () => {
    expect(createBotGame(BARE, 14, DEFAULT_MODIFIERS, { mutator: null }).game.boardEdges)
      .toBeUndefined();
  });
});
