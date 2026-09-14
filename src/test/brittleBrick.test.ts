/**
 * A brittle brick breaks on the first contact that counts.
 *
 * The force model floors a grazing chip at 0.15 damage, which is right for a
 * slab and wrong for a brick: a wall of one-touch bricks is meant to open
 * wherever the balls happen to touch it, so the shape of the wall is the
 * variable (MAP_DESIGN_GUIDELINES.md section 11). `hitsToBreak: 1` does not
 * give that - a graze leaves it standing - which is why brittle is a flag and
 * not a number.
 */
import { describe, it, expect } from "vitest";
import { registerObjectHit } from "@/lib/physics/destructibles";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import type { DestructibleState } from "@/types/game";
import type { CanvasGameState } from "@/types/gameState";
import type { LevelConfig } from "@/types/level";

/** The least game registerObjectHit needs: somewhere to queue debris and destroys. */
function game(): CanvasGameState {
  return { objectDebris: [], pendingDestroys: [] } as unknown as CanvasGameState;
}

function slab(brittle: boolean, maxHits = 1): DestructibleState {
  return {
    id: brittle ? "brick" : "slab",
    kind: "breakable",
    hits: 0,
    maxHits,
    lastHitAt: 0,
    destroyed: false,
    brittle,
  };
}

describe("a brittle brick", () => {
  it("breaks on a graze that would leave a one-hit slab standing", () => {
    const g = game();
    const plain = slab(false);
    const brick = slab(true);
    registerObjectHit(g, plain, "ball", 1000, 0.15);
    registerObjectHit(g, brick, "ball", 1000, 0.15);
    expect(plain.destroyed).toBe(false);
    expect(brick.destroyed).toBe(true);
    expect(g.pendingDestroys).toEqual([brick]);
  });

  it("still goes through the debounce, so one pass is one hit", () => {
    const g = game();
    const brick = slab(true);
    brick.lastHitAt = 1000;
    registerObjectHit(g, brick, "ball", 1100, 0.15);
    expect(brick.destroyed).toBe(false);
  });

  it("is a breakable even when `breakable` is not written", () => {
    const level = {
      id: "brittle-only",
      level: 1,
      sizeThreshold: 20,
      expectedCuts: 3,
      points: 5,
      maxBalls: 1,
      variety: 0,
      randomShapes: 0,
      entities: [
        { id: "b", kind: "wall", shape: "rect", x: 400, y: 400, width: 60, height: 22, brittle: true },
      ],
    } as unknown as LevelConfig;
    const built = createInitialGameData(level, 1, DEFAULT_MODIFIERS);
    const d = built.destructibles.find(x => x.id === "b");
    expect(d?.kind).toBe("breakable");
    expect(d?.brittle).toBe(true);
  });
});
