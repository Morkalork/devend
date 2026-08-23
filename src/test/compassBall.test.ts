/**
 * The compass ball: a quarter turn on a timer, wearing its own countdown.
 *
 * Every other ball ability is about speed, scoring, breaking, spawning or
 * tapping. This is the only one that touches HEADING, which is what the player
 * is actually reading when they decide where to cut.
 *
 * Two properties carry the design and both are easy to lose:
 *
 *   The turn must not change SPEED. Every rescaler in updateBall would fight it,
 *   the same trap gravity and the slow area each had to be shaped around.
 *
 *   The countdown must run on the SAME clock as the turn. A ring that unwinds
 *   on its own schedule is worse than no ring: it actively lies about when to
 *   act, and the player only finds out by being caught.
 */
import { describe, it, expect } from "vitest";
import {
  armTurnTimer, tickTurnTimer, turnProgress, turnDirection, DEFAULT_TURN_INTERVAL,
} from "@/lib/physics/turnTimer";
import { getAllBallTypes } from "@/lib/ballTypes";
import type { Ball } from "@/types/game";

const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };
const always = (n: number) => () => n;

function compass(over: Partial<Ball> = {}): Ball {
  return {
    id: "c1", ability: "turnTimer",
    velocity: { x: 100, y: 0 },
    ...over,
  } as unknown as Ball;
}

describe("arming", () => {
  it("schedules the first turn one interval out", () => {
    const b = compass();
    armTurnTimer(b, 4, 9, always(0.2));
    expect(b.nextTurnAt).toBe(13);
    expect(b.turnIntervalSeconds).toBe(9);
  });

  it("picks a direction up front, so the ring has something to show", () => {
    const cw = compass(); armTurnTimer(cw, 0, 9, always(0.1));
    const ccw = compass(); armTurnTimer(ccw, 0, 9, always(0.9));
    expect(turnDirection(cw)).toBe(1);
    expect(turnDirection(ccw)).toBe(-1);
  });

  it("falls back to the default for a nonsense interval", () => {
    const b = compass();
    armTurnTimer(b, 0, 0, always(0.5));
    expect(b.turnIntervalSeconds).toBe(DEFAULT_TURN_INTERVAL);
  });
});

describe("the turn", () => {
  it("does nothing before the timer comes up", () => {
    const b = compass(); armTurnTimer(b, 0, 9, always(0.1));
    expect(tickTurnTimer(b, 8.9, always(0.1))).toBe(false);
    expect(b.velocity).toEqual({ x: 100, y: 0 });
  });

  it("turns exactly a quarter circle", () => {
    const b = compass(); armTurnTimer(b, 0, 9, always(0.1));   // clockwise
    expect(tickTurnTimer(b, 9, always(0.1))).toBe(true);
    expect(b.velocity.x).toBeCloseTo(0, 6);
    expect(b.velocity.y).toBeCloseTo(100, 6);
  });

  it("turns the other way when the ring says so", () => {
    const b = compass(); armTurnTimer(b, 0, 9, always(0.9));   // counter-clockwise
    tickTurnTimer(b, 9, always(0.9));
    expect(b.velocity.y).toBeCloseTo(-100, 6);
  });

  /**
   * The trap every heading effect in this game has had to be shaped around:
   * updateBall rewrites velocity to absolute magnitudes from three places, so
   * anything that changed speed here would be erased or would fight the floor.
   */
  it("never changes speed", () => {
    const b = compass({ velocity: { x: 60, y: -80 } });   // speed 100
    armTurnTimer(b, 0, 9, always(0.1));
    for (let t = 9; t <= 90; t += 9) {
      tickTurnTimer(b, t, always(0.1));
      expect(Math.hypot(b.velocity.x, b.velocity.y), `at ${t}s`).toBeCloseTo(100, 6);
    }
  });

  it("returns to its original heading after four turns the same way", () => {
    const b = compass();
    armTurnTimer(b, 0, 9, always(0.1));
    for (let t = 9; t <= 36; t += 9) tickTurnTimer(b, t, always(0.1));
    expect(b.velocity.x).toBeCloseTo(100, 4);
    expect(b.velocity.y).toBeCloseTo(0, 4);
  });

  /**
   * Advancing from the SCHEDULED time rather than from arrival. Anchoring on
   * arrival lets every frame of lag push the next turn later, so a stuttering
   * device would slowly drift the ball out of the rhythm the player learned.
   */
  it("keeps its rhythm even when a tick arrives late", () => {
    const b = compass(); armTurnTimer(b, 0, 9, always(0.1));
    tickTurnTimer(b, 9.4, always(0.1));       // 0.4s late
    expect(b.nextTurnAt).toBe(18);            // not 18.4
  });

  /**
   * A long pause (a modal, a lock flash) leaves the schedule far behind.
   * Catching up beats firing a burst of turns to make up the difference, which
   * would spin the ball through several quarters in one frame.
   */
  it("catches up after a long pause instead of spinning", () => {
    const b = compass(); armTurnTimer(b, 0, 9, always(0.1));
    tickTurnTimer(b, 120, always(0.1));
    expect(b.nextTurnAt).toBe(129);
    expect(Math.hypot(b.velocity.x, b.velocity.y)).toBeCloseTo(100, 6);
  });

  it("ignores balls without the ability", () => {
    const plain = compass({ ability: "none" });
    armTurnTimer(plain, 0, 9, always(0.1));
    expect(tickTurnTimer(plain, 999, always(0.1))).toBe(false);
  });
});

