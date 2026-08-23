/**
 * Two balls that change the decision rather than the workload.
 *
 * The design constraint they were built against: a splitter is tedious because
 * it adds WORK without adding a DECISION. Every ball it makes is one more thing
 * to seal and the seal is the same problem again, so it scales a map's length
 * rather than its difficulty and cannot be outplayed, only ground through.
 *
 * Neither of these adds a ball or repeats a task. Freight changes what SHAPE of
 * pocket you need; Lodestone changes WHERE everything tends to be.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { attractStep, applyLodestones, isLodestone, DEFAULT_ATTRACT_RADIUS } from "@/lib/physics/lodestone";
import { getAllBallTypes } from "@/lib/ballTypes";
import type { Ball } from "@/types/game";

const ball = (over: Partial<Ball> = {}): Ball => ({
  id: "b", ability: "none", state: "active",
  position: { x: 0, y: 0 }, velocity: { x: 100, y: 0 },
  ...over,
} as unknown as Ball);

const lodestone = (over: Partial<Ball> = {}) =>
  ball({ id: "L", ability: "attract", attractTurnRate: 1.6, attractRadius: 320, ...over });

const speed = (b: Ball) => Math.hypot(b.velocity.x, b.velocity.y);

describe("the lodestone pulls", () => {
  it("bends a passing ball toward itself", () => {
    // Target at the origin heading +x; lodestone directly above it.
    const t = ball({ position: { x: 0, y: 0 }, velocity: { x: 100, y: 0 } });
    const L = lodestone({ position: { x: 0, y: -100 } });
    const out = attractStep(t, L, 1 / 60)!;
    expect(out, "should have pulled").toBeTruthy();
    expect(out.y, "bent toward the lodestone, which is above").toBeLessThan(0);
  });

  /**
   * The trap every heading effect here has had to be shaped around: updateBall
   * rewrites velocity to absolute magnitudes from three places, so a pull that
   * added SPEED would be erased inside a frame.
   */
  it("never changes speed", () => {
    const L = lodestone({ position: { x: 0, y: -100 } });
    for (const v of [{ x: 100, y: 0 }, { x: -60, y: 80 }, { x: 0, y: -140 }]) {
      const t = ball({ velocity: { ...v } });
      const before = Math.hypot(v.x, v.y);
      const out = attractStep(t, L, 1 / 60);
      if (out) expect(Math.hypot(out.x, out.y)).toBeCloseTo(before, 6);
    }
  });

  it("has a reach, so it cannot collapse the whole board into one clump", () => {
    const L = lodestone({ position: { x: 0, y: 0 } });
    const far = ball({ position: { x: DEFAULT_ATTRACT_RADIUS + 50, y: 0 } });
    expect(attractStep(far, L, 1 / 60)).toBeNull();
  });

  it("eases off toward the rim rather than snapping free at the line", () => {
    const L = lodestone({ position: { x: 0, y: 0 } });
    const bend = (dist: number) => {
      const t = ball({ position: { x: dist, y: 0 }, velocity: { x: 0, y: 100 } });
      const out = attractStep(t, L, 1 / 60)!;
      return Math.abs(Math.atan2(out.y, out.x) - Math.PI / 2);
    };
    expect(bend(60)).toBeGreaterThan(bend(200));
    expect(bend(200)).toBeGreaterThan(bend(300));
  });

  it("does not pull itself", () => {
    const L = lodestone();
    expect(attractStep(L, L, 1 / 60)).toBeNull();
  });

  it("ignores balls that are no longer in play", () => {
    const L = lodestone({ position: { x: 0, y: -100 } });
    for (const state of ["won", "dormant"] as const) {
      expect(attractStep(ball({ state }), L, 1 / 60)).toBeNull();
    }
  });

  it("survives sitting exactly on top of another ball", () => {
    const L = lodestone({ position: { x: 10, y: 10 } });
    const t = ball({ position: { x: 10, y: 10 } });
    const out = attractStep(t, L, 1 / 60);
    if (out) for (const n of [out.x, out.y]) expect(Number.isFinite(n)).toBe(true);
  });
});

