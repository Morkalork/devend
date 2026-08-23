/**
 * The Scrum Master preview must bend the way the ball actually bends.
 *
 * Reported as "the tracker no longer projects, it just follows". The maths was
 * fine: on real maps the prediction returns a proper multi-bounce path hundreds
 * of world units long. What was wrong is that the preview and updateBall each
 * decided FOR THEMSELVES what curves a heading, and had drifted three ways:
 *
 *   - The physics steers toward gravity WELLS, authored on six maps. The
 *     preview had never heard of them, so it drew a confident straight line the
 *     ball then curved away from.
 *   - The physics scales every bend by `gravityBendMultiplier` (Free Fall). The
 *     preview used the raw authored rate, so the forecast got wronger the more
 *     the player spent on the upgrade meant to help them.
 *   - The physics gated map gravity on `mutator.behavior === "gravity" && cfg`;
 *     the preview on `cfg` alone. Two readings of one fact.
 *
 * Both now go through physics/steering.ts. These tests exist to keep it that
 * way, because the failure is silent: the line looks perfectly plausible and is
 * simply not where the ball goes.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/gameAudio", () => ({ playWallHitSound: () => {}, playLevelCompleteSound: () => {} }));
vi.mock("@/lib/gameHaptics", () => ({
  vibrateBallLock: () => {}, vibrateFenceComplete: () => {}, vibrateFenceBreak: () => {},
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeBallTrajectory } from "@/lib/gameUtils";
import {
  steerHeading, steerWorldOf, mapGravityActive, anySteeringActive,
  wellPullAt, wellTurnRateAt, type SteerWorld,
} from "@/lib/physics/steering";
import type { Vector2 } from "@/lib/polygon";
import type { Wall } from "@/lib/wallGeometry";

function boardWalls(x0: number, y0: number, x1: number, y1: number): Wall[] {
  const c: [Vector2, Vector2][] = [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }],
  ];
  return c.map((s, i) => ({ id: `board-${i}`, start: s[0], end: s[1], thickness: 0 } as unknown as Wall));
}

const WALLS = boardWalls(45, 45, 855, 855);

/** A board whose only steering is one well covering the middle. */
const wellWorld = (over: Partial<SteerWorld> = {}): SteerWorld => ({
  gravityConfig: null,
  gravityWells: [{ x: 200, y: 200, width: 500, height: 500, turnRate: 2.5 }],
  spaceRemainingPercent: 100,
  ...over,
});

/**
 * Total heading change along a predicted path, in radians.
 *
 * Deliberately not "how far it strays from a straight line", which was the
 * first thing I measured and is confounded by length: a FIERCER bend curves
 * into a wall sooner, so the path is shorter and its bow measures smaller even
 * though it turned more. Summing the turn between consecutive legs is
 * independent of how far the ball got.
 */
function turnOf(points: Vector2[]): number {
  let total = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = { x: points[i].x - points[i - 1].x, y: points[i].y - points[i - 1].y };
    const b = { x: points[i + 1].x - points[i].x, y: points[i + 1].y - points[i].y };
    const la = Math.hypot(a.x, a.y) || 1, lb = Math.hypot(b.x, b.y) || 1;
    const cos = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb)));
    total += Math.acos(cos);
  }
  return total;
}

describe("the preview follows the same rule the ball does", () => {
  const start = { x: 300, y: 400 };
  const vel = { x: 260, y: 0 };

  /** The bug: a well bends the ball and the preview drew a straight line. */
  it("curves through a gravity well instead of drawing straight past it", () => {
    const straight = computeBallTrajectory(start, vel, WALLS, 1, 18);
    const curved = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1, [], undefined,
      { world: wellWorld(), atSeconds: 0 });
    expect(turnOf(straight), "no well: the path is a straight cast").toBeLessThan(0.01);
    expect(turnOf(curved), "inside a well the path must bend").toBeGreaterThan(0.3);
  });

  it("bends toward the well's own pull direction", () => {
    const down = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1, [], undefined,
      { world: wellWorld(), atSeconds: 0 });
    const up = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1, [], undefined,
      { world: wellWorld({
        gravityWells: [{ x: 200, y: 200, width: 500, height: 500, turnRate: 2.5, pull: "up" }],
      }), atSeconds: 0 });
    const mid = (p: Vector2[]) => p[Math.floor(p.length / 2)];
    expect(mid(down).y, "a down well should push the path downward").toBeGreaterThan(start.y);
    expect(mid(up).y, "an up well should push it the other way").toBeLessThan(start.y);
  });

  /**
   * The upgrade meant to help you was making the forecast worse: the physics
   * softens the bend, the preview did not, so the more Free Fall you owned the
   * further the line was from the truth.
   */
  it("softens the curve by the same bend multiplier the physics uses", () => {
    const full = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1, [], undefined,
      { world: wellWorld(), atSeconds: 0 });
    const softened = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1, [], undefined,
      { world: wellWorld({ gravityBendMultiplier: 0.25 }), atSeconds: 0 });
    expect(turnOf(softened)).toBeLessThan(turnOf(full));
  });

  it("honours a well's authored turn rate, not the default", () => {
    const gentle = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1, [], undefined,
      { world: wellWorld({
        gravityWells: [{ x: 200, y: 200, width: 500, height: 500, turnRate: 0.4 }],
      }), atSeconds: 0 });
    const fierce = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1, [], undefined,
      { world: wellWorld({
        gravityWells: [{ x: 200, y: 200, width: 500, height: 500, turnRate: 4 }],
      }), atSeconds: 0 });
    expect(turnOf(fierce)).toBeGreaterThan(turnOf(gentle));
  });

  /**
   * Most maps pull at nothing and must not pay for the chord marching, nor
   * drift by a hair because of it. Compared point-for-point rather than by
   * turn: a bounce is a 180-degree reflection, so a turn metric cannot tell a
   * curve from an ordinary wall hit.
   */
  it("is byte-identical to the plain cast when nothing is pulling", () => {
    const flat = computeBallTrajectory(
      start, vel, WALLS, 2, 18, [], [], 1, [], undefined,
      { world: { gravityConfig: null }, atSeconds: 0 });
    const none = computeBallTrajectory(start, vel, WALLS, 2, 18);
    expect(flat).toEqual(none);
  });

  /** A single leg with nothing pulling is one straight line, no chords. */
  it("does not subdivide a leg on a board with no wells", () => {
    const flat = computeBallTrajectory(
      start, vel, WALLS, 1, 18, [], [], 1, [], undefined,
      { world: { gravityConfig: null }, atSeconds: 0 });
    expect(flat).toHaveLength(2);
  });
});

