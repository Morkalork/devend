/**
 * The plunger on the canvas: how a drag reads as a launch, and where the band
 * and the barrel's line are drawn.
 */
import { describe, it, expect } from "vitest";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import { LAUNCH_DEAD_PULL, LAUNCH_FULL_PULL, LAUNCH_MAX_POWER, LAUNCH_MIN_POWER } from "@/lib/launcher";
import { launchGeometry, launchPowerT, readLaunchAim } from "@/ui/game/launchModel";
import type { BoardBox } from "@/ui/game/rubberBandModel";

const ONE: BoardBox = { canvasWidth: BOARD_WIDTH, canvasHeight: BOARD_HEIGHT, canvasOffsetTop: 0, canvasOffsetLeft: 0 };
const HALF: BoardBox = { canvasWidth: BOARD_WIDTH / 2, canvasHeight: BOARD_HEIGHT / 2, canvasOffsetTop: 30, canvasOffsetLeft: 10 };

describe("reading a pull", () => {
  it("fires nothing without a press, or for a pull inside the dead zone", () => {
    expect(readLaunchAim(ONE, null, { x: 0, y: 300 }, "up")).toBeNull();
    // An up-facing barrel is pulled DOWN (toward the player).
    expect(readLaunchAim(ONE, { x: 0, y: 0 }, { x: 0, y: LAUNCH_DEAD_PULL - 1 }, "up")).toBeNull();
  });

  it("does not take a sideways drag for a launch", () => {
    expect(readLaunchAim(ONE, { x: 0, y: 0 }, { x: 300, y: 0 }, "up")).toBeNull();
  });

  it("reaches full power at the full pull, along the muzzle", () => {
    const aim = readLaunchAim(ONE, { x: 0, y: 0 }, { x: 0, y: LAUNCH_FULL_PULL }, "up")!;
    expect(aim.power).toBeCloseTo(LAUNCH_MAX_POWER);
    expect(aim.direction.x).toBeCloseTo(0);
    expect(aim.direction.y).toBeCloseTo(-1);
    expect(launchPowerT(aim)).toBeCloseTo(1);
    expect(launchPowerT(null)).toBe(0);
  });

  it("measures the pull in world units, so a scaled board pulls the same", () => {
    // Half-size board: half the screen distance is the same world pull.
    const aim = readLaunchAim(HALF, { x: 50, y: 50 }, { x: 50, y: 50 + LAUNCH_FULL_PULL / 2 }, "up")!;
    expect(aim.power).toBeCloseTo(LAUNCH_MAX_POWER);
  });
});

describe("what the plunger draws", () => {
  const base = {
    ...ONE,
    ballPosition: { x: 450, y: 700 },
    inner: { x: 430, y: 680, width: 40, height: 80 },
    facing: "up" as const,
  };

  it("draws the barrel's line from the ball before any pull", () => {
    const g = launchGeometry({ ...base, aim: null });
    expect(g.ball).toEqual({ x: 450, y: 700 });
    expect(g.lineEnd.x).toBeCloseTo(450);
    expect(g.lineEnd.y).toBeCloseTo(700 - Math.max(60, BOARD_WIDTH * 0.32));
  });

  it("strings the band across the closed end and bows it back with the pull", () => {
    const rest = launchGeometry({ ...base, aim: null });
    // The closed end of an up-facing cup is its bottom edge.
    expect(rest.bandA.y).toBeCloseTo(760);
    expect(rest.bandB.y).toBeCloseTo(760);
    expect(rest.bandMid).toEqual({ x: 450, y: 760 });
    const full = launchGeometry({ ...base, aim: { direction: { x: 0, y: -1 }, power: LAUNCH_MAX_POWER } });
    expect(full.bandMid.y).toBeCloseTo(760 + LAUNCH_FULL_PULL * 0.5);
    const weakest = launchGeometry({ ...base, aim: { direction: { x: 0, y: -1 }, power: LAUNCH_MIN_POWER } });
    expect(weakest.bandMid.y).toBeCloseTo(760);
  });
});
