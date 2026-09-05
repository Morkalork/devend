/**
 * Breaking a fence costs the same however it is noticed.
 *
 * There were three prices for one event. A ball caught DURING growth docked a
 * life and handed back a recovery window; the SAME ball caught at cut
 * completion (isBallOnCutLine, in applyCut) ended the whole run; a mover took a
 * third, hand-copied path. Which of the first two you got came down to whether
 * the fence finished a frame before the ball arrived or a frame after - not a
 * decision a player makes, and not one they can see, so not one they can be
 * charged twenty minutes of progress for.
 *
 * These are about the PRICE rather than the collision. The collision maths has
 * its own tests; what could never be checked before is that the answers agree,
 * because the answer was written out three times.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAP_FAIL_KINDS } from "@/lib/mapFailure";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("one price for a broken fence", () => {
  it("routes every fence break through the shared handler", () => {
    // The point of the extraction. A path that ends the run by hand is a path
    // that can disagree with the others again.
    for (const file of ["src/lib/physics/updateFenceWall.ts", "src/lib/physics/applyCut.ts"]) {
      const src = read(file);
      const strikes = [...src.matchAll(/(ballStruckFence|moverStruckFence)\(/g)].length;
      expect(strikes, `${file} stopped calling the shared handler`).toBeGreaterThan(0);
    }
  });

  it("leaves applyCut no way to end the run except through the life", () => {
    // applyCut used to reach handleGameOverFn directly for a ball on the cut
    // line, for an exhausted budget and for an unreachable gate. The only
    // remaining call is the one INSIDE failMapCostingALife, which is the last
    // life running out - so every map failure now costs a life first.
    const src = read("src/lib/physics/applyCut.ts");
    const idx = src.indexOf("function failMapCostingALife");
    expect(idx, "the life-docking helper is gone").toBeGreaterThan(-1);
    const outside = src.slice(0, idx) + src.slice(src.indexOf("\n}", idx));
    expect(
      [...outside.matchAll(/handleGameOverFn\(/g)].length,
      "applyCut ends the run behind the life-docking helper's back",
    ).toBe(0);
  });

  it("docks the life in exactly one place", () => {
    // Three hand-copied copies of "getLives() - 1, set it three ways, end the
    // run at zero" is what let the prices drift apart in the first place.
    const strike = read("src/lib/physics/fenceStrike.ts");
    const fence = read("src/lib/physics/updateFenceWall.ts");
    expect([...strike.matchAll(/getLives\(\)\s*-\s*1/g)].length).toBe(1);
    expect(
      [...fence.matchAll(/getLives\(\)\s*-\s*1/g)].length,
      "updateFenceWall docks a life of its own again",
    ).toBe(0);
  });

  it("names the life-lost message from the failure, not from the call site", () => {
    // The mover and ball captions differ, and the caller that knows which is
    // which is the same caller that builds the failure. Keyed off the failure
    // kind through an exhaustive Record, so a third way of breaking a fence is
    // a compile error rather than a break that silently blames a ball.
    const src = read("src/lib/physics/fenceStrike.ts");
    expect(src, "the caption map is gone")
      .toMatch(/Record<"ballHitFence" \| "moverHitFence", GameMessageId>/);
    expect(src, "the caption is chosen at a call site again")
      .toContain("BROKEN_BY[failure.kind");
  });
});

describe("what a fence break is allowed to cost", () => {
  it("keeps the shield and the push on the ball path only", () => {
    // Deliberate, not an oversight: both are sold against BALLS, the things you
    // are steering. A mover was always going to be where it is, so cutting into
    // one is a read you got wrong rather than a collision you were dodging.
    const src = read("src/lib/physics/fenceStrike.ts");
    const mover = src.slice(src.indexOf("export function moverStruckFence"));
    expect(mover, "a mover now spends the wall shield").not.toContain("wallShieldsRemaining");
    expect(mover, "a mover now fails the push instead").not.toContain("pushMode");
  });

  it("still knows every way a map can be lost", () => {
    // The list is derived from the union, so this only fails when a kind is
    // added - which is the moment to decide what IT costs, before it ships
    // with whatever the nearest copy happened to do.
    expect([...MAP_FAIL_KINDS].sort()).toEqual([
      "areaUnreachable", "ballHitFence", "launcherPrematureLock",
      "lockedOut", "moverHitFence", "outOfFences", "timeUp",
    ]);
  });
});
