/**
 * The latch: the only object that opens because of something the player did.
 *
 * Phasing objects open on a clock, movers on a clock, everything else is either
 * always solid or broken by force. Nothing on the board has ever responded to
 * PROGRESS, which is why a map has never been able to have two acts: seal three
 * balls and the far half opens.
 *
 * It rides the phasing system rather than inventing its own openness, and that
 * is the whole design: `phase`/`alpha` is already the single source of truth
 * for both tangibility and how an object is drawn, so a latch gets ball
 * collision, fence collision and both renderers for free. A latch that decided
 * for itself whether it was open would have to be taught to all of them again,
 * and the one that got missed would be a wall balls pass through and fences
 * stop at.
 *
 * The two things worth pinning are that it OPENS at the threshold and that it
 * STAYS open - a latch that re-closed would turn what the player earned into a
 * loan, and it is exactly what falls out of reusing a cyclical system if the
 * cycle is not bypassed.
 */
import { describe, it, expect } from "vitest";
import { tickPhasing, collectPhasedOut } from "@/lib/physics/phasing";
import type { CanvasGameState } from "@/types/gameState";
import type { PhasingObjectState } from "@/types/game";
import { createRectPolygon } from "@/lib/polygon";

const latch = (over: Partial<PhasingObjectState> = {}): PhasingObjectState => ({
  id: "gate", polygon: createRectPolygon(100, 100, 200, 140),
  wallIds: ["obstacle-gate-edge-0", "obstacle-gate-edge-1"],
  startedAt: 0, cycleSeconds: 0, phase: "in", alpha: 1,
  latchAfter: 3, latchOn: "locks", ...over,
});

const game = (objs: PhasingObjectState[], locks = 0, smashes = 0): CanvasGameState => ({
  phasingObjects: objs, balls: [], lockedBallsCount: locks, objectivesBroken: smashes,
} as unknown as CanvasGameState);

describe("a latch opens on progress", () => {
  it("stays shut below its threshold", () => {
    const l = latch();
    const g = game([l], 2);
    tickPhasing(g, 5);
    expect(l.phase).toBe("in");
    expect(l.alpha).toBe(1);
  });

  it("opens exactly at the threshold", () => {
    const l = latch();
    tickPhasing(game([l], 3), 5);
    expect(l.phase).toBe("out");
    expect(l.alpha).toBe(0);
  });

  it("counts smashes instead when told to", () => {
    const l = latch({ latchOn: "smashes" });
    tickPhasing(game([l], 9, 0), 5);
    expect(l.phase, "it counted locks despite being set to smashes").toBe("in");
    tickPhasing(game([l], 0, 3), 5);
    expect(l.phase).toBe("out");
  });

  it("stays open once opened, whatever the clock does", () => {
    // The failure that falls straight out of reusing a cyclical system: a latch
    // that blinks shut again turns what the player earned into a loan.
    const l = latch();
    const g = game([l], 3);
    for (const t of [0, 3, 7, 30, 120, 600]) {
      tickPhasing(g, t);
      expect(l.phase, `closed again at t=${t}`).toBe("out");
    }
  });

  it("really is intangible once open, in the set collision reads", () => {
    // The point of riding the phasing system. If this ever diverges, a latch is
    // a wall that LOOKS open, which is worse than one that never opened.
    const l = latch();
    const shut = game([l], 0);
    tickPhasing(shut, 1);
    expect(collectPhasedOut(shut)).toBeNull();

    const open = game([l], 3);
    tickPhasing(open, 1);
    const phased = collectPhasedOut(open)!;
    expect(phased.polys.has(l.polygon)).toBe(true);
    for (const id of l.wallIds) expect(phased.walls.has(id), id).toBe(true);
  });
});

describe("it does not disturb ordinary phasing objects", () => {
  it("leaves a clock-driven object cycling", () => {
    // Three shipped maps blink pillars on a timer; none of them may change.
    const cyclic: PhasingObjectState = {
      id: "blink", polygon: createRectPolygon(400, 400, 60, 60), wallIds: ["obstacle-blink-edge-0"],
      startedAt: 0, cycleSeconds: 10, phase: "in", alpha: 1,
    };
    const g = game([cyclic], 0);
    const seen = new Set<string>();
    for (let t = 0; t < 20; t += 0.5) {
      tickPhasing(g, t);
      seen.add(cyclic.phase);
    }
    expect(seen.has("in") && seen.has("out"), "the timer stopped working").toBe(true);
  });

  it("lets a latch and a cycling object share a map", () => {
    const l = latch();
    const cyclic: PhasingObjectState = {
      id: "blink", polygon: createRectPolygon(400, 400, 60, 60), wallIds: ["obstacle-blink-edge-0"],
      startedAt: 0, cycleSeconds: 10, phase: "in", alpha: 1,
    };
    const g = game([l, cyclic], 3);
    tickPhasing(g, 6);
    expect(l.phase).toBe("out");
    // The cyclic one is wherever its clock says, and crucially the latch did
    // not force it: they are independent.
    tickPhasing(g, 0);
    expect(l.phase, "the latch followed the other object's clock").toBe("out");
  });
});
