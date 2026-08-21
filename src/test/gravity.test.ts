/**
 * Shifting gravity (issue #77), and the one property the whole feature rests on.
 *
 * The request was "balls sometimes just fall down. They must bounce!" The second
 * half is the hard half. This game keeps ball speed CONSTANT from three places
 * in updateBall (the universal minimum-speed floor, grey's wind-down, yellow's
 * variable speed), each rescaling velocity to an absolute magnitude every frame,
 * so a gravity that accumulated into velocity would be erased the same frame.
 *
 * Gravity is therefore a steering force: the heading bends, the magnitude never
 * moves. That makes "must bounce" structural rather than a tuning problem, since
 * a ball at constant speed cannot come to rest at any angle. The magnitude tests
 * below are not pedantry: they are the contract that keeps this compatible with
 * every rescaler, and the reason a ball can never settle.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_GRAVITY, normaliseGravity, gravityPhaseIndex, gravityDirectionAt,
  gravityVectorAt, secondsToNextShift, steerToward, gravityStep,
} from "@/lib/physics/gravity";
import type { GravityConfig, RawGravityConfig } from "@/lib/physics/gravity";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

const CFG: GravityConfig = { turnRate: 1.2, period: 8, sequence: ["down", "none", "left", "none"] };
const len = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);

describe("the phase schedule", () => {
  it("starts on the first phase", () => {
    expect(gravityPhaseIndex(0, CFG)).toBe(0);
    expect(gravityDirectionAt(0, CFG)).toBe("down");
  });

  it("holds a phase for its whole period", () => {
    expect(gravityDirectionAt(0, CFG)).toBe("down");
    expect(gravityDirectionAt(7.99, CFG)).toBe("down");
    expect(gravityDirectionAt(8, CFG)).toBe("none");
  });

  it("cycles back round", () => {
    const period = CFG.period * CFG.sequence.length;
    expect(gravityDirectionAt(period, CFG)).toBe(gravityDirectionAt(0, CFG));
    expect(gravityDirectionAt(period + 9, CFG)).toBe(gravityDirectionAt(9, CFG));
  });

  /**
   * Keyed off ACTIVE play seconds, so it is a pure function of that clock: a
   * paused game cannot drift, and every player on a seeded Daily shifts at the
   * same moments. Same rule the map beats follow.
   */
  it("is a pure function of the active-play clock", () => {
    for (const t of [0, 3.5, 8, 19.2, 100]) {
      expect(gravityDirectionAt(t, CFG)).toBe(gravityDirectionAt(t, CFG));
    }
  });

  it("survives a nonsense clock rather than throwing", () => {
    for (const t of [-5, NaN, Infinity]) {
      expect(() => gravityDirectionAt(t, CFG)).not.toThrow();
    }
    expect(gravityDirectionAt(-5, CFG)).toBe("down");
  });

  it("counts down to the next shift, for the indicator", () => {
    expect(secondsToNextShift(0, CFG)).toBeCloseTo(8, 6);
    expect(secondsToNextShift(3, CFG)).toBeCloseTo(5, 6);
    expect(secondsToNextShift(7.5, CFG)).toBeCloseTo(0.5, 6);
  });

  it("has gravity-free stretches, which is what makes it read as SHIFTING", () => {
    expect(CFG.sequence).toContain("none");
    expect(gravityVectorAt(8, CFG)).toBeNull();
    expect(gravityVectorAt(0, CFG)).not.toBeNull();
  });
});

