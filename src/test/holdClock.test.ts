/**
 * A held frame is worth its own elapsed time, and the loop may not say
 * otherwise.
 *
 * Reported three times as "level 13 freezes", and the third time exactly:
 * "it freezes when I FINISH it", with a photo of a normal board carrying a lock
 * flash caught mid-pulse and no completion overlay over it.
 *
 * That is a held frame, drawn over and over. The loop's hold clock moved its
 * own cursor when a hold asked it for an elapsed time, and the loop body ALSO
 * moved that cursor at the top of every frame - so the subtraction was always
 * `timestamp - timestamp`, and every hold frame advanced sim time by exactly
 * nothing. The shatter dissolve then never progressed, so the callback that
 * mounts the completion overlay was never reached: the map ends, the board
 * holds its last frame, and no menu ever arrives.
 *
 * The loop is alive throughout - rendering and rescheduling sixty times a
 * second - which is why a dead-loop watchdog never fired on it, and the
 * headless harness owns the sim clock itself and replaces the loop wholesale,
 * so the only code with the defect in it is the only code the sweep never runs.
 * Hence a unit here, on the piece that can be tested without a browser, plus a
 * shape check that the loop still goes through it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHoldClock, MAX_HOLD_FRAME_MS } from "@/lib/holdClock";
import { anyLockFlashActive, lockFlashEnd } from "@/lib/lockFlash";
import { LOCK_TOTAL_DURATION } from "@/lib/gameConstants";
import type { LockFlashState } from "@/types/game";

describe("the hold clock", () => {
  it("is worth nothing on the very first frame of all", () => {
    // Nothing to measure from: any answer here is invented.
    const hold = createHoldClock();
    hold.beginFrame(1000);
    expect(hold.elapsed()).toBe(0);
  });

  it("is worth the wall time since the previous frame", () => {
    const hold = createHoldClock();
    hold.beginFrame(1000);
    hold.beginFrame(1016);
    expect(hold.elapsed()).toBe(16);
    hold.beginFrame(1033);
    expect(hold.elapsed()).toBe(17);
  });

  it("ADVANCES, frame after frame, which is the whole bug", () => {
    // The defect in one line: the clock reported 0 for every hold frame, for
    // ever, so a dissolve at 0% stayed at 0% and the level never finished.
    const hold = createHoldClock();
    let sim = 0;
    let ts = 1000;
    hold.beginFrame(ts);
    for (let f = 0; f < 60; f++) {
      ts += 16;
      hold.beginFrame(ts);
      sim += hold.elapsed();
    }
    // A second of real frames is about a second of sim time, not zero.
    expect(sim).toBeGreaterThan(900);
    expect(sim).toBeLessThan(1000);
  });

  it("does not move the cursor when a hold merely asks", () => {
    // Asking twice must answer the same thing. The old reader advanced its own
    // cursor as a side effect of being read, which is what let the top-of-frame
    // assignment cancel it out.
    const hold = createHoldClock();
    hold.beginFrame(1000);
    hold.beginFrame(1016);
    expect(hold.elapsed()).toBe(16);
    expect(hold.elapsed()).toBe(16);
    expect(hold.elapsed()).toBe(16);
  });

  it("clamps a stalled frame rather than jumping the animation through it", () => {
    const hold = createHoldClock();
    hold.beginFrame(1000);
    hold.beginFrame(1000 + 5000); // a tab came back from the background
    expect(hold.elapsed()).toBe(MAX_HOLD_FRAME_MS);
  });

  it("never runs backwards, whatever the timestamp does", () => {
    const hold = createHoldClock();
    hold.beginFrame(1000);
    hold.beginFrame(900);
    expect(hold.elapsed()).toBe(0);
  });

  it("keeps the first hold after a spell of play down to one frame", () => {
    // Why the loop opens the frame on ACTIVE frames too. Without it the first
    // held frame after ten seconds of play would be worth ten seconds, and the
    // dissolve would jump straight to its end.
    const hold = createHoldClock();
    let ts = 1000;
    hold.beginFrame(ts);
    for (let f = 0; f < 600; f++) { ts += 16; hold.beginFrame(ts); } // active play
    ts += 16;
    hold.beginFrame(ts); // the first held frame
    expect(hold.elapsed()).toBe(16);
  });
});

describe("the loop goes through it", () => {
  const src = readFileSync(resolve(process.cwd(), "src/hooks/useGameLoop.ts"), "utf8");

  it("opens every frame on the hold clock and never moves a cursor by hand", () => {
    expect(src).toContain("hold.beginFrame(timestamp);");
    // The line that cancelled the clock out. It read as harmless bookkeeping
    // and it stopped sim time dead on every hold frame in the game.
    expect(src, "the loop is moving the hold cursor itself again")
      .not.toContain("lastFrameTs = timestamp;");
  });

  it("advances the sim clock on every hold with what the hold clock says", () => {
    // Three holds: the dissolve, a finished level, the deferred push prompt.
    // All three of them stopped when this was broken, and the third is the one
    // the player sees as a board that will not respond.
    const advances = src.match(/advanceSimClock\(hold\.elapsed\(\)\)/g) ?? [];
    expect(advances.length).toBe(3);
  });
});

describe("a lock flash has an end, and everything asks the same question", () => {
  const flash = (startTime: number) => ({ startTime } as LockFlashState);

  it("is playing inside its animation and not after", () => {
    expect(anyLockFlashActive([flash(1000)], 1000)).toBe(true);
    expect(anyLockFlashActive([flash(1000)], 1000 + LOCK_TOTAL_DURATION - 1)).toBe(true);
    expect(anyLockFlashActive([flash(1000)], 1000 + LOCK_TOTAL_DURATION)).toBe(false);
  });

  it("answers for the LAST flash when several landed together", () => {
    const flashes = [flash(1000), flash(1400)];
    expect(lockFlashEnd(flashes)).toBe(1400 + LOCK_TOTAL_DURATION);
    expect(anyLockFlashActive(flashes, 1000 + LOCK_TOTAL_DURATION + 1)).toBe(true);
  });

  it("says no when there is nothing to play", () => {
    expect(anyLockFlashActive([], 5000)).toBe(false);
    expect(anyLockFlashActive(undefined, 5000)).toBe(false);
    expect(lockFlashEnd([])).toBe(0);
  });

  it("is what the finished-level hold asks, not whether the map ever locked", () => {
    // Nothing removes a flash from `assimilations` - the map clears them all
    // when the next one is built - so `size > 0` is "did a ball lock on this
    // map", which is true for the rest of it. The finished-level hold used
    // that as its reason to keep drawing, and so kept drawing for ever.
    const src = readFileSync(resolve(process.cwd(), "src/hooks/useGameLoop.ts"), "utf8");
    const at = src.indexOf("const shimmerActive");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 1400);
    expect(block, "the finished-level hold is counting flashes again")
      .not.toContain("game.assimilations.size > 0 || shimmerActive");
    expect(block).toContain("anyLockFlashActive(game.assimilations.values()");
  });
});
