/**
 * A delivery the board can no longer make is lost, not pending for ever.
 *
 * Found on level 38. Its win wants two balls delivered, and two of its four
 * balls start asleep at circuit terminals. A run could end with every awake
 * ball locked or delivered and a sleeper whose terminal's ground had been
 * captured: it could never wake, so nothing on the board could deliver again,
 * and yet the map neither won nor failed. It sat on an empty board until the
 * clock ran out (and with nothing in play the clock barely moved).
 *
 * Two things read "unknown" where they meant "no". A delivery box's reserved
 * interior is pending ground until the box is full, so a reach test over it
 * answered "cannot tell, keep playing" whoever was left. And a sleeper counted
 * as a ball in play whether or not its terminal could still be lit.
 */
import { describe, it, expect } from "vitest";
import { createBotGame, installClock, releaseClock, plainModifiers } from "@/lib/bot/headlessGame";
import { setRunSeedText } from "@/lib/runRng";
import { clauseStillPossible } from "@/lib/physics/requirementReach";
import { readWinSnapshot } from "@/lib/physics/applyCut";
import { CellState, worldToGridIndex } from "@/lib/spaceGrid";
import type { LevelConfig } from "@/types/level";
import type { WinCondition } from "@/types/winSpec";

const LEVEL = {
  id: "delivery-test", level: 22, sizeThreshold: 5, expectedCuts: 8, points: 5,
  variety: 0, randomShapes: 0, maxBalls: 1, ballTypeIds: ["red"], neverRotates: true,
  pickupChance: 0, bugChance: 0,
  win: { require: [{ kind: "space", threshold: 5 }, { kind: "delivered", count: 1 }] },
  circuit: { radius: 30, terminals: [{ x: 150, y: 300, ball: { x: 700, y: 300, typeId: "blue" } }] },
  entities: [
    { id: "bin", kind: "box", shape: "rect", x: 340, y: 640, width: 220, height: 200, mouth: "up", capacity: 1, reserves: true },
  ],
} as unknown as LevelConfig;

const DELIVERED: WinCondition = { kind: "delivered", count: 1 };

function deal() {
  setRunSeedText("delivery-1");
  installClock();
  return createBotGame(LEVEL, LEVEL.level, plainModifiers(), { mutator: null });
}

describe("a delivery the board can no longer make", () => {
  it("is still possible while a ball is in play", () => {
    try {
      const { game } = deal();
      expect(clauseStillPossible(game, DELIVERED, readWinSnapshot(game, LEVEL))).toBe(true);
    } finally { releaseClock(); }
  });

  it("is lost once every ball is locked and the only sleeper can never wake", () => {
    try {
      const { game } = deal();
      for (const b of game.balls) if (b.state !== "dormant") b.state = "won";
      // Claim the terminal's ground: no fence can light it now.
      const g = game.spaceGrid!;
      for (let dy = -45; dy <= 45; dy += 15) for (let dx = -45; dx <= 45; dx += 15) {
        const i = worldToGridIndex(g, 150 + dx, 300 + dy);
        if (i >= 0 && g.cells[i] === CellState.ACTIVE) { g.cells[i] = CellState.REMOVED; g.activeCount--; }
      }
      expect(game.balls.some(b => b.state === "dormant"), "the sleeper is still there").toBe(true);
      expect(clauseStillPossible(game, DELIVERED, readWinSnapshot(game, LEVEL))).toBe(false);
    } finally { releaseClock(); }
  });

  it("is still possible while the sleeper's terminal can be lit", () => {
    try {
      const { game } = deal();
      for (const b of game.balls) if (b.state !== "dormant") b.state = "won";
      expect(clauseStillPossible(game, DELIVERED, readWinSnapshot(game, LEVEL))).toBe(true);
    } finally { releaseClock(); }
  });
});