describe("applying it across the board", () => {
  it("leaves a frozen ball where it was put", () => {
    // Same exemption gravity and the wells make: a held ball must not be
    // dragged out of the pocket it was frozen in.
    const L = lodestone({ position: { x: 0, y: -100 } });
    const held = ball({ id: "held", velocity: { x: 100, y: 0 } });
    applyLodestones([L, held], 1 / 60, "held");
    expect(held.velocity).toEqual({ x: 100, y: 0 });
  });

  it("does nothing at all when no lodestone is on the board", () => {
    const a = ball({ id: "a" }), b = ball({ id: "b", position: { x: 40, y: 0 } });
    applyLodestones([a, b], 1 / 60, null);
    expect(a.velocity).toEqual({ x: 100, y: 0 });
    expect(b.velocity).toEqual({ x: 100, y: 0 });
  });

  it("pulls every other ball, not just the first", () => {
    const L = lodestone({ position: { x: 0, y: -100 } });
    const a = ball({ id: "a", position: { x: -40, y: 0 }, velocity: { x: 100, y: 0 } });
    const b = ball({ id: "b", position: { x: 40, y: 0 }, velocity: { x: 100, y: 0 } });
    applyLodestones([L, a, b], 1 / 60, null);
    expect(a.velocity.y).toBeLessThan(0);
    expect(b.velocity.y).toBeLessThan(0);
  });

  it("keeps every speed intact across a long run", () => {
    const L = lodestone({ position: { x: 0, y: 0 } });
    const t = ball({ id: "t", position: { x: 120, y: 0 }, velocity: { x: 0, y: 90 } });
    for (let i = 0; i < 600; i++) applyLodestones([L, t], 1 / 60, null);
    expect(speed(t)).toBeCloseTo(90, 4);
  });

  it("recognises a lodestone only while it is in play", () => {
    expect(isLodestone(lodestone())).toBe(true);
    expect(isLodestone(lodestone({ state: "won" }))).toBe(false);
    expect(isLodestone(ball())).toBe(false);
  });
});

/**
 * Freight inverts the lock gate. Every other ball wants the tightest chamber it
 * can get; this one needs room, so the pocket can be too SMALL.
 */
describe("the freight needs room", () => {
  const CUT = readFileSync(
    resolve(__dirname, "../lib/physics/checkBallWonState.ts"), "utf8",
  );

  it("refuses a pocket below its fraction of the threshold", () => {
    expect(CUT).toMatch(/percentage >= threshold \* ball\.minLockFraction/);
  });

  it("closes the sliver floor too, which is exactly what it must not use", () => {
    // The sliver rule locks any ball in a small enough absolute cell count.
    // Leaving it open would hand the freight the tight pocket by the back door.
    const block = CUT.slice(CUT.indexOf("if (ball.minLockFraction"), CUT.indexOf("// Boss + Colored Area"));
    expect(block).toMatch(/lockedByPercent = false/);
    expect(block).toMatch(/lockedBySliver = false/);
  });

  it("leaves every other ball's gate untouched", () => {
    expect(CUT).toMatch(/ball\.minLockFraction !== undefined && ball\.minLockFraction > 0/);
  });
});

describe("both ship in the catalogue", () => {
  const byId = (id: string) => getAllBallTypes().find(b => b.id === id);

  it("carries the freight, and it needs over half the threshold", () => {
    const t = byId("freight");
    expect(t, "freight missing from balls.yml").toBeTruthy();
    expect(t!.ability).toBe("heavyLock");
    // Superior is 40% of the threshold, so anything at or above that bar makes
    // a superior freight lock impossible, which is the intended inversion.
    expect(t!.minLockFraction!).toBeGreaterThan(0.4);
    expect(t!.minLockFraction!).toBeLessThan(1);
  });

  it("pays more, since it can never grade superior", () => {
    const freight = byId("freight")!;
    const plain = byId("red")!;
    expect(freight.lockMultiplier).toBeGreaterThan(plain.lockMultiplier);
  });

  it("carries the lodestone, with a reach short of the board", () => {
    const t = byId("lodestone");
    expect(t, "lodestone missing from balls.yml").toBeTruthy();
    expect(t!.ability).toBe("attract");
    expect(t!.attractRadius!).toBeLessThan(900);
  });

  it("debuts them in the gap the schedule left", () => {
    // Ball unlocks ran 1,2,4,7,10,11,12,13 and then nothing until black at 25.
    for (const id of ["freight", "lodestone"]) {
      const lv = byId(id)!.unlockLevel;
      expect(lv, `${id} debut`).toBeGreaterThan(13);
      expect(lv, `${id} debut`).toBeLessThan(25);
    }
  });
});
