/**
 * A cancelled timer must not be able to freeze a ball forever.
 *
 * Reported from a real session: "balls can sometimes stop mid-air". Not
 * against a wall - in open space, which rules out every collision path.
 *
 * When a growing fence is broken by a ball, that ball is frozen in place for
 * the shake: `frozenBallId` is set and its velocity zeroed. Both the game loop
 * and updateBall then skip it entirely. The release runs from a setTimeout
 * stored in the SHARED shake-timer ref - and applyCut, handleGameOver and the
 * canvas cleanup all clear that ref and install callbacks of their own that
 * know nothing about freezing. Any of them landing inside the 400ms window
 * cancels the release, and the ball is never stepped again for the rest of the
 * map.
 *
 * That is a state the physics cannot recover from on its own: the speed floor
 * that restarts a stopped ball is itself skipped for the frozen one, so
 * nothing downstream can help.
 *
 * The deadline therefore lives on the game state and the loop enforces it.
 * These tests pin the two halves that matter: the timer still wins in the
 * normal case, and a cancelled timer cannot strand a ball.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FREEZE_MAX_MS } from "@/lib/physics/updateFenceWall";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the post-break freeze always lets go", () => {
  it("gives the normal timer room to win", () => {
    // The shake timer releases at 400ms. If the deadline were at or under that
    // the net would fire on every ordinary break, restoring the ball a beat
    // early and making the shake look broken.
    const src = read("src/lib/physics/updateFenceWall.ts");
    const shake = [...src.matchAll(/unfreezeAfterShake\(\);\s*\},\s*(\d+)\)/g)]
      .map(m => Number(m[1]));
    expect(shake.length, "no timed unfreeze found at all").toBeGreaterThan(0);
    for (const ms of shake) {
      expect(FREEZE_MAX_MS, `unfreeze at ${ms}ms`).toBeGreaterThan(ms);
    }
  });

  it("records a deadline whenever it freezes a ball", () => {
    // A freeze with no deadline is exactly the stranding case: the loop has
    // nothing to enforce and the timer is the only way out.
    const src = read("src/lib/physics/updateFenceWall.ts");
    const freezes = [...src.matchAll(/game\.frozenBallId\s*=\s*ball\.id;/g)].length;
    const deadlines = [...src.matchAll(/game\.frozenBallReleaseAt\s*=\s*performance\.now\(\)/g)].length;
    expect(freezes, "no freeze site found").toBeGreaterThan(0);
    expect(deadlines, "a freeze was set without a deadline").toBe(freezes);
  });

  it("clears the deadline everywhere it clears the freeze", () => {
    // A stale deadline on a cleared freeze is harmless today, but it is the
    // kind of half-updated state that makes the next reader wrong.
    for (const file of [
      "src/lib/physics/updateFenceWall.ts",
      "src/hooks/useGameLoop.ts",
    ]) {
      const src = read(file);
      const cleared = [...src.matchAll(/game\.frozenBallId\s*=\s*null;/g)].length;
      const deadline = [...src.matchAll(/game\.frozenBallReleaseAt\s*=\s*null;/g)].length;
      expect(deadline, `${file}: ${cleared} clears, ${deadline} deadline clears`).toBe(cleared);
    }
  });

  it("enforces the deadline in the loop, not only in the timer", () => {
    // The whole point. If the release existed only inside the setTimeout, a
    // cancelled timer would still strand the ball.
    const loop = read("src/hooks/useGameLoop.ts");
    expect(loop).toContain("game.frozenBallReleaseAt");
    expect(loop, "the loop never compares the deadline to the clock")
      .toMatch(/performance\.now\(\)\s*>\s*game\.frozenBallReleaseAt/);
    // And it must actually release, not merely notice.
    const idx = loop.indexOf("game.frozenBallReleaseAt !== null");
    expect(idx).toBeGreaterThan(-1);
    const block = loop.slice(idx, idx + 1400);
    expect(block, "notices the stranding without clearing it")
      .toContain("game.frozenBallId = null;");
  });

  it("hands the ball back the velocity it was carrying", () => {
    // Restarting it from the speed floor in an arbitrary direction is a
    // second, quieter way for the break to rob the player: they lose the read
    // they had on that ball as well as the fence.
    const loop = read("src/hooks/useGameLoop.ts");
    const idx = loop.indexOf("game.frozenBallReleaseAt !== null");
    const block = loop.slice(idx, idx + 1400);
    expect(block).toContain("game.frozenBallVelocity");
  });

  it("says so when it fires", () => {
    // This only ever runs because a timer was cancelled by something that did
    // not know a ball was frozen. That is a real fault and should leave a
    // trace, not be silently papered over.
    const loop = read("src/hooks/useGameLoop.ts");
    const idx = loop.indexOf("game.frozenBallReleaseAt !== null");
    expect(loop.slice(idx, idx + 1400)).toContain("console.warn");
  });
});
