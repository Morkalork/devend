/**
 * The plunger: aim, power, and the deal it buys.
 *
 * Three things here are load-bearing and the rest is arithmetic:
 *
 *   THE SHOT LEAVES OPPOSITE THE PULL. A slingshot read the other way round is
 *     not a control scheme with a different sign, it is a game that fires the
 *     ball into the wall behind you every time.
 *   THE SHOT IS THE BARREL'S LINE. There is no aim cone any more: a barrel
 *     holds the whole roster, and a cone meant the preview drew one path for a
 *     shot that went several ways. The pull decides how fast and nothing else,
 *     so what is drawn is what happens (see lib/launcher.ts).
 *   THE POWER IS THE PAY. Everything about why this feature exists is that a
 *     harder shot buys a more valuable map, and the multiplier has to land
 *     somewhere no axis ceiling can swallow it.
 */
import { describe, it, expect } from "vitest";
import {
  launchAim, bearingVector, launchVelocity, launchPayMultiplier, clampLaunchPower,
  maxSafeLaunchPower,
  LAUNCH_MIN_POWER, LAUNCH_MAX_POWER, LAUNCH_DEAD_PULL, LAUNCH_FULL_PULL,
  type LaunchFacing,
} from "@/lib/launcher";
import { BEARING_VECTOR } from "@/lib/physics/obstacleRules";
import { PHYSICS_STEP, BASE_BALL_RADIUS } from "@/lib/gameConstants";
import { WALL_THICKNESS } from "@/lib/wallGeometry";

const FACINGS: LaunchFacing[] = ["up", "down", "left", "right"];
const angleOf = (v: { x: number; y: number }) => Math.atan2(v.y, v.x);

describe("which way a cup points", () => {
  it("reads the same table the one-way membranes do", () => {
    // Not a convenience. A second copy of "up is negative y" is how a launcher
    // comes to fire out of its own closed side while every test here passes.
    for (const f of FACINGS) {
      const [x, y] = BEARING_VECTOR[f];
      expect(bearingVector(f)).toEqual({ x, y });
    }
  });
});

