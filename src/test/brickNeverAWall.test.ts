/**
 * A brick is never a wall (BRICKS_PLAN.md, "Locks and bricks" rule 7).
 *
 * Reported from play on the brick ladder's map 2: a fence drawn at the block
 * stopped at a brick as if it were a wall, and a room fenced "shut" by a brick
 * was counted as sealed. Each rule pinned:
 *
 *  1. A cut passes through a brick: the fence runs on to the next real wall.
 *  2. A brick never closes a pocket: the ground under and around it is one
 *     room with the ground beside it.
 *  3. Bricks fenced off with no ball beside them are buried with the ground:
 *     they leave the board, count for nothing, and lose the map when the win
 *     still needed them.
 *  4. The ground a broken brick stood on belongs to the room at once: a ball
 *     rolling onto it is not "outside every region" and thrown back.
 */
import { describe, it, expect } from "vitest";
import { createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { canStillStrike } from "@/lib/physics/smashReach";
import { findGridRegions } from "@/lib/spaceGrid";
import { castRayWithReflections, cuttableWalls } from "@/lib/wallGeometry";
import { setRunSeedText } from "@/lib/runRng";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import { LADDER, byLevel } from "./fixtures/maps";

const MAP2 = byLevel(LADDER, 2) as LevelConfig;

const standing = (g: CanvasGameState) => (g.destructibles ?? []).filter(d => !d.destroyed && !d.buried);
const buried = (g: CanvasGameState) => (g.destructibles ?? []).filter(d => d.buried);

function held(level: LevelConfig, seed: string, positions: Array<{ x: number; y: number }>) {
  installClock();
  setRunSeedText(seed);
  const ctx = createBotGame(level, 2, plainModifiers({ spawnFreezeSeconds: 9999 }), { lives: 3 });
  const g = ctx.game;
  positions.forEach((p, i) => {
    g.balls[i].position = { ...p };
  });
  return { ctx, g };
}

function settle(ctx: ReturnType<typeof createBotGame>) {
  for (let n = 0; ctx.game.activeWalls.length > 0 && n < 2000; n++) {
    stepBot(ctx);
  }
}

describe("a cut at the brick block", () => {
  it("passes through the bricks to the board's edges", () => {
    try {
      // Map 2's nine bricks stand in a block at x 352..548, y 409..491. A cut
      // straight down the middle, started above the block.
      const { ctx, g } = held(MAP2, "through", [{ x: 150, y: 450 }, { x: 750, y: 450 }]);
      const forward = castRayWithReflections({ x: 450, y: 200 }, { x: 0, y: 1 }, cuttableWalls(g.walls));
      const end = forward!.waypoints[forward!.waypoints.length - 1];
      expect(end.y).toBeGreaterThan(491);
      expect(forward!.finalWallId.startsWith("board-")).toBe(true);
      expect(tryCut(ctx, { x: 450, y: 200 }, { x: 0, y: 1 })).toBe(true);
      settle(ctx);
      // The fence reached the bottom edge, not the top of the block.
      const fence = g.walls.filter(w => w.id.startsWith("wall-"));
      const lowest = Math.max(...fence.map(w => Math.max(w.start.y, w.end.y)));
      expect(lowest).toBeGreaterThan(491);
      // Both balls still have a room, and every brick is still standing.
      expect(standing(g)).toHaveLength(9);
      expect(g.failure ?? null).toBeNull();
    } finally {
      releaseClock();
    }
  });

  it("never lets a brick close a pocket", () => {
    try {
      // One ball left of the block and one right of it. The board is one room
      // through the bricks: the cells under the block are open ground.
      const { g } = held(MAP2, "one-room", [{ x: 150, y: 450 }, { x: 750, y: 450 }]);
      expect(findGridRegions(g.spaceGrid!)).toHaveLength(1);
      // No cut is "closed" by a brick: a fence from the left edge to the block's
      // face leaves the room whole (the cut carries on through the block).
      expect(standing(g).every(d => canStillStrike(g, d))).toBe(true);
    } finally {
      releaseClock();
    }
  });
});

describe("bricks fenced off with no ball beside them", () => {
  it("are buried with the ground, and lose the map when the win needed them", () => {
    try {
      // Both balls on the left, one fence between them and the block.
      const { ctx, g } = held(MAP2, "buried", [{ x: 150, y: 250 }, { x: 150, y: 650 }]);
      expect(tryCut(ctx, { x: 300, y: 450 }, { x: 0, y: 1 })).toBe(true);
      settle(ctx);
      expect(buried(g)).toHaveLength(9);
      expect(standing(g)).toHaveLength(0);
      // Gone from the world, not only hidden: no body and no edge walls remain.
      expect(g.obstaclePolygons).toHaveLength(0);
      expect(g.walls.some(w => w.id.startsWith("obstacle-brick-"))).toBe(false);
      expect(buried(g).every(d => !canStillStrike(g, d))).toBe(true);
      // Map 2's win is the bricks, so the map is lost there and then.
      expect(g.failure?.kind).toBe("objectiveBuried");
    } finally {
      releaseClock();
    }
  });

  it("stay standing while a ball is still on their side", () => {
    try {
      const { ctx, g } = held(MAP2, "kept", [{ x: 150, y: 450 }, { x: 750, y: 450 }]);
      expect(tryCut(ctx, { x: 300, y: 450 }, { x: 0, y: 1 })).toBe(true);
      settle(ctx);
      expect(buried(g)).toHaveLength(0);
      expect(standing(g)).toHaveLength(9);
      expect(g.failure ?? null).toBeNull();
    } finally {
      releaseClock();
    }
  });
});

describe("the ground a broken brick stood on", () => {
  it("belongs to the room at once: a ball crosses it without being thrown back", () => {
    try {
      // A ball boxed in with the block; let loose, it breaks bricks and rolls
      // over where they stood. Before the fix the sample regions still had the
      // block's hole in them, and the ball was "recovered" out of it.
      const lockWin = { ...MAP2, id: "cross", timeLimit: 120, win: { require: [{ kind: "locks", count: 1 }] } } as LevelConfig;
      installClock();
      setRunSeedText("brick-held");
      const ctx = createBotGame(lockWin, 2, plainModifiers({ lockThresholdBonus: 20, spawnFreezeSeconds: 9999 }), { lives: 9 });
      const g = ctx.game;
      const [inside, outside] = g.balls;
      inside.position = { x: 450, y: 370 };
      outside.position = { x: 150, y: 150 };
      for (const cut of [
        { o: { x: 300, y: 450 }, d: { x: 0, y: 1 } }, { o: { x: 600, y: 450 }, d: { x: 0, y: 1 } },
        { o: { x: 450, y: 330 }, d: { x: 1, y: 0 } }, { o: { x: 450, y: 570 }, d: { x: 1, y: 0 } },
      ]) {
        expect(tryCut(ctx, cut.o, cut.d)).toBe(true);
        settle(ctx);
      }
      inside.frozenUntil = 0;
      inside.velocity = { x: 120, y: 160 };
      inside.speed = 200;
      const warnings: string[] = [];
      const warn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };
      try {
        for (let f = 0; f < 120 * 60 && g.lockedBallsCount === 0; f++) {
          stepBot(ctx);
        }
      } finally {
        console.warn = warn;
      }
      expect(warnings.filter(w => w.includes("escaped, recovered"))).toHaveLength(0);
      expect(g.lockedBallsCount).toBe(1);
    } finally {
      releaseClock();
    }
  });
});
