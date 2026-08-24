/**
 * The two balls the path preview could not see.
 *
 * Both were flagged as "cannot be honestly projected" when they were built, and
 * one of those was wrong.
 *
 * The COMPASS turn is not an approximation at all: the time is known, the
 * direction is chosen a whole cycle in advance, and the turn is exactly ninety
 * degrees. turnTimer.ts says why in as many words - the ability is telegraphed
 * so that "you can put a fence where the ball is going to be instead of where
 * it is, and that is a decision worth making". The tool for making that
 * decision is the path preview, and it was the one thing that could not see the
 * turn, drawing a confident straight line through a heading change the ball had
 * already committed to.
 *
 * The LODESTONE genuinely is an approximation, and the same one the preview
 * already makes everywhere else: it treats other balls as static snapshots
 * because their motion is unknowable a second ahead. Curving toward where a
 * lodestone IS beats drawing straight through its pull, which is wrong in a way
 * the player cannot see coming.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
vi.mock("@/lib/gameAudio", () => ({ playWallHitSound: () => {}, playLevelCompleteSound: () => {} }));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
}));

import { computeBallTrajectory, trajectoryTurnsFor, type TrajectoryBall } from "@/lib/gameUtils";
import { updateBall } from "@/lib/physics/updateBall";
import { createBallEffectState } from "@/lib/ballEffects";
import { createRectPolygon } from "@/lib/polygon";
import { PHYSICS_STEP } from "@/lib/gameConstants";
import type { CanvasGameState } from "@/types/gameState";
import { DEFAULT_TURN_INTERVAL } from "@/lib/physics/turnTimer";
import { DEFAULT_ATTRACT_RADIUS } from "@/lib/physics/lodestone";
import type { Ball, Vector2 } from "@/types/game";
import type { Wall } from "@/lib/wallGeometry";

function boardWalls(x0: number, y0: number, x1: number, y1: number): Wall[] {
  const c: [Vector2, Vector2][] = [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }],
  ];
  return c.map((s, i) => ({ id: `board-${i}`, start: s[0], end: s[1], thickness: 0 } as unknown as Wall));
}
const WALLS = boardWalls(45, 45, 855, 855);

/** Heading of the leg leaving waypoint `i`, in radians. */
const legAngle = (p: Vector2[], i: number) =>
  Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x);

