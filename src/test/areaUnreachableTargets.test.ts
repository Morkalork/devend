/**
 * When a gate-area map has become genuinely unwinnable.
 *
 * A gate-area map fails the moment no ball can ever reach the zone again. The
 * subtle half is which balls still COUNT as reachable, and it had drifted:
 * the check tested `speed > 0`, which shipped with Colored Areas before dormant
 * balls existed and reads a ball at rest as a ball that is gone.
 *
 * A DORMANT ball is a target that has not entered play yet - a circuit sleeper
 * waiting to be wired, a launcher's roster waiting to be fired. A FROZEN ball
 * (active, speed 0) will thaw. Counting either as gone fails the map while a
 * target is merely waiting; a gate-area circuit map whose sleepers all start
 * dormant lost on its very first frame.
 */
import { describe, it, expect } from "vitest";
import { anyGateTargetInPlay } from "@/lib/coloredAreas";

const ball = (state: string, isBoss = false) => ({ state, isBoss });

describe("which targets still count as able to reach the gate", () => {
  it("an ordinary active ball does", () => {
    expect(anyGateTargetInPlay([ball("active")])).toBe(true);
  });

  it("a DORMANT ball does - it has not entered play yet", () => {
    // THE circuit / launcher case. Before the fix this returned false and the
    // map failed as 'area unreachable' on frame one.
    expect(anyGateTargetInPlay([ball("dormant")])).toBe(true);
  });

  it("a FROZEN ball does - speed 0 now, but it thaws", () => {
    // Frozen balls are `active` with speed 0; the predicate no longer reads
    // speed at all, so this is covered by the active case, pinned explicitly
    // because it was the other victim of the speed test.
    expect(anyGateTargetInPlay([ball("active")])).toBe(true);
  });

  it("a won ball does NOT - it is already locked away", () => {
    expect(anyGateTargetInPlay([ball("won")])).toBe(false);
  });

  it("is false only when every ball is won", () => {
    expect(anyGateTargetInPlay([ball("won"), ball("won")])).toBe(false);
    expect(anyGateTargetInPlay([ball("won"), ball("dormant")])).toBe(true);
  });

  it("says nothing is reachable on an empty board", () => {
    expect(anyGateTargetInPlay([])).toBe(false);
  });
});

describe("on a boss map only the boss is the target", () => {
  it("counts the boss while it is unlocked, dormant or not", () => {
    expect(anyGateTargetInPlay([ball("active", true), ball("active")])).toBe(true);
    expect(anyGateTargetInPlay([ball("dormant", true), ball("active")])).toBe(true);
  });

  it("is unreachable once the boss is won, however many minions remain", () => {
    // The minions cannot satisfy a boss gate, so a live minion must not keep
    // the map from ending as unreachable once the boss itself is gone.
    expect(anyGateTargetInPlay([ball("won", true), ball("active")])).toBe(false);
  });
});

/**
 * The fix has to be CALLED from the fail path, not just defined.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
describe("the fail path uses it", () => {
  it("checks anyGateTargetInPlay rather than a bare speed test", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/physics/applyCut.ts"), "utf8");
    expect(src, "the areaUnreachable check no longer calls the helper")
      .toContain("anyGateTargetInPlay(game.balls)");
    // And the old speed test is gone from that check, or the bug is only
    // half-removed.
    expect(src).not.toMatch(/b\.state !== "won" && b\.speed > 0/);
  });
});
