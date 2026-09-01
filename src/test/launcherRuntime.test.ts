/**
 * The cup on a real board, and the shot that empties it.
 *
 * Three things have to hold or the feature is either broken or free:
 *
 *   THE CUP IS OPEN ON ONE SIDE. Build all four walls and the ball is sealed in
 *     a box it can never leave, which is a map that cannot be won. Build the
 *     wrong three and it fires out of a side the designer meant to be solid.
 *   THE BALL SLEEPS UNTIL FIRED. A dormant ball holds its region uncapturable.
 *     That is what stops a player fencing off the loaded cup and taking the map
 *     without ever placing the wager - the whole deal, skipped.
 *   THE POWER IS RECORDED. If the shot does not reach game.launchPower, the map
 *     is scored as though it had been fired at 1x and the wager pays nothing.
 */
import { describe, it, expect } from "vitest";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { setRunSeedText } from "@/lib/runRng";
import {
  fireLauncher, launchPending, pendingLauncher, type LauncherState,
} from "@/lib/physics/launcher";
import { bearingVector, LAUNCH_MAX_POWER, type LaunchFacing } from "@/lib/launcher";
import { BOX_WALL_THICKNESS } from "@/lib/gameConstants";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";

const CUP = { x: 300, y: 300, width: 120, height: 100 };

function build(facing: LaunchFacing = "right") {
  setRunSeedText("launcher-fixture");
  const level = {
    id: "launcher-test", level: 1, name: "L", sizeThreshold: 30, expectedCuts: 4,
    points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1,
    balls: [{ id: "b1", type: "red", startX: 700, startY: 700 }],
    entities: [{ id: "cup", kind: "launcher", shape: "rect", ...CUP, facing }],
  } as unknown as LevelConfig;
  const data = createInitialGameData(level, 1, DEFAULT_MODIFIERS);
  setRunSeedText(null);
  return data;
}

/** Does any wall of this cup lie along the given side? */
function hasWallOn(walls: Array<{ id: string }>, side: string): boolean {
  return walls.some(w => w.id.startsWith(`launcher-cup-${side}`));
}

describe("building the cup", () => {
  it("walls three sides and leaves the muzzle open", () => {
    for (const facing of ["up", "down", "left", "right"] as LaunchFacing[]) {
      const d = build(facing);
      expect(hasWallOn(d.walls, facing), `${facing} cup is sealed shut`).toBe(false);
      const others = (["up", "down", "left", "right"] as LaunchFacing[])
        .filter(s => s !== facing);
      for (const side of others) {
        expect(hasWallOn(d.walls, side), `${facing} cup is missing its ${side} wall`).toBe(true);
      }
    }
  });

  it("loads the map's whole roster, asleep, inside the barrel", () => {
    // Was "exactly one ball": the barrel now holds every ball on the map, so
    // nothing at all moves until the band is released. One ball loaded and the
    // rest already loose made the launch a thing happening in a corner of an
    // otherwise ordinary map.
    const d = build();
    const loaded = d.balls.filter(b => b.state === "dormant");
    expect(loaded.length).toBe(d.balls.length);
    expect(loaded.length).toBeGreaterThan(0);
    for (const ball of loaded) {
      expect(ball.velocity).toEqual({ x: 0, y: 0 });
      expect(ball.speed).toBe(0);
      // Inside the interior, which is the cup minus its wall thickness.
      expect(ball.position.x).toBeGreaterThanOrEqual(CUP.x);
      expect(ball.position.x).toBeLessThanOrEqual(CUP.x + CUP.width);
      expect(ball.position.y).toBeGreaterThanOrEqual(CUP.y);
      expect(ball.position.y).toBeLessThanOrEqual(CUP.y + CUP.height);
    }
  });

  it("leaves no ball loose on the board while the barrel is loaded", () => {
    // The property that makes the pull the map, rather than a garnish on it.
    const d = build();
    expect(d.balls.some(b => b.state === "active")).toBe(false);
  });

  it("leaves the ball room to sit inside the walls", () => {
    // A cup whose interior is narrower than the ball spawns it inside a wall.
    const d = build();
    const ball = d.balls.find(b => b.state === "dormant")!;
    const innerW = CUP.width - 2 * BOX_WALL_THICKNESS;
    const innerH = CUP.height - 2 * BOX_WALL_THICKNESS;
    expect(innerW).toBeGreaterThan(ball.radius * 2);
    expect(innerH).toBeGreaterThan(ball.radius * 2);
  });

  it("records the cup, unfired", () => {
    const d = build("down");
    expect(d.launchers).toHaveLength(1);
    expect(d.launchers[0]).toMatchObject({ id: "cup", facing: "down", fired: false });
    expect(d.launchers[0].ballIds.length).toBeGreaterThan(0);
    expect(launchPending({ launchers: d.launchers })).toBe(true);
    expect(pendingLauncher({ launchers: d.launchers })?.id).toBe("cup");
  });

  it("does nothing at all on a map with no launcher", () => {
    // The guarantee that keeps the other 34 maps exactly as they were.
    expect(launchPending({ launchers: undefined })).toBe(false);
    expect(pendingLauncher({ launchers: [] })).toBeNull();
  });
});

