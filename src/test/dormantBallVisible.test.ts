import { describe, it, expect } from "vitest";
import { createInitialGameData } from "@/lib/initGame";
import type { LevelConfig } from "@/types/level";
import type { GameModifiers } from "@/hooks/useActiveModifiers";

/**
 * Circuit maps (#73) spawn DORMANT balls: un-booted sleepers that reserve space
 * you cannot clear until a fence is routed through their terminal to wake them.
 *
 * They must exist in game.balls in the dormant state, because the renderer has
 * to draw them - a sleeper that is invisible leaves the player looking at
 * territory that refuses to be captured with nothing on screen explaining why.
 * (The sleek ball layer filtered `state !== "dormant"` out entirely, which is
 * exactly how that regression happened.)
 */
const MODS = {
  ballSpeedMultiplier: 1, ballSizeMultiplier: 1,
} as unknown as GameModifiers;

const CIRCUIT_LEVEL = {
  id: "circuit-dormant", level: 8, sizeThreshold: 30, expectedCuts: 5, points: 20,
  maxBalls: 1, variety: 0, randomShapes: 0, entities: [],
  circuit: {
    radius: 30,
    terminals: [
      { x: 300, y: 300, ball: { x: 250, y: 250 } },
      { x: 600, y: 600, ball: { x: 650, y: 650 } },
    ],
  },
} as unknown as LevelConfig;

describe("circuit dormant balls", () => {
  it("spawns a dormant ball per terminal, present in game.balls", () => {
    const data = createInitialGameData(CIRCUIT_LEVEL, 8, MODS);
    const dormant = data.balls.filter(b => b.state === "dormant");
    expect(dormant.length).toBe(2);
    expect(data.circuit?.terminals.length).toBe(2);
  });

  it("keeps them out of the ACTIVE set until booted", () => {
    const data = createInitialGameData(CIRCUIT_LEVEL, 8, MODS);
    for (const b of data.balls.filter(x => x.state === "dormant")) {
      expect(b.speed).toBe(0);
    }
  });
});
