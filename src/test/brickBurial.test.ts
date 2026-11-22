/**
 * Fencing bricks off (BRICKS_PLAN.md): any fence may be drawn.
 *
 * A fenced-off area with bricks in it and no ball is claimed, bricks and all.
 * If the map still has enough bricks elsewhere to meet its win, it goes on. If
 * it does not, the map is lost there and then, like any other requirement that
 * can no longer be met. No fence is refused for it.
 *
 * And the last ball stays in play while bricks are owed: it is never locked
 * into a map-ending lock, so what ends such a map is the bricks being out of
 * reach, said as that.
 */
import { describe, it, expect } from "vitest";
import { createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { canStillStrike } from "@/lib/physics/smashReach";
import { setRunSeedText } from "@/lib/runRng";
import { CellState } from "@/lib/spaceGrid";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import { LADDER, byLevel } from "./fixtures/maps";

const MAP2 = byLevel(LADDER, 2) as LevelConfig;

const brick = (id: string, x: number, y: number) =>
  ({ id, kind: "wall", shape: "rect", x, y, width: 60, height: 22, brittle: true });

/** Three bricks on the left of the board and three on the right, `need` of the six to win. */
function spread(need: number): LevelConfig {
  return {
    ...MAP2, id: `spread-${need}`, timeLimit: 300,
    win: { require: [{ kind: "smashed", count: need, of: "shards" }] },
    entities: [
      brick("left-1", 120, 300), brick("left-2", 120, 440), brick("left-3", 120, 580),
      brick("right-1", 720, 300), brick("right-2", 720, 440), brick("right-3", 720, 580),
    ],
  } as unknown as LevelConfig;
}

const standing = (g: CanvasGameState) => (g.destructibles ?? []).filter(d => !d.destroyed);

/** Both balls held still on the left, then one fence down the middle of the board. */
function fenceTheRightHalfOff(level: LevelConfig) {
  installClock();
  setRunSeedText("burial");
  const ctx = createBotGame(level, 2, plainModifiers({ spawnFreezeSeconds: 9999 }), { lives: 3 });
  const g = ctx.game;
  g.balls[0].position = { x: 250, y: 250 };
  g.balls[1].position = { x: 250, y: 650 };
  const drawn = tryCut(ctx, { x: 450, y: 450 }, { x: 0, y: 1 });
  for (let n = 0; g.activeWalls.length > 0 && n < 2000; n++) {
    stepBot(ctx);
  }
  return { ctx, g, drawn };
}

describe("a fence that walls bricks off with no ball beside them", () => {
  it("lands, and the map goes on when enough bricks are left", () => {
    try {
      const { ctx, g, drawn } = fenceTheRightHalfOff(spread(3));
      expect(drawn).toBe(true);
      expect(ctx.events.messages).not.toContain("cutWouldBurySlabs");
      // The fence is on the board and the right half is claimed with its bricks.
      const right = standing(g).filter(d => d.id.startsWith("right-"));
      expect(right).toHaveLength(3);
      expect(right.every(d => !canStillStrike(g, d))).toBe(true);
      // Three are still in reach, and three is what the win asks for.
      expect(standing(g).filter(d => d.id.startsWith("left-")).every(d => canStillStrike(g, d))).toBe(true);
      expect(g.gameOver).toBe(false);
      expect(g.failure ?? null).toBeNull();
      expect(ctx.events.livesLost).toBe(0);
    } finally {
      releaseClock();
    }
  });

  it("lands, and loses the map when the win can no longer be met", () => {
    try {
      const { ctx, g, drawn } = fenceTheRightHalfOff(spread(4));
      expect(drawn).toBe(true);
      expect(ctx.events.messages).not.toContain("cutWouldBurySlabs");
      expect(g.failure?.kind).toBe("objectiveBuried");
    } finally {
      releaseClock();
    }
  });
});

describe("a fence between a ball and the bricks", () => {
  it("means that ball cannot break them, however close it stands", () => {
    installClock();
    setRunSeedText("through-a-fence");
    try {
      // Map 2's block; one ball just left of it, one far right. A fence drawn
      // between the left ball and the block, tight against the block.
      const level = { ...MAP2, id: "tight", timeLimit: 300 } as LevelConfig;
      const ctx = createBotGame(level, 2, plainModifiers({ spawnFreezeSeconds: 9999 }), { lives: 3 });
      const g = ctx.game;
      g.balls[0].position = { x: 250, y: 450 };
      g.balls[1].position = { x: 700, y: 450 };
      expect(tryCut(ctx, { x: 300, y: 250 }, { x: 0, y: 1 })).toBe(true);
      for (let n = 0; g.activeWalls.length > 0 && n < 2000; n++) {
        stepBot(ctx);
      }
      // The right ball is on the bricks' side, so they are all still in reach
      // and the map is alive: the fence itself took nothing away.
      expect(standing(g)).toHaveLength(9);
      expect(standing(g).every(d => canStillStrike(g, d))).toBe(true);
      expect(g.failure ?? null).toBeNull();
      // Asked of the left ball alone, through the fence: no.
      const leftOnly = { spaceGrid: g.spaceGrid, balls: [g.balls[0]], walls: g.walls };
      const cells = g.spaceGrid!.cells;
      const saved = Uint8Array.from(cells);
      // Close everything right of the fence, as if no ball were there.
      for (let i = 0; i < cells.length; i++) {
        const col = i % g.spaceGrid!.width;
        const x = g.spaceGrid!.originX + (col + 0.5) * g.spaceGrid!.cellSize;
        if (x > 300) {
          cells[i] = CellState.REMOVED;
        }
      }
      expect(standing(g).some(d => canStillStrike(leftOnly, d))).toBe(false);
      cells.set(saved);
    } finally {
      releaseClock();
    }
  });
});

describe("the last ball", () => {
  it("is not locked while the win still owes bricks", () => {
    installClock();
    setRunSeedText("last-ball");
    try {
      // Map 2, the lock size widened so a third of the board is a lock.
      const level = { ...MAP2, id: "last-ball", timeLimit: 300 } as LevelConfig;
      const ctx = createBotGame(level, 2, plainModifiers({ lockThresholdBonus: 60, spawnFreezeSeconds: 9999 }), { lives: 3 });
      const g = ctx.game;
      const [first, last] = g.balls;
      first.position = { x: 150, y: 450 };
      last.position = { x: 760, y: 450 };
      // The left third, one ball, no brick: it locks. Another ball is still free.
      expect(tryCut(ctx, { x: 280, y: 450 }, { x: 0, y: 1 })).toBe(true);
      for (let n = 0; g.activeWalls.length > 0 && n < 2000; n++) {
        stepBot(ctx);
      }
      expect(first.state).toBe("won");
      expect(last.state).toBe("active");
      // The right third, the last ball, no brick: its pocket is lock-sized,
      // and locking it would leave nine bricks and nothing to break them.
      expect(tryCut(ctx, { x: 640, y: 450 }, { x: 0, y: 1 })).toBe(true);
      for (let n = 0; g.activeWalls.length > 0 && n < 2000; n++) {
        stepBot(ctx);
      }
      expect(last.state).toBe("active");
      expect(g.lockedBallsCount).toBe(1);
      // The fence did wall the bricks off, so the map is lost: for the bricks,
      // not for a lock.
      expect(g.failure?.kind).toBe("objectiveBuried");
    } finally {
      releaseClock();
    }
  });
});