describe("reading a pull", () => {
  it("draws the band by pulling BACK down the barrel", () => {
    // The slingshot half of the gesture survives the cone's removal: you pull
    // away from the muzzle and the shot springs the other way.
    const aim = launchAim({ x: -100, y: 0 }, "right");
    expect(aim).not.toBeNull();
    expect(aim!.direction.x).toBeGreaterThan(0.99);
  });

  it("reads only the part of the pull that stretches the band", () => {
    // A band strung across a cup draws when it is pulled back, not when it is
    // dragged across. Without this a sideways swipe would be a full-power shot
    // the player never asked for - and the direction no longer absorbs it.
    const straight = launchAim({ x: -LAUNCH_FULL_PULL, y: 0 }, "right")!;
    const skewed = launchAim(
      { x: -LAUNCH_FULL_PULL * Math.SQRT1_2, y: -LAUNCH_FULL_PULL * Math.SQRT1_2 }, "right",
    )!;
    expect(skewed.power).toBeLessThan(straight.power);
    expect(launchAim({ x: 0, y: -300 }, "right"), "a pull across the barrel fired")
      .toBeNull();
    expect(launchAim({ x: 300, y: 0 }, "right"), "a push toward the muzzle fired")
      .toBeNull();
  });

  it("fires nothing at all for a pull too short to be deliberate", () => {
    // A launch cannot be taken back, so a stray tap must not spend it. The
    // pulls here are NEGATIVE x because the cup faces right: drawing the band
    // means going back down the barrel. The same test used to pass with a
    // positive one, which was a finger pushing toward the muzzle firing a shot
    // - invisible while the aim was free to point anywhere.
    expect(launchAim({ x: 0, y: 0 }, "right")).toBeNull();
    expect(launchAim({ x: -(LAUNCH_DEAD_PULL - 1), y: 0 }, "right")).toBeNull();
    expect(launchAim({ x: -(LAUNCH_DEAD_PULL + 2), y: 0 }, "right")).not.toBeNull();
  });

  it("pays the weakest shot at the dead zone and the strongest at full pull", () => {
    const weak = launchAim({ x: -(LAUNCH_DEAD_PULL + 0.5), y: 0 }, "right")!;
    const full = launchAim({ x: -LAUNCH_FULL_PULL, y: 0 }, "right")!;
    expect(weak.power).toBeCloseTo(LAUNCH_MIN_POWER, 1);
    expect(full.power).toBeCloseTo(LAUNCH_MAX_POWER, 6);
  });

  it("never exceeds full power however far the finger goes", () => {
    // A drag off the edge of a phone screen is longer than any pull we planned.
    const huge = launchAim({ x: -5000, y: -5000 }, "right")!;
    expect(huge.power).toBe(LAUNCH_MAX_POWER);
  });

  it("rises monotonically with the pull, so harder always means harder", () => {
    let previous = -Infinity;
    for (let d = LAUNCH_DEAD_PULL + 1; d < LAUNCH_FULL_PULL * 1.5; d += 7) {
      const p = launchAim({ x: -d, y: 0 }, "right")!.power;
      expect(p, `power fell at pull ${d}`).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });
});

describe("the line the shot takes", () => {
  it("is the barrel's own, whatever direction the pull came from", () => {
    // THE change. It used to be the pull's heading, clamped into a 35 degree
    // cone; with the whole roster in the barrel that meant a fan, and a preview
    // that showed one of the paths a three-ball shot would take.
    for (const facing of FACINGS) {
      const bearing = bearingVector(facing);
      for (let deg = 0; deg < 360; deg += 11) {
        const th = (deg * Math.PI) / 180;
        const aim = launchAim({ x: Math.cos(th) * 150, y: Math.sin(th) * 150 }, facing);
        if (!aim) continue;   // a pull with no draw in it is not a shot
        expect(aim.direction.x, `${facing} at ${deg}deg left the barrel's line`)
          .toBeCloseTo(bearing.x, 9);
        expect(aim.direction.y).toBeCloseTo(bearing.y, 9);
      }
    }
  });

  it("follows the barrel's own turn, not just its facing", () => {
    // A cup drawn at an angle fires along the angle. This was already true of
    // the cone's centre line and is now the whole of the shot.
    const aim = launchAim({ x: -150, y: 0 }, "right", 30)!;
    expect(Math.atan2(aim.direction.y, aim.direction.x)).toBeCloseTo((30 * Math.PI) / 180, 9);
  });

  it("can never fire out of the cup's closed side", () => {
    // The property the cone was there to guarantee, now guaranteed by there
    // being nothing to steer: every shot leaves through the open side.
    for (const facing of FACINGS) {
      const bearing = bearingVector(facing);
      for (let deg = 0; deg < 360; deg += 7) {
        const th = (deg * Math.PI) / 180;
        const aim = launchAim({ x: Math.cos(th) * 200, y: Math.sin(th) * 200 }, facing);
        if (!aim) continue;
        const dot = aim.direction.x * bearing.x + aim.direction.y * bearing.y;
        expect(dot, `${facing} at ${deg}deg fired backwards`).toBeGreaterThan(0.999);
      }
    }
  });
});

describe("what the shot is worth", () => {
  it("multiplies the map's base by the power fired at", () => {
    // The rule a player holds in their head while aiming.
    expect(launchPayMultiplier(1)).toBe(1);
    expect(launchPayMultiplier(2.5)).toBe(2.5);
    expect(launchPayMultiplier(LAUNCH_MAX_POWER)).toBe(LAUNCH_MAX_POWER);
  });

  it("never pays more than the cap or less than a plain map", () => {
    // A save or a config carrying a silly number must not print money, and
    // must not make a launcher map pay LESS than one without a launcher.
    expect(clampLaunchPower(99)).toBe(LAUNCH_MAX_POWER);
    expect(clampLaunchPower(0)).toBe(LAUNCH_MIN_POWER);
    expect(clampLaunchPower(-5)).toBe(LAUNCH_MIN_POWER);
    expect(clampLaunchPower(Number.NaN)).toBe(LAUNCH_MIN_POWER);
  });
});

describe("leaving the cup", () => {
  it("leaves at the ball's base speed times the power", () => {
    const aim = launchAim({ x: -LAUNCH_FULL_PULL, y: 0 }, "right")!;
    const v = launchVelocity(aim, 250);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(250 * LAUNCH_MAX_POWER, 6);
  });

  it("survives a ball with a nonsense base speed", () => {
    const aim = launchAim({ x: -100, y: 0 }, "right")!;
    const v = launchVelocity(aim, 0);
    expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
    expect(Math.hypot(v.x, v.y)).toBeGreaterThan(0);
  });
});

describe("the cap is below the speed collision stops working at", () => {
  it("keeps a full-power ball inside the band a fence is detected in", () => {
    // Fence collision is DISCRETE: a distance test per physics step, not a
    // swept volume. A ball that crosses more than the detection band in one
    // step can pass through a fence untested. This recomputes the limit from
    // the live constants, so if PHYSICS_STEP or WALL_THICKNESS ever changes the
    // guard moves with them rather than going quietly stale.
    const limit = maxSafeLaunchPower(250, BASE_BALL_RADIUS, PHYSICS_STEP, WALL_THICKNESS);
    expect(LAUNCH_MAX_POWER).toBeLessThan(limit);
    // And not marginally: the cap is a play-feel number, and should have room.
    expect(LAUNCH_MAX_POWER).toBeLessThan(limit / 2);
  });

  it("computes a limit that falls as the step gets longer", () => {
    // Sanity on the formula itself: a coarser simulation tunnels sooner.
    const fine = maxSafeLaunchPower(250, 18, 1 / 120, 6);
    const coarse = maxSafeLaunchPower(250, 18, 1 / 30, 6);
    expect(coarse).toBeLessThan(fine);
  });
});