describe("firing", () => {
  const gameFrom = (d: ReturnType<typeof build>) => ({ ...d } as unknown as CanvasGameState);
  const straight = (facing: LaunchFacing, power: number) =>
    ({ direction: bearingVector(facing), power, clamped: false });

  it("wakes the ball and sends it out at power times base speed", () => {
    const d = build("right");
    const game = gameFrom(d);
    const cup = game.launchers![0];
    const ball = game.balls.find(b => b.id === cup.ballIds[0])!;

    expect(fireLauncher(game, cup, straight("right", 2))).toBe(2);

    expect(ball.state).toBe("active");
    // Speed is the contract; the HEADING is fanned across the cone when there
    // is more than one ball, so only the magnitude is pinned here.
    expect(Math.hypot(ball.velocity.x, ball.velocity.y))
      .toBeCloseTo(ball.baseSpeed * 2, 6);
    expect(Math.hypot(ball.velocity.x, ball.velocity.y)).toBeCloseTo(ball.speed, 6);
  });

  it("records the power on the game, which is what the map is paid on", () => {
    const game = gameFrom(build());
    fireLauncher(game, game.launchers![0], straight("right", 2.5));
    expect(game.launchPower).toBe(2.5);
  });

  it("clamps a nonsense power rather than firing a ball through the board", () => {
    const game = gameFrom(build());
    const ball = game.balls.find(b => b.state === "dormant")!;
    fireLauncher(game, game.launchers![0], straight("right", 99));
    expect(game.launchPower).toBe(LAUNCH_MAX_POWER);
    expect(Math.hypot(ball.velocity.x, ball.velocity.y))
      .toBeCloseTo(ball.baseSpeed * LAUNCH_MAX_POWER, 6);
  });

  it("cannot be fired twice", () => {
    // A second pull would re-aim a ball already in play, and would re-price the
    // map after the player has seen how the first shot went.
    const game = gameFrom(build());
    const cup = game.launchers![0];
    expect(fireLauncher(game, cup, straight("right", 2))).toBe(2);
    expect(fireLauncher(game, cup, straight("right", 3))).toBeNull();
    expect(game.launchPower).toBe(2);
    expect(launchPending(game)).toBe(false);
  });

  it("prices a two-cup map at the hardest shot, not the last one", () => {
    // Taking the safe shot second must not refund the brave one.
    const game = gameFrom(build());
    const a = game.launchers![0];
    const b: LauncherState = { ...a, id: "cup2", ballIds: [...a.ballIds], fired: false };
    fireLauncher(game, a, straight("right", 3));
    // The second cup is fired with fresh dormant balls in the real game; here
    // only the bookkeeping matters, so re-sleeping them is enough.
    for (const id of a.ballIds) game.balls.find(x => x.id === id)!.state = "dormant";
    fireLauncher(game, b, straight("right", 1.2));
    expect(game.launchPower).toBe(3);
  });

  it("refuses a ball that is not asleep", () => {
    const game = gameFrom(build());
    const cup = game.launchers![0];
    for (const id of cup.ballIds) game.balls.find(b => b.id === id)!.state = "active";
    expect(fireLauncher(game, cup, straight("right", 2))).toBeNull();
    expect(cup.fired).toBe(false);
  });
});
