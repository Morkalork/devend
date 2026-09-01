/**
 * The plunger: aim, power, and the deal it buys.
 *
 * Three things here are load-bearing and the rest is arithmetic:
 *
 *   THE SHOT LEAVES OPPOSITE THE PULL. A slingshot read the other way round is
 *     not a control scheme with a different sign, it is a game that fires the
 *     ball into the wall behind you every time.
 *   THE CONE IS REAL. The cup's open side is a design statement about which
 *     part of the board a map wants you to open with. An aim that can go
 *     anywhere makes a launcher a ball spawn with extra steps.
 *   THE POWER IS THE PAY. Everything about why this feature exists is that a
 *     harder shot buys a more valuable map, and the multiplier has to land
 *     somewhere no axis ceiling can swallow it.
 */
import { describe, it, expect } from "vitest";
import {
  launchAim, bearingVector, launchVelocity, launchPayMultiplier, clampLaunchPower,
  maxSafeLaunchPower,
  LAUNCH_MIN_POWER, LAUNCH_MAX_POWER, LAUNCH_SPREAD, LAUNCH_DEAD_PULL, LAUNCH_FULL_PULL,
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
  it("fires OPPOSITE the pull", () => {
    // Pull down-and-left out of a cup facing right, and the ball goes up-right.
    const aim = launchAim({ x: -100, y: 0 }, "right");
    expect(aim).not.toBeNull();
    expect(aim!.direction.x).toBeGreaterThan(0.99);
  });

  it("fires nothing at all for a pull too short to be deliberate", () => {
    // A launch cannot be taken back, so a stray tap must not spend it.
    expect(launchAim({ x: 0, y: 0 }, "right")).toBeNull();
    expect(launchAim({ x: LAUNCH_DEAD_PULL - 1, y: 0 }, "right")).toBeNull();
    expect(launchAim({ x: LAUNCH_DEAD_PULL + 2, y: 0 }, "right")).not.toBeNull();
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

describe("the cone", () => {
  it("lets a modest angle through untouched", () => {
    const aim = launchAim({ x: -100, y: 20 }, "right")!;
    expect(aim.clamped).toBe(false);
    expect(Math.abs(angleOf(aim.direction))).toBeLessThan(LAUNCH_SPREAD);
  });

  it("clamps an aim that wants to go wider, and says so", () => {
    // Straight up out of a cup facing right is 90 degrees off.
    const aim = launchAim({ x: 0, y: 100 }, "right")!;
    expect(aim.clamped).toBe(true);
    expect(angleOf(aim.direction)).toBeCloseTo(-LAUNCH_SPREAD, 6);
  });

  it("never lets a shot leave outside the cone, from any pull, on any facing", () => {
    // The property that matters: whatever the drag, the ball leaves through the
    // open side. A cup that can fire backwards has no closed sides at all.
    for (const facing of FACINGS) {
      const base = angleOf(bearingVector(facing));
      for (let deg = 0; deg < 360; deg += 7) {
        const th = (deg * Math.PI) / 180;
        const aim = launchAim({ x: Math.cos(th) * 150, y: Math.sin(th) * 150 }, facing);
        if (!aim) continue;
        let off = angleOf(aim.direction) - base;
        while (off <= -Math.PI) off += 2 * Math.PI;
        while (off > Math.PI) off -= 2 * Math.PI;
        expect(Math.abs(off), `${facing} at ${deg}deg escaped the cone`)
          .toBeLessThanOrEqual(LAUNCH_SPREAD + 1e-9);
      }
    }
  });

  it("clamps to the NEAR edge of the cone, not across it", () => {
    // Signed clamping. Taking the absolute value would send a shot aimed just
    // past the left edge out of the right one, which plays as the launcher
    // ignoring the aim entirely at exactly the moment it matters.
    const justPastLeft = -(LAUNCH_SPREAD + 0.2);
    const pullAngle = justPastLeft + Math.PI; // pull is opposite the shot
    const aim = launchAim(
      { x: Math.cos(pullAngle) * 150, y: Math.sin(pullAngle) * 150 }, "right",
    )!;
    expect(aim.clamped).toBe(true);
    expect(angleOf(aim.direction)).toBeCloseTo(-LAUNCH_SPREAD, 6);
  });

  it("does not read a wrap past 180 degrees as a huge deflection", () => {
    // atan2 branch cut. Without normalising, a pull just clockwise of a cup
    // facing left computes a delta near 2*pi and clamps to the wrong edge.
    const aim = launchAim({ x: 150, y: -1 }, "left")!;
    const off = angleOf(aim.direction) - angleOf(bearingVector("left"));
    const wrapped = Math.abs(((off + Math.PI) % (2 * Math.PI)) - Math.PI);
    expect(wrapped).toBeLessThanOrEqual(LAUNCH_SPREAD + 1e-9);
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
