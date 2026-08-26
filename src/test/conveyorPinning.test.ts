/**
 * A current must not glue a ball to the wall it flows into.
 *
 * Reported from a real session on level 11: "the red ball, whenever it hits the
 * bottom part, gets stuck to it and just goes left/right as though it was
 * tethered to the wall."
 *
 * Level 11 is the first map in the procedural band (PROCEDURAL_MIN_LEVEL), so
 * it is the first map that can roll a mutator, and Conveyor is one of the three
 * eligible there. A quarter of conveyor maps draw a current running DOWN.
 *
 * The conveyor is a POSITIONAL drift on purpose: a velocity change would be
 * erased within a frame by the speed rescalers and would compound into speed.
 * But applied before the collision pass, that drift was competing with the
 * ball's own motion for the same frame and winning. A ball arriving at the
 * floor with a vertical speed below the current's speed bounced upward, the
 * drift pushed it back down further than it had risen, and the resolver then
 * clamped it to a fixed distance from the surface - throwing the climb away.
 * Its velocity read "moving up at 30" while its position never changed, for the
 * rest of the map.
 *
 * The threshold was exactly the current's speed. At a ball speed of 250 and a
 * current of 55 that is any approach shallower than about 13 degrees; Riptide
 * at 82 makes it 19. A ball meets the floor at that angle several times a map,
 * and once it did, it never came back.
 *
 * That also breaks a rule the whole design leans on. gravity.ts states it
 * outright: speed is preserved everywhere precisely so "they must bounce" is
 * structural and a ball can never come to rest. A ball sliding along a wall is
 * one the player can fence around for free.
 *
 * The rule now: a current cannot push a ball through a wall, so it must not be
 * able to push it into one either. Only the component ALONG the contact
 * survives - so the sweep still happens, and the ball's own bounce carries it
 * away exactly as it would on a still board.
 */
import { describe, it, expect } from "vitest";
import { updateBall } from "@/lib/physics/updateBall";
import type { CanvasGameState } from "@/types/gameState";
import type { Ball } from "@/types/game";

const STEP = 1 / 120;
const LEFT = 45, RIGHT = 855, TOP = 45, BOTTOM = 855;
const RADIUS = 18;
const SPEED = 250;

/** The two currents in mapMutators.yml: Conveyor, and Riptide from level 15. */
const CURRENTS = [
  { name: "Conveyor", speed: 55 },
  { name: "Riptide", speed: 82 },
];

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
    id: "red-0", position: { x, y }, renderPosition: { x, y },
    velocity: { x: vx, y: vy },
    speed: Math.hypot(vx, vy), baseSpeed: SPEED, topSpeed: SPEED, minimumSpeed: 150,
    radius: RADIUS, color: "#ff5b5b", state: "active", ability: "none",
    effects: [], rotation: 0, flashIntensity: 0, regionId: "region-1",
  } as unknown as Ball;
}

