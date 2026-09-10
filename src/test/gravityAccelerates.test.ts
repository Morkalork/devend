/**
 * Gravity that actually falls.
 *
 * The steering model (see the header of physics/gravity.ts) bends a heading and
 * never touches the magnitude, which keeps every speed rescaler in updateBall
 * working and makes "a ball can never come to rest" structural. It also means a
 * falling ball moves at exactly the speed it climbed at, and level 14 was
 * reported as "clearly doesn't have normal gravity and it feels super weird" -
 * which is what that looks like to anyone who has watched something drop.
 *
 * `accelerate` is the other trade, per map: real acceleration, variable speed,
 * a terminal clamp instead of a preserved magnitude.
 */
import { describe, it, expect } from "vitest";
import {
  normaliseGravity, gravityStep, accelTurnRate, DEFAULT_GRAVITY,
  type GravityConfig,
} from "@/lib/physics/gravity";
import { LADDER } from "@/test/fixtures/maps";
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DOWN = { x: 0, y: 1 };
const accel = (over: Partial<GravityConfig> = {}): GravityConfig => ({
  turnRate: 1.1, period: 9, sequence: ["down"],
  accelerate: true, strength: 200, topSpeedScale: 2.2, ...over,
});
const len = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);

describe("authoring an accelerating pull", () => {
  it("is off unless the map asks for it", () => {
    expect(normaliseGravity({ sequence: ["down"] })!.accelerate).toBe(false);
    expect(normaliseGravity({ sequence: ["down"], accelerate: true })!.accelerate).toBe(true);
  });

  it("takes a strength and a terminal, and falls back on nonsense", () => {
    const c = normaliseGravity({ sequence: ["down"], accelerate: true, strength: 250, topSpeedScale: 3 })!;
    expect(c.strength).toBe(250);
    expect(c.topSpeedScale).toBe(3);
    for (const bad of [0, -5, NaN, undefined]) {
      const d = normaliseGravity({ sequence: ["down"], accelerate: true, strength: bad as number })!;
      expect(d.strength, `strength ${bad}`).toBe(DEFAULT_GRAVITY.strength);
    }
    // A terminal at or below 1x base is not a ceiling, it is a brake that would
    // hold every ball under its own ordinary speed.
    expect(normaliseGravity({ sequence: ["down"], accelerate: true, topSpeedScale: 1 })!.topSpeedScale)
      .toBe(DEFAULT_GRAVITY.topSpeedScale);
  });

  it("no longer needs a turnRate, which the accelerating model never reads", () => {
    // Left required, `turnRate: 0` would silently disable a pull that has
    // nothing to do with turning.
    expect(normaliseGravity({ sequence: ["down"], accelerate: true, turnRate: 0 })).not.toBeNull();
    expect(normaliseGravity({ sequence: ["down"], accelerate: false, turnRate: 0 })).toBeNull();
  });
});

describe("a falling ball speeds up", () => {
  const cfg = accel();

  it("gains exactly strength * dt on the way down", () => {
    const out = gravityStep({ x: 0, y: 100 }, 0, cfg, 0.5, 1, 250)!;
    expect(out.y).toBeCloseTo(100 + 200 * 0.5, 5);
    expect(out.x).toBeCloseTo(0, 6);
  });

  it("sheds it again on the way up, which the steering model cannot do", () => {
    const rising = { x: 0, y: -300 };
    const out = gravityStep(rising, 0, cfg, 0.5, 1, 250)!;
    expect(len(out)).toBeLessThan(len(rising));
    expect(out.y).toBeCloseTo(-200, 5);
  });

  it("passes through zero rather than stopping at it", () => {
    // The apex. Nothing here needs to special-case it; the sum just changes sign.
    const out = gravityStep({ x: 0, y: -50 }, 0, cfg, 0.5, 1, 250)!;
    expect(out.y).toBeGreaterThan(0);
  });

  it("does NOT preserve magnitude, which is the whole difference", () => {
    const v = { x: 120, y: 0 };
    const steered = gravityStep(v, 0, accel({ accelerate: false }), 0.5, 1, 250)!;
    expect(len(steered)).toBeCloseTo(len(v), 4);
    const fallen = gravityStep(v, 0, cfg, 0.5, 1, 250)!;
    expect(len(fallen)).toBeGreaterThan(len(v));
  });
});

