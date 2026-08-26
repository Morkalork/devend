/**
 * The minimum-speed floor must not be able to pin a ball against a wall.
 *
 * The floor exists so no active ball can drift to a standstill: a stopped ball
 * is one the player can fence around for free, on maps whose gate is a size
 * threshold. Its recovery branch - "fully stopped but should be moving" - used
 * to restart the ball along +x, always.
 *
 * On the RIGHT wall that is a trap rather than a recovery. The nudge pushes the
 * ball into the wall, the board resolver reflects it back out, the branch fires
 * again on the next frame and points it at the wall again. The ball sits
 * perfectly still, at its full nominal speed, forever. Found while soaking
 * level 19: a grey ball flush against x=837 (radius 18, edge at 855) held that
 * exact position for the entire run.
 *
 * The second half is about NaN. `cur > 1e-6` is FALSE for NaN, so a corrupt
 * velocity fell into the same branch and was laundered into a clean, wrong
 * nudge every frame - a permanent standstill that nothing reported. That is how
 * the wedge above was first produced: a test harness left one tuning value
 * undefined, the grey wind-down computed NaN, and the floor turned it into a
 * ball that never moved again. A real code path could do the same, and it
 * should be loud rather than silent.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { updateBall } from "@/lib/physics/updateBall";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";

const STEP = 1 / 120;
const LEFT = 45, RIGHT = 855, TOP = 45, BOTTOM = 855;

function board() {
  return {
    vertices: [
      { x: LEFT, y: TOP }, { x: RIGHT, y: TOP },
      { x: RIGHT, y: BOTTOM }, { x: LEFT, y: BOTTOM },
    ],
  };
}

function ballAt(x: number, y: number, vx: number, vy: number): Ball {
  return {
    id: "b1", position: { x, y }, renderPosition: { x, y },
    velocity: { x: vx, y: vy },
    speed: Math.hypot(vx, vy), baseSpeed: 240, topSpeed: 300, minimumSpeed: 150,
    radius: 18, color: "#cccccc", state: "active", ability: "none",
    effects: [], rotation: 0, flashIntensity: 0, regionId: "region-1",
  } as unknown as Ball;
}

function gameWith(ball: Ball): CanvasGameState {
  const g: Record<string, unknown> = {
    balls: [ball], walls: [], obstaclePolygons: [], mirrorPolygons: [],
    movers: [], regions: [], gridRegions: [], spaceGrid: null,
    boardPolygon: board(), activePlaySeconds: 0, ballSpeedScale: 1, creepFactor: 1,
    frozenBallId: null, destructibles: [], stackObjects: [], phasingObjects: [],
  };
  for (const k of [
    "activeWalls", "pickups", "objectDebris", "debris", "fallingObjects",
    "fallingSlabs", "lockFlashes", "wallImpacts", "ballPops", "abilityFx",
    "pickupLockMarkers", "pickupFeedback", "pendingDestroys", "pendingWallBreaks",
    "pendingBeats", "firedBeats", "warnedBeats", "bossFiredPhases",
  ]) g[k] = [];
  g.assimilations = new Map();
  return g as unknown as CanvasGameState;
}

/** How far the ball travelled over `steps`, and whether it ever really moved. */
function run(game: CanvasGameState, ball: Ball, steps: number) {
  const start = { x: ball.position.x, y: ball.position.y };
  let moved = 0;
  for (let i = 0; i < steps; i++) {
    (game as unknown as { activePlaySeconds: number }).activePlaySeconds = i * STEP;
    const bx = ball.position.x, by = ball.position.y;
    updateBall(ball, STEP, game);
    moved = Math.max(moved, Math.hypot(ball.position.x - bx, ball.position.y - by));
  }
  return {
    displaced: Math.hypot(ball.position.x - start.x, ball.position.y - start.y),
    biggestStep: moved,
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("the speed floor's stopped-ball recovery", () => {
  /** Flush against each wall, dead stopped: the exact wedge shape. */
  const corners: Array<[string, number, number]> = [
    ["right", RIGHT - 18, 450],
    ["left", LEFT + 18, 450],
    ["bottom", 450, BOTTOM - 18],
    ["top", 450, TOP + 18],
  ];

  for (const [side, x, y] of corners) {
    it(`gets a stopped ball off the ${side} wall`, () => {
      const ball = ballAt(x, y, 0, 0);
      const game = gameWith(ball);

      const { displaced } = run(game, ball, 120); // one second

      // A second at the 150/s floor covers 150 units. Anything under a tenth of
      // that is a ball the player watches stand still.
      expect(displaced, `${side}: moved only ${displaced.toFixed(1)}`).toBeGreaterThan(15);
      expect(Math.hypot(ball.velocity.x, ball.velocity.y)).toBeGreaterThanOrEqual(150 - 1e-6);
    });
  }

  it("aims the recovery into open space, not along a fixed axis", () => {
    // The old code always restarted along +x. From the right wall that is
    // straight back into it, which is what made the recovery a trap.
    const ball = ballAt(RIGHT - 18, 450, 0, 0);
    const game = gameWith(ball);
    updateBall(ball, STEP, game);
    expect(ball.velocity.x, "nudged toward the wall it is against").toBeLessThan(0);
  });

  it("never lets a ball hold one spot against the right wall", () => {
    // The soak's exact finding, as a unit: flush against the right edge with
    // the velocity pointing into it.
    const ball = ballAt(836.5, 524, 150, 0);
    const game = gameWith(ball);
    const { displaced } = run(game, ball, 240);
    expect(displaced, `held station, moved ${displaced.toFixed(1)}`).toBeGreaterThan(50);
  });

  it("puts a NaN velocity back on its feet, loudly", () => {
    // NaN used to slip through: `NaN > 1e-6` is false, so it took the stopped
    // branch and became a silent permanent wedge. It must be recovered AND
    // reported, because a NaN velocity means something upstream is broken and
    // a silent fix hides the real fault.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ball = ballAt(450, 450, NaN, NaN);
    const game = gameWith(ball);

    updateBall(ball, STEP, game);

    expect(Number.isFinite(ball.velocity.x), "x still NaN").toBe(true);
    expect(Number.isFinite(ball.velocity.y), "y still NaN").toBe(true);
    expect(Math.hypot(ball.velocity.x, ball.velocity.y)).toBeCloseTo(150, 5);
    expect(
      warn.mock.calls.some(c => String(c[0]).includes("non-finite ball")),
      "recovered silently",
    ).toBe(true);
  });

  it("does not let a NaN velocity reach the position first", () => {
    // Order matters more than the repair does. Integration happens near the
    // top of updateBall and the floor near the bottom, so a velocity checked
    // only at the floor has already been multiplied into the position by the
    // time it is caught - and a NaN POSITION is unrecoverable: the escaped-board
    // rescue compares distances, every comparison against NaN is false, so it
    // leaves the ball exactly where it found it, invisible and uncollidable for
    // the rest of the map.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ball = ballAt(450, 450, NaN, NaN);
    const game = gameWith(ball);

    updateBall(ball, STEP, game);

    expect(Number.isFinite(ball.position.x), "position x was corrupted").toBe(true);
    expect(Number.isFinite(ball.position.y), "position y was corrupted").toBe(true);
    // Untouched, because it was fine before the step and the velocity was
    // zeroed before it could be integrated.
    expect(ball.position.x).toBeCloseTo(450, 5);
    expect(ball.position.y).toBeCloseTo(450, 5);
  });

  it("puts a ball with no coordinates at all back on the board", () => {
    // A ball whose position is already NaN cannot be rescued by anything
    // downstream, so it is put back at the one point that is certainly on the
    // board rather than left as a phantom the player must still clear around.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ball = ballAt(NaN, NaN, 100, 0);
    const game = gameWith(ball);

    updateBall(ball, STEP, game);

    expect(Number.isFinite(ball.position.x), "still nowhere in x").toBe(true);
    expect(Number.isFinite(ball.position.y), "still nowhere in y").toBe(true);
    expect(ball.position.x).toBeGreaterThan(LEFT);
    expect(ball.position.x).toBeLessThan(RIGHT);
    expect(ball.position.y).toBeGreaterThan(TOP);
    expect(ball.position.y).toBeLessThan(BOTTOM);
    // A healthy velocity is not the fault and is not touched.
    expect(Math.hypot(ball.velocity.x, ball.velocity.y)).toBeGreaterThan(0);
    expect(
      warn.mock.calls.some(c => String(c[0]).includes("non-finite ball")),
      "recovered silently",
    ).toBe(true);
  });

  it("still leaves a healthy ball alone", () => {
    // The floor must not become a thing that touches balls that are fine.
    const ball = ballAt(450, 450, 200, 0);
    const game = gameWith(ball);
    updateBall(ball, STEP, game);
    expect(ball.velocity.x).toBeCloseTo(200, 5);
    expect(ball.velocity.y).toBeCloseTo(0, 5);
  });

  it("still raises a too-slow ball to the floor without turning it", () => {
    const ball = ballAt(450, 450, 30, 40); // speed 50, heading kept
    const game = gameWith(ball);
    updateBall(ball, STEP, game);
    const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
    expect(speed).toBeCloseTo(150, 5);
    // Same heading (3,4)/5, scaled up: direction is not the floor's business.
    expect(ball.velocity.x / speed).toBeCloseTo(0.6, 5);
    expect(ball.velocity.y / speed).toBeCloseTo(0.8, 5);
  });
});