const angleDelta = (a: number, b: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// ── The compass ────────────────────────────────────────────────────────────

describe("the compass turn is read off the ball, not guessed", () => {
  const compass = (over: Partial<Ball> = {}): Ball => ({
    ability: "turnTimer", nextTurnAt: 3, turnIntervalSeconds: 9, turnClockwise: true,
    ...over,
  } as unknown as Ball);

  it("reports the schedule the ring is already counting down", () => {
    const t = trajectoryTurnsFor(compass(), 1)!;
    expect(t.firstTurnIn, "two seconds still to run").toBe(2);
    expect(t.intervalSeconds).toBe(9);
    expect(t.direction).toBe(1);
  });

  it("reads the other direction when the ball turns the other way", () => {
    expect(trajectoryTurnsFor(compass({ turnClockwise: false }), 0)!.direction).toBe(-1);
  });

  it("says nothing for a ball that does not turn", () => {
    expect(trajectoryTurnsFor({ ability: "none" } as Ball, 0)).toBeNull();
    // Armed only once the ball enters the map; before that there is no schedule.
    expect(trajectoryTurnsFor(compass({ nextTurnAt: undefined }), 0)).toBeNull();
  });

  it("falls back to the shipped interval when the ball authors none", () => {
    expect(trajectoryTurnsFor(compass({ turnIntervalSeconds: undefined }), 0)!.intervalSeconds)
      .toBe(DEFAULT_TURN_INTERVAL);
  });
});

describe("the preview turns where the ball will", () => {
  const start = { x: 200, y: 450 };
  const vel = { x: 240, y: 0 };
  const turns = { firstTurnIn: 1, intervalSeconds: 9, direction: 1 as const };

  it("bends the path by a right angle at the scheduled moment", () => {
    const p = computeBallTrajectory(
      start, vel, WALLS, 3, 18, [], [], 1, [], undefined, null, undefined, turns);
    expect(p.length, "the turn should add a waypoint of its own").toBeGreaterThan(2);
    const turned = angleDelta(legAngle(p, 0), legAngle(p, 1));
    expect(Math.abs(turned), `turned ${(turned * 180 / Math.PI).toFixed(1)} degrees`)
      .toBeCloseTo(Math.PI / 2, 2);
  });

  it("turns the way the ring says", () => {
    const cw = computeBallTrajectory(
      start, vel, WALLS, 3, 18, [], [], 1, [], undefined, null, undefined, turns);
    const ccw = computeBallTrajectory(
      start, vel, WALLS, 3, 18, [], [], 1, [], undefined, null, undefined,
      { ...turns, direction: -1 });
    expect(Math.sign(angleDelta(legAngle(cw, 0), legAngle(cw, 1))))
      .toBe(-Math.sign(angleDelta(legAngle(ccw, 0), legAngle(ccw, 1))));
  });

  it("puts the turn at the right distance, not merely somewhere", () => {
    const p = computeBallTrajectory(
      start, vel, WALLS, 3, 18, [], [], 1, [], undefined, null, undefined, turns);
    // One second at 240 units/s, so the corner is 240 units along.
    expect(Math.hypot(p[1].x - start.x, p[1].y - start.y)).toBeCloseTo(240, 0);
  });

  it("draws straight when the ball does not turn at all", () => {
    const straight = computeBallTrajectory(start, vel, WALLS, 3, 18);
    const withNull = computeBallTrajectory(
      start, vel, WALLS, 3, 18, [], [], 1, [], undefined, null, undefined, null);
    expect(withNull).toEqual(straight);
  });

  it("keeps turning on the interval, not just once", () => {
    const p = computeBallTrajectory(
      start, vel, WALLS, 6, 18, [], [], 1, [], undefined, null, undefined,
      { firstTurnIn: 0.5, intervalSeconds: 0.5, direction: 1 });
    // Several turns inside one board crossing: the path should box around.
    let corners = 0;
    for (let i = 0; i + 2 < p.length; i++) {
      if (Math.abs(Math.abs(angleDelta(legAngle(p, i), legAngle(p, i + 1))) - Math.PI / 2) < 0.05) {
        corners++;
      }
    }
    expect(corners, "expected repeated quarter turns").toBeGreaterThan(1);
  });
});

// ── The lodestone ──────────────────────────────────────────────────────────

describe("the preview bends toward a lodestone", () => {
  const start = { x: 200, y: 450 };
  const vel = { x: 240, y: 0 };
  /** A lodestone sitting well below the path, pulling it down. */
  const stone = (over: Partial<TrajectoryBall> = {}): TrajectoryBall => ({
    position: { x: 450, y: 620 }, radius: 18,
    attractTurnRate: 2.2, attractRadius: DEFAULT_ATTRACT_RADIUS,
    ...over,
  });

  const curvature = (p: Vector2[]) => {
    let total = 0;
    for (let i = 0; i + 2 < p.length; i++) {
      total += Math.abs(angleDelta(legAngle(p, i), legAngle(p, i + 1)));
    }
    return total;
  };

  it("curves instead of drawing straight past the pull", () => {
    const plain = computeBallTrajectory(start, vel, WALLS, 1, 18);
    const pulled = computeBallTrajectory(start, vel, WALLS, 1, 18, [], [], 1, [stone()]);
    expect(curvature(plain)).toBeLessThan(0.01);
    expect(curvature(pulled), "the lodestone should bend the path").toBeGreaterThan(0.2);
  });

  it("bends toward the lodestone, not away from it", () => {
    const p = computeBallTrajectory(start, vel, WALLS, 1, 18, [], [], 1, [stone()]);
    const mid = p[Math.floor(p.length / 2)];
    expect(mid.y, "the stone is below, so the path should sag toward it")
      .toBeGreaterThan(start.y);
  });

  it("ignores an ordinary ball, which pulls at nothing", () => {
    const plain = computeBallTrajectory(start, vel, WALLS, 1, 18);
    const withBall = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1,
      [{ position: { x: 450, y: 620 }, radius: 18 }]);
    expect(curvature(withBall)).toBeCloseTo(curvature(plain), 5);
  });

  it("has a reach, so a distant lodestone leaves the path alone", () => {
    const far = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1,
      [stone({ position: { x: 450, y: 450 + DEFAULT_ATTRACT_RADIUS + 200 } })]);
    expect(curvature(far)).toBeLessThan(0.01);
  });

  it("eases off toward the rim rather than snapping at the line", () => {
    const near = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1, [stone({ position: { x: 450, y: 560 } })]);
    const rim = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1,
      [stone({ position: { x: 450, y: 450 + DEFAULT_ATTRACT_RADIUS - 20 } })]);
    expect(curvature(near)).toBeGreaterThan(curvature(rim));
  });

  it("adds a second lodestone's pull rather than replacing the first", () => {
    const one = computeBallTrajectory(start, vel, WALLS, 1, 18, [], [], 1, [stone()]);
    const two = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1,
      [stone(), stone({ position: { x: 500, y: 640 } })]);
    expect(curvature(two)).toBeGreaterThan(curvature(one));
  });
});