describe("terminal velocity", () => {
  it("clamps at topSpeedScale times the ball's OWN base speed", () => {
    const cfg = accel();
    for (const base of [150, 250, 400]) {
      let v = { x: 0, y: base };
      for (let i = 0; i < 2000; i++) v = gravityStep(v, 0, cfg, 1 / 120, 1, base)!;
      expect(len(v), `base ${base}`).toBeCloseTo(base * cfg.topSpeedScale, 3);
    }
  });

  it("keeps steering into the fall at terminal rather than freezing the heading", () => {
    const cfg = accel();
    // Sideways at terminal: the clamp scales the whole vector, so the pull can
    // still turn it downward. Freezing it would leave a ball skimming a wall
    // forever on a map whose whole premise is that things fall.
    let v = { x: 550, y: 0 };
    for (let i = 0; i < 240; i++) v = gravityStep(v, 0, cfg, 1 / 120, 1, 250)!;
    expect(len(v)).toBeCloseTo(550, 3);
    expect(v.y).toBeGreaterThan(0);
  });

  it("leaves a ball uncapped when nobody supplied a base speed", () => {
    // Better than silently clamping to zero, which would stop the ball dead.
    let v = { x: 0, y: 100 };
    for (let i = 0; i < 600; i++) v = gravityStep(v, 0, accel(), 1 / 120, 1, 0)!;
    expect(len(v)).toBeGreaterThan(600);
  });
});

describe("Free Fall still softens the pull", () => {
  it("scales the acceleration, not just a bend", () => {
    const full = gravityStep({ x: 0, y: 0 }, 0, accel(), 1, 1, 250)!;
    const soft = gravityStep({ x: 0, y: 0 }, 0, accel(), 1, 0.5, 250)!;
    expect(soft.y).toBeCloseTo(full.y / 2, 5);
  });
});

describe("accelTurnRate, which the path preview sizes its chords by", () => {
  it("is zero when the pull is straight along the heading", () => {
    expect(accelTurnRate({ x: 0, y: 200 }, DOWN, 200)).toBeCloseTo(0, 9);
    expect(accelTurnRate({ x: 0, y: -200 }, DOWN, 200)).toBeCloseTo(0, 9);
  });

  it("is strength/speed when the pull is square across it", () => {
    expect(accelTurnRate({ x: 200, y: 0 }, DOWN, 200)).toBeCloseTo(1, 6);
    expect(accelTurnRate({ x: 400, y: 0 }, DOWN, 200)).toBeCloseTo(0.5, 6);
  });

  it("is zero for a stopped ball or a dead pull, rather than infinite", () => {
    expect(accelTurnRate({ x: 0, y: 0 }, DOWN, 200)).toBe(0);
    expect(accelTurnRate({ x: 100, y: 0 }, DOWN, 0)).toBe(0);
  });
});

describe("level 14 is the map that asked for this", () => {
  const mutators = (yaml.load(
    readFileSync(resolve(process.cwd(), "public/mapMutators.yml"), "utf8"),
  ) as { mutators: { id: string; gravity?: Record<string, unknown> }[] }).mutators;

  it("pins a mutator that accelerates", () => {
    const level = LADDER.find(l => l.id === "level-14")!;
    expect(level.mutator).toBe("steady_gravity");
    const m = mutators.find(x => x.id === "steady_gravity")!;
    expect(m.gravity!.accelerate).toBe(true);
    expect(normaliseGravity(m.gravity as never)!.accelerate).toBe(true);
  });

  it("has no kick on its floor, which under real gravity is an energy pump", () => {
    // The fall puts speed in and a kick adds more, with nothing taking any out,
    // so balls sat pinned at terminal: measured at 43-57% of samples within 3%
    // of the cap with the kick, and zero without it. A ball pinned at the cap
    // is moving at a constant speed again, which is what this map was changed
    // to stop. The other live edges are deliberately untouched.
    const level = LADDER.find(l => l.id === "level-14")!;
    const edges = level.boardEdges as Record<string, { kick?: number }> | undefined;
    expect(edges?.bottom).toBeUndefined();
    expect(edges?.top?.kick).toBe(0.85);
  });

  it("leaves every other gravity map steering", () => {
    for (const m of mutators) {
      if (m.id === "steady_gravity" || !m.gravity) continue;
      expect(m.gravity.accelerate ?? false, m.id).toBe(false);
    }
  });
});
