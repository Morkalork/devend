/**
 * Level 20's chained pair must keep moving around the board, not orbit itself.
 *
 * The rope used to turn a ball's outward motion sideways at full speed (a
 * "swing"). Every time the chain went taut, the pair's travel became spin
 * around each other, and nothing turned it back, so the pair sat spinning in
 * place: measured over 12 deals, its centre was almost still (slower than a
 * quarter of the balls' speed) 29% of the time, against 9% for the same two
 * balls unchained. The rope now bounces only the separating motion and keeps
 * the pair's shared momentum (6% measured).
 */
import { describe, it, expect } from "vitest";
import { createBotGame, stepBot, installClock, releaseClock } from "@/lib/bot/headlessGame";
import { LADDER, byLevel } from "./fixtures/maps";
import { setRunSeedText } from "@/lib/runRng";

const STEP = 1 / 120;
const SECONDS = 30;
const DEALS = 4;

function stillFraction(seedText: string): number {
  installClock();
  setRunSeedText(seedText);
  try {
    const ctx = createBotGame(byLevel(LADDER, 20)!, 20);
    const chain = ctx.game.chains?.[0];
    expect(chain).toBeDefined();
    let still = 0;
    let frames = 0;
    for (let f = 0; f < SECONDS / STEP; f++) {
      if (ctx.game.gameOver || ctx.game.levelComplete) {
        break;
      }
      stepBot(ctx, STEP);
      const a = ctx.game.balls.find(x => x.id === chain!.aId);
      const b = ctx.game.balls.find(x => x.id === chain!.bId);
      if (!a || !b) {
        break;
      }
      const shared = Math.hypot((a.velocity.x + b.velocity.x) / 2, (a.velocity.y + b.velocity.y) / 2);
      const speed = (Math.hypot(a.velocity.x, a.velocity.y) + Math.hypot(b.velocity.x, b.velocity.y)) / 2;
      if (shared < 0.25 * speed) {
        still++;
      }
      frames++;
    }
    return still / Math.max(1, frames);
  } finally {
    releaseClock();
  }
}

describe("level 20 chained pair", () => {
  it("spends little time spinning in place", () => {
    let total = 0;
    for (let i = 0; i < DEALS; i++) {
      total += stillFraction(`chained-pair-${i}`);
    }
    // Unchained balls sit around 0.09; the old swing rope sat near 0.29.
    expect(total / DEALS).toBeLessThan(0.15);
  });
});