describe("the pull vectors", () => {
  it("points down the SCREEN for down, since y grows downward", () => {
    expect(gravityVectorAt(0, { ...CFG, sequence: ["down"] })).toEqual({ x: 0, y: 1 });
    expect(gravityVectorAt(0, { ...CFG, sequence: ["up"] })).toEqual({ x: 0, y: -1 });
    expect(gravityVectorAt(0, { ...CFG, sequence: ["left"] })).toEqual({ x: -1, y: 0 });
    expect(gravityVectorAt(0, { ...CFG, sequence: ["right"] })).toEqual({ x: 1, y: 0 });
  });

  it("hands out copies, so a caller cannot mutate the table", () => {
    const a = gravityVectorAt(0, { ...CFG, sequence: ["down"] })!;
    a.y = 99;
    expect(gravityVectorAt(0, { ...CFG, sequence: ["down"] })).toEqual({ x: 0, y: 1 });
  });
});

// ── The contract ────────────────────────────────────────────────────────────

describe("steering never changes speed", () => {
  const pull = { x: 0, y: 1 };

  /** THE property. Everything else in the feature depends on this holding. */
  it("preserves magnitude exactly, from any heading", () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const v = { x: Math.cos(a) * 250, y: Math.sin(a) * 250 };
      const out = steerToward(v, pull, 1.2, 1 / 60);
      expect(len(out), `heading ${a.toFixed(2)}`).toBeCloseTo(250, 6);
    }
  });

  it("preserves magnitude over a long run of steps", () => {
    let v = { x: 180, y: -40 };
    for (let i = 0; i < 2000; i++) v = steerToward(v, pull, 1.2, 1 / 60);
    expect(len(v)).toBeCloseTo(Math.hypot(180, -40), 4);
  });

  /**
   * The user's hard requirement, stated as a test. A ball at constant speed
   * cannot come to rest, so "they must bounce" holds by construction rather
   * than by tuning a restitution value.
   */
  it("can never bring a ball to rest", () => {
    let v = { x: 200, y: 0 };
    for (let i = 0; i < 5000; i++) {
      v = steerToward(v, pull, 5, 1 / 60);
      expect(len(v)).toBeGreaterThan(1);
    }
  });
});

describe("steering bends the heading", () => {
  const pull = { x: 0, y: 1 };
  const angle = (v: { x: number; y: number }) => Math.atan2(v.y, v.x);

  it("turns toward the pull", () => {
    const v = { x: 200, y: 0 };            // heading right, pull is down
    const out = steerToward(v, pull, 1.2, 1 / 60);
    expect(angle(out)).toBeGreaterThan(angle(v));
    expect(angle(out)).toBeLessThan(Math.PI / 2);
  });

  it("converges on the pull and then stays there", () => {
    let v = { x: 200, y: 0 };
    for (let i = 0; i < 200; i++) v = steerToward(v, pull, 1.2, 1 / 60);
    expect(angle(v)).toBeCloseTo(Math.PI / 2, 3);
    const settled = steerToward(v, pull, 1.2, 1 / 60);
    expect(angle(settled)).toBeCloseTo(Math.PI / 2, 3);
  });

  it("never overshoots when the remaining angle is smaller than one step", () => {
    const v = { x: 0, y: 200 };            // already pointing down
    const out = steerToward(v, pull, 50, 1); // an absurdly large step
    expect(angle(out)).toBeCloseTo(Math.PI / 2, 6);
  });

  it("takes the short way round", () => {
    // Heading just past straight up: the shorter route to "down" is clockwise.
    const v = { x: -1, y: -200 };
    const out = steerToward(v, pull, 1.2, 1 / 60);
    expect(out.x).toBeLessThan(0); // kept turning the way it was leaning
  });

  it("leaves a still ball, a dead pull and a zero step alone", () => {
    expect(steerToward({ x: 0, y: 0 }, pull, 1.2, 1 / 60)).toEqual({ x: 0, y: 0 });
    expect(steerToward({ x: 5, y: 5 }, { x: 0, y: 0 }, 1.2, 1 / 60)).toEqual({ x: 5, y: 5 });
    expect(steerToward({ x: 5, y: 5 }, pull, 0, 1 / 60)).toEqual({ x: 5, y: 5 });
    expect(steerToward({ x: 5, y: 5 }, pull, 1.2, 0)).toEqual({ x: 5, y: 5 });
  });
});