describe("one rule, read the same way by both sides", () => {
  it("only calls map gravity live when the mutator actually is one", () => {
    const cfg = { turnRate: 2, period: 8, sequence: ["down"] } as SteerWorld["gravityConfig"];
    expect(mapGravityActive({ gravityConfig: cfg })).toBe(false);
    expect(mapGravityActive({ gravityConfig: cfg, mapMutatorBehavior: "crunch" })).toBe(false);
    expect(mapGravityActive({ gravityConfig: cfg, mapMutatorBehavior: "gravity" })).toBe(true);
    expect(mapGravityActive({ gravityConfig: null, mapMutatorBehavior: "gravity" })).toBe(false);
  });

  it("reports a board with a well as steering, even with no map gravity", () => {
    expect(anySteeringActive({ gravityConfig: null }, 0)).toBe(false);
    expect(anySteeringActive(wellWorld(), 0)).toBe(true);
  });

  it("reads a pull only inside the well", () => {
    expect(wellPullAt({ x: 400, y: 400 }, wellWorld())).toEqual({ x: 0, y: 1 });
    expect(wellPullAt({ x: 60, y: 60 }, wellWorld())).toBeNull();
    expect(wellTurnRateAt({ x: 400, y: 400 }, wellWorld())).toBe(2.5);
    expect(wellTurnRateAt({ x: 60, y: 60 }, wellWorld())).toBe(0);
  });

  it("steers by both map gravity and a well when a board has both", () => {
    const both: SteerWorld = wellWorld({
      gravityConfig: { turnRate: 2, period: 8, sequence: ["down"] } as SteerWorld["gravityConfig"],
      mapMutatorBehavior: "gravity",
    });
    const out = steerHeading({ x: 400, y: 400 }, { x: 100, y: 0 }, both, 0, 1 / 60);
    expect(out).toBeTruthy();
    // Steering only rotates; a bend that changed speed would be erased by the
    // rescalers in updateBall within a frame.
    expect(Math.hypot(out!.x, out!.y)).toBeCloseTo(100, 4);
  });

  it("leaves a heading alone on a board with nothing pulling", () => {
    expect(steerHeading({ x: 400, y: 400 }, { x: 100, y: 0 }, { gravityConfig: null }, 0, 1 / 60))
      .toBeNull();
  });
});

/**
 * The structural guard. A correct shared rule is worth nothing if one side
 * stops using it, which is exactly how this broke: the preview grew its own
 * copy of "what bends a path" and then fell behind.
 */
describe("neither side is allowed its own copy of the rule", () => {
  const BALL = readFileSync(resolve(__dirname, "../lib/physics/updateBall.ts"), "utf8");
  const UTILS = readFileSync(resolve(__dirname, "../lib/gameUtils.ts"), "utf8");
  const FX = readFileSync(resolve(__dirname, "../lib/rendering/sleek/fxLayer.ts"), "utf8");

  it("has updateBall steer through the shared rule", () => {
    expect(BALL).toMatch(/steerHeading\(/);
    expect(BALL, "no second inline well step").not.toMatch(/wellStep\(/);
    expect(BALL, "no second inline gravity step").not.toMatch(/gravityStep\(/);
  });

  it("has the preview take a SteerWorld, not a bare gravity config", () => {
    expect(UTILS).toMatch(/steer\?: \{ world: SteerWorld; atSeconds: number \}/);
    expect(UTILS).toMatch(/wellPullAt\(/);
  });

  it("has the renderer build that world from the same adapter", () => {
    expect(FX).toMatch(/steerWorldOf\(game\)/);
    expect(FX, "the old gravity-config-only call is what caused this")
      .not.toMatch(/cfg: game\.gravityConfig/);
  });

  it("keeps steerWorldOf as the one adapter both sides use", () => {
    const world = steerWorldOf({
      gravityConfig: null, mapMutator: { behavior: "gravity" },
      gravityWells: [], spaceRemainingPercent: 40, gravityBendMultiplier: 0.5,
    });
    expect(world.mapMutatorBehavior).toBe("gravity");
    expect(world.spaceRemainingPercent).toBe(40);
    expect(world.gravityBendMultiplier).toBe(0.5);
  });
});