/**
 * The strongest form of the claim: drive the ACTUAL physics and check the
 * preview drew the same corner. Everything above proves the preview bends;
 * this proves it bends where the ball does.
 */
describe("the previewed turn is where the physics turns", () => {
  const START = { x: 200, y: 450 };
  const VEL = { x: 240, y: 0 };
  const TURN_IN = 1;

  /**
   * Run the real ball until its heading swings by a right angle.
   *
   * Watches the VELOCITY rather than calling tickTurnTimer, because updateBall
   * already ticks it: a harness that ticks it too consumes the turn before the
   * ball can take it, which is how the first version of this managed to run
   * 3000 steps and report that the physics never turns.
   */
  function realTurnPoint(): { at: Vector2; heading: Vector2 } | null {
    const ball = {
      id: "c", position: { ...START }, velocity: { ...VEL }, radius: 18,
      speed: 240, baseSpeed: 240, topSpeed: 400, color: "#fff", regionId: "r",
      rotation: 0, flashIntensity: 0, effects: createBallEffectState(),
      state: "active", wonSpinSpeed: 0, wonTime: 0, assimScale: 1, assimColorFade: 0,
      typeId: "compass", ability: "turnTimer", lockMultiplier: 3, spawnTime: 0,
      minimumSpeed: 80, nextTurnAt: TURN_IN, turnIntervalSeconds: 9, turnClockwise: true,
    } as unknown as Ball;
    const game = {
      boardPolygon: createRectPolygon(45, 45, 810, 810),
      obstaclePolygons: [], walls: [], movers: [], regions: [],
      creepFactor: 1, balls: [ball], slowAreas: [], gravityWells: [],
    } as unknown as CanvasGameState;

    for (let i = 0; i < 3000; i++) {
      const before = { x: ball.position.x, y: ball.position.y };
      const heading = Math.atan2(ball.velocity.y, ball.velocity.x);
      game.activePlaySeconds = (i + 1) * PHYSICS_STEP;
      updateBall(ball, PHYSICS_STEP, game);
      const after = Math.atan2(ball.velocity.y, ball.velocity.x);
      if (Math.abs(Math.abs(angleDelta(heading, after)) - Math.PI / 2) < 0.01) {
        return { at: before, heading: { ...ball.velocity } };
      }
    }
    return null;
  }

  it("the physics really does turn", () => {
    expect(realTurnPoint(), "no turn fired in 3000 steps").not.toBeNull();
  });

  it("draws the corner where the ball actually turns", () => {
    const real = realTurnPoint()!;
    const p = computeBallTrajectory(
      START, VEL, WALLS, 3, 18, [], [], 1, [], undefined, null, undefined,
      { firstTurnIn: TURN_IN, intervalSeconds: 9, direction: 1 });
    // Within one physics step of travel (240 units/s at 1/60s = 4 units).
    expect(Math.hypot(p[1].x - real.at.x, p[1].y - real.at.y),
      `preview corner ${JSON.stringify(p[1])} vs real ${JSON.stringify(real.at)}`)
      .toBeLessThan(6);
  });

  it("leaves the corner on the same heading the ball does", () => {
    const real = realTurnPoint()!;
    const p = computeBallTrajectory(
      START, VEL, WALLS, 3, 18, [], [], 1, [], undefined, null, undefined,
      { firstTurnIn: TURN_IN, intervalSeconds: 9, direction: 1 });
    const previewed = Math.atan2(p[2].y - p[1].y, p[2].x - p[1].x);
    const actual = Math.atan2(real.heading.y, real.heading.x);
    expect(Math.abs(angleDelta(previewed, actual)) * 180 / Math.PI).toBeLessThan(3);
  });
});

/**
 * The wiring. Both effects are computed correctly and reach nothing unless the
 * renderer asks for them, which is the state the compass was in: the schedule
 * was on the ball the whole time and the preview never read it.
 */
describe("the renderer asks for both", () => {
  const FX = readFileSync(
    resolve(__dirname, "../lib/rendering/sleek/fxLayer.ts"), "utf8");
  const draw = FX.slice(FX.indexOf("private drawTrajectory("), FX.indexOf("private drawAbilityFx("));

  it("passes the predicted ball's own turn schedule", () => {
    expect(draw).toMatch(/trajectoryTurnsFor\(ball, game\.activePlaySeconds\)/);
  });

  it("hands over the ball snapshots that carry a lodestone's pull", () => {
    expect(draw).toMatch(/trajectoryBallSnapshots\(/);
  });
});