describe("the per-frame step", () => {
  it("returns null in a gravity-free phase, so the caller can skip the write", () => {
    expect(gravityStep({ x: 100, y: 0 }, 8, CFG, 1 / 60)).toBeNull();
  });

  it("steers during a pulling phase", () => {
    const out = gravityStep({ x: 100, y: 0 }, 0, CFG, 1 / 60)!;
    expect(out).not.toBeNull();
    expect(out.y).toBeGreaterThan(0);
    expect(len(out)).toBeCloseTo(100, 6);
  });
});

describe("reading an authored config", () => {
  it("takes a well-formed one", () => {
    const c = normaliseGravity({ turnRate: 2, period: 5, sequence: ["down", "up"] })!;
    expect(c).toEqual({ turnRate: 2, period: 5, sequence: ["down", "up"] });
  });

  it("disables gravity rather than half-applying a broken config", () => {
    expect(normaliseGravity(null)).toBeNull();
    expect(normaliseGravity({ turnRate: 0 })).toBeNull();
    expect(normaliseGravity({ turnRate: -3 })).toBeNull();
    expect(normaliseGravity({ sequence: ["sideways" as never] })).toBeNull();
  });

  it("falls back to the defaults for missing fields", () => {
    const c = normaliseGravity({ sequence: ["down"] })!;
    expect(c.turnRate).toBe(DEFAULT_GRAVITY.turnRate);
    expect(c.period).toBe(DEFAULT_GRAVITY.period);
  });

  it("drops unknown directions but keeps the good ones", () => {
    const c = normaliseGravity({ sequence: ["down", "sideways" as never, "up"] })!;
    expect(c.sequence).toEqual(["down", "up"]);
  });

  it("refuses a period of zero, which would divide by nothing", () => {
    const c = normaliseGravity({ period: 0, sequence: ["down"] })!;
    expect(c.period).toBe(DEFAULT_GRAVITY.period);
  });
});

// ── The catalogue entry ─────────────────────────────────────────────────────

/**
 * The authored mutator, checked against the real file. A gravity map whose
 * config the normaliser rejects would silently play as an ordinary map with a
 * scary name on the card, which is the failure worth catching here.
 */
describe("the Technical Gravity mutator", () => {
  const MUTATORS = (yaml.load(
    readFileSync(resolve(__dirname, "../../public/mapMutators.yml"), "utf8"),
  ) as { mutators: { id: string; behavior: string; name: string; description: string;
        clarify?: string; gravity?: RawGravityConfig }[] }).mutators;
  const entry = MUTATORS.find(m => m.behavior === "gravity")!;

  it("exists and carries a gravity block", () => {
    expect(entry, "no gravity mutator authored").toBeTruthy();
    expect(entry.gravity).toBeTruthy();
  });

  it("survives the normaliser, so the map actually pulls", () => {
    const cfg = normaliseGravity(entry.gravity);
    expect(cfg, `${entry.id}'s gravity block is rejected and would play as vanilla`).not.toBeNull();
    expect(cfg!.turnRate).toBeGreaterThan(0);
    expect(cfg!.period).toBeGreaterThan(0);
  });

  it("shifts, rather than pulling one way forever", () => {
    const cfg = normaliseGravity(entry.gravity)!;
    expect(new Set(cfg.sequence).size).toBeGreaterThan(1);
  });

  it("has gravity-free stretches, so the shift is felt", () => {
    const cfg = normaliseGravity(entry.gravity)!;
    expect(cfg.sequence).toContain("none");
  });

  it("says what it does, with no em-dashes in displayed text", () => {
    expect(entry.name.trim()).toBeTruthy();
    expect(entry.description.trim()).toBeTruthy();
    for (const field of [entry.name, entry.description, entry.clarify ?? ""]) {
      expect(field).not.toContain("\u2014");
    }
  });
});