function gameWith(ball: Ball, drift: { x: number; y: number } | null): CanvasGameState {
  const g: Record<string, unknown> = {
    balls: [ball], walls: [], obstaclePolygons: [], mirrorPolygons: [],
    movers: [], regions: [], gridRegions: [], spaceGrid: null,
    boardPolygon: board(), activePlaySeconds: 0, ballSpeedScale: 1, creepFactor: 1,
    frozenBallId: null, destructibles: [], stackObjects: [], phasingObjects: [],
    mapMutator: drift
      ? { id: "conveyor", behavior: "conveyor", driftX: drift.x, driftY: drift.y }
      : null,
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

/**
 * The longest unbroken stretch the ball spends within touching distance of the
 * downstream wall.
 *
 * POSITION, not speed. A pinned ball keeps a perfectly healthy 250 while going
 * nowhere, so watching speed reports everything as fine - which is exactly what
 * made this invisible to every existing test.
 */
function longestPinned(
  game: CanvasGameState, ball: Ball, seconds: number,
  onWall: (b: Ball) => boolean,
): number {
  const steps = Math.round(seconds / STEP);
  let run = 0, worst = 0;
  for (let i = 0; i < steps; i++) {
    (game as unknown as { activePlaySeconds: number }).activePlaySeconds = i * STEP;
    updateBall(ball, STEP, game);
    run = onWall(ball) ? run + 1 : 0;
    if (run > worst) worst = run;
  }
  return worst * STEP;
}

/** Each wall, the current that presses a ball into it, and a heading along it. */
const WALLS = [
  {
    name: "floor", drift: { x: 0, y: 1 }, start: { x: 450, y: 700 },
    along: (vy: number) => ({ vx: Math.sqrt(SPEED * SPEED - vy * vy), vy }),
    onWall: (b: Ball) => b.position.y > BOTTOM - RADIUS - 3,
  },
  {
    name: "ceiling", drift: { x: 0, y: -1 }, start: { x: 450, y: 200 },
    along: (vy: number) => ({ vx: Math.sqrt(SPEED * SPEED - vy * vy), vy: -vy }),
    onWall: (b: Ball) => b.position.y < TOP + RADIUS + 3,
  },
  {
    name: "right wall", drift: { x: 1, y: 0 }, start: { x: 700, y: 450 },
    along: (v: number) => ({ vx: v, vy: Math.sqrt(SPEED * SPEED - v * v) }),
    onWall: (b: Ball) => b.position.x > RIGHT - RADIUS - 3,
  },
  {
    name: "left wall", drift: { x: -1, y: 0 }, start: { x: 200, y: 450 },
    along: (v: number) => ({ vx: -v, vy: Math.sqrt(SPEED * SPEED - v * v) }),
    onWall: (b: Ball) => b.position.x < LEFT + RADIUS + 3,
  },
];

/**
 * Shallow approaches only: these are the ones the current used to beat, and
 * every one of them is below both currents' speeds.
 */
const SHALLOW = [10, 20, 30, 40, 50];

/** Twenty seconds is long enough that a permanent pin is unmistakable. */
const SOAK_SECONDS = 20;
/** A ball glued for a quarter of the run is tethered, not merely bouncing low. */
const PINNED_LIMIT = 5;

describe("a current never tethers a ball to the wall it flows into", () => {
  for (const current of CURRENTS) {
    for (const wall of WALLS) {
      it(`${current.name} into the ${wall.name}`, () => {
        const failures: string[] = [];
        for (const v of SHALLOW) {
          const { vx, vy } = wall.along(v);
          const ball = ballAt(wall.start.x, wall.start.y, vx, vy);
          const game = gameWith(ball, {
            x: wall.drift.x * current.speed, y: wall.drift.y * current.speed,
          });
          const pinned = longestPinned(game, ball, SOAK_SECONDS, wall.onWall);
          if (pinned >= PINNED_LIMIT) {
            const deg = (Math.asin(v / SPEED) * 180 / Math.PI).toFixed(0);
            failures.push(`${deg}deg approach stuck for ${pinned.toFixed(1)}s`);
          }
        }
        expect(failures.join(", ") || "none", `${current.name}/${wall.name}`).toBe("none");
      });
    }
  }

  it("still carries a ball in open water at the full current speed", () => {
    // The fix must not quietly turn the mutator off. Away from any wall, the
    // drift has to be exactly what it always was.
    const ball = ballAt(450, 300, SPEED, 0);
    const game = gameWith(ball, { x: 0, y: 55 });
    const y0 = ball.position.y;
    for (let i = 0; i < 120; i++) {
      (game as unknown as { activePlaySeconds: number }).activePlaySeconds = i * STEP;
      updateBall(ball, STEP, game);
    }
    expect(ball.position.y - y0, "the current stopped carrying").toBeCloseTo(55, 1);
  });

  it("still sweeps a ball ALONG the wall it is resting on", () => {
    // Only the INTO-the-wall component is blocked. Blocking the whole drift
    // while in contact would be far easier to write and would pass every test
    // above, so this pins the tangent on its own.
    //
    // Measured on a single frame, while the ball is demonstrably in contact.
    // Net travel over a run cannot do it: the ball bounces off the side walls
    // and the sign of its own motion flips, drowning the drift entirely.
    const ball = ballAt(450, BOTTOM - RADIUS + 1, 200, 20);  // just penetrating
    const game = gameWith(ball, { x: 55, y: 55 });           // diagonal current

    // Frame one establishes contact.
    updateBall(ball, STEP, game);
    expect(ball.surfaceContact, "the ball never registered contact").toBeDefined();
    expect(ball.surfaceContact!.ny, "contact normal is not the floor").toBeLessThan(-0.9);

    // Frame two: everything except the ball's own motion is the drift.
    const x0 = ball.position.x;
    const vx = ball.velocity.x;
    updateBall(ball, STEP, game);
    const swept = (ball.position.x - x0) - vx * STEP;

    expect(swept, "the sideways sweep was eaten along with the inward push")
      .toBeCloseTo(55 * STEP, 4);
  });

  it("leaves a ball on a still board completely alone", () => {
    // No mutator, no contact tracking, no behaviour change: the 95% case.
    const ball = ballAt(450, 700, 240, 70);
    const game = gameWith(ball, null);
    for (let i = 0; i < 240; i++) {
      (game as unknown as { activePlaySeconds: number }).activePlaySeconds = i * STEP;
      updateBall(ball, STEP, game);
    }
    expect(ball.surfaceContact, "tracked contact on a map with no current").toBeUndefined();
    expect(Math.hypot(ball.velocity.x, ball.velocity.y)).toBeCloseTo(SPEED, 3);
  });
});
