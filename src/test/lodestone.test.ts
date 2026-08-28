/**
 * A ball that changes the decision rather than the workload.
 *
 * The design constraint it was built against: a splitter is tedious because it
 * adds WORK without adding a DECISION. Every ball it makes is one more thing to
 * seal and the seal is the same problem again, so it scales a map's length
 * rather than its difficulty and cannot be outplayed, only ground through.
 *
 * The lodestone adds no ball and repeats no task: it changes WHERE everything
 * tends to be.
 *
 * It shipped alongside a Freight ball, whose heavyLock ability inverted the
 * lock gate (it needed a pocket over half the largest lockable size). That ball
 * was removed: fencing it tighter was what stopped it locking, which read as a
 * broken lock rather than a rule, and once a pocket was under the floor there
 * was no way back - pockets only shrink. Its tests went with it.
 */
import { describe, it, expect } from "vitest";
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

describe("it ships in the catalogue", () => {
  const byId = (id: string) => getAllBallTypes().find(b => b.id === id);

  it("carries the lodestone, with a reach short of the board", () => {
    const t = byId("lodestone");
    expect(t, "lodestone missing from balls.yml").toBeTruthy();
    expect(t!.ability).toBe("attract");
    expect(t!.attractRadius!).toBeLessThan(900);
  });

  it("debuts it in the gap the schedule left", () => {
    // Ball unlocks ran 1,2,4,7,10,11,12,13 and then nothing until black at 25.
    const lv = byId("lodestone")!.unlockLevel;
    expect(lv, "lodestone debut").toBeGreaterThan(13);
    expect(lv, "lodestone debut").toBeLessThan(25);
  });
});