describe("the countdown ring", () => {
  it("runs from just-turned to about-to-turn across the cycle", () => {
    const b = compass(); armTurnTimer(b, 0, 9, always(0.1));
    expect(turnProgress(b, 0)).toBeCloseTo(0, 6);
    expect(turnProgress(b, 4.5)).toBeCloseTo(0.5, 6);
    expect(turnProgress(b, 9)).toBeCloseTo(1, 6);
  });

  /** The ring and the turn must agree, or the countdown lies. */
  it("reaches full exactly when the turn fires", () => {
    const b = compass(); armTurnTimer(b, 0, 9, always(0.1));
    expect(tickTurnTimer(b, 8.99, always(0.1))).toBe(false);
    expect(turnProgress(b, 8.99)!).toBeLessThan(1);
    expect(tickTurnTimer(b, 9, always(0.1))).toBe(true);
  });

  it("resets once it has turned", () => {
    const b = compass(); armTurnTimer(b, 0, 9, always(0.1));
    tickTurnTimer(b, 9, always(0.1));
    expect(turnProgress(b, 9)).toBeCloseTo(0, 6);
  });

  it("stays inside its range even if the clock jumps", () => {
    const b = compass(); armTurnTimer(b, 0, 9, always(0.1));
    for (const t of [-50, 0, 4, 9, 500]) {
      const p = turnProgress(b, t)!;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("reports nothing for an ordinary ball", () => {
    expect(turnProgress(compass({ ability: "none" }), 5)).toBeNull();
    expect(turnProgress(compass(), 5), "unarmed").toBeNull();
  });
});

describe("the catalogue entry", () => {
  const compassType = () => getAllBallTypes().find(b => b.id === "compass");

  it("ships, with the ability wired", () => {
    const t = compassType();
    expect(t, "compass missing from balls.yml").toBeTruthy();
    expect(t!.ability).toBe("turnTimer");
    expect(t!.turnIntervalSeconds).toBeGreaterThan(0);
  });

  it("lands in the gap between green and black", () => {
    // Ball unlocks ran 1,2,4,7,10,11,12,13 and then nothing until 25. The
    // schedule wanted a debut in act II's late band; this is it.
    const t = compassType()!;
    expect(t.unlockLevel).toBeGreaterThan(13);
    expect(t.unlockLevel).toBeLessThan(25);
  });

  it("is the only ball that touches heading", () => {
    const turners = getAllBallTypes().filter(b => b.ability === "turnTimer");
    expect(turners).toHaveLength(1);
  });
});
