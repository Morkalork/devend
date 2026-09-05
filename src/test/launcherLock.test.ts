/**
 * The launcher's three lock/fence rules.
 *
 *   1. Once the barrel has ejected every ball, a ball that finds its way back
 *      in can be locked there like anywhere else.
 *   2. A ball sealed inside BEFORE it has emptied fails the map (a life, a
 *      restart).
 *   3. No fence may be started until the barrel has finished ejecting.
 *
 * Rule 3 is what a player meets; rules 1 and 2 are the two sides of the barrel
 * interior being forbidden ground until it arms and an ordinary pocket after.
 * The arming that gates all three is latching: a returning ball must not un-arm
 * the barrel, or the very play rule 1 allows would trip rule 2.
 */
import { describe, it, expect } from "vitest";
import {
  pointInLauncherInterior, launcherHoldsBall, updateLauncherArming,
  fencesBlockedByLauncher, lockedInsideUnarmedLauncher, type LauncherState,
} from "@/lib/physics/launcher";

const barrel = (over: Partial<LauncherState> = {}): LauncherState => ({
  id: "cup",
  inner: { x: 100, y: 100, width: 120, height: 200 },
  facing: "up",
  ballIds: ["a", "b"],
  fired: false,
  armed: false,
  ...over,
});
const ball = (id: string, x: number, y: number, state = "active") =>
  ({ id, position: { x, y }, state } as any);   // eslint-disable-line @typescript-eslint/no-explicit-any
const game = (launchers: LauncherState[], balls: any[]) =>  // eslint-disable-line @typescript-eslint/no-explicit-any
  ({ launchers, balls } as any);   // eslint-disable-line @typescript-eslint/no-explicit-any

describe("which points count as inside", () => {
  it("takes the interior of an un-turned barrel", () => {
    const b = barrel();
    expect(pointInLauncherInterior({ x: 160, y: 200 }, b)).toBe(true);
    expect(pointInLauncherInterior({ x: 50, y: 200 }, b)).toBe(false);
  });

  it("follows the barrel when it is turned", () => {
    // The interior rect is stored in the barrel's own frame, so a turned barrel
    // occupies a different patch of the board. A point that is inside the
    // UN-turned rect can be outside the real one, and vice versa - testing the
    // stored rect directly is the authored-vs-real mistake in miniature.
    const flat = barrel();
    const turned = barrel({ angle: 90 });
    // The interior is 120 wide, 200 tall about centre (160, 200). A point 90
    // units above centre is inside the tall flat barrel...
    expect(pointInLauncherInterior({ x: 160, y: 120 }, flat)).toBe(true);
    // ...and outside once the barrel is turned a quarter (it is now 200 wide,
    // 120 tall), while a point 90 units to the SIDE is now inside.
    expect(pointInLauncherInterior({ x: 160, y: 120 }, turned)).toBe(false);
    expect(pointInLauncherInterior({ x: 250, y: 200 }, turned)).toBe(true);
  });
});

describe("arming: the barrel latches empty", () => {
  it("does not arm while it still holds a ball", () => {
    const g = game([barrel({ fired: true })], [ball("a", 160, 200)]);
    updateLauncherArming(g);
    expect(g.launchers[0].armed).toBe(false);
  });

  it("arms the moment the last ball has left", () => {
    const g = game([barrel({ fired: true })], [ball("a", 500, 500)]);
    updateLauncherArming(g);
    expect(g.launchers[0].armed).toBe(true);
  });

  it("never arms a barrel that has not fired", () => {
    // An empty-looking UNFIRED barrel is a contradiction the loop pause makes
    // impossible, but arming it would let a fence be drawn on a map that has
    // not started.
    const g = game([barrel({ fired: false })], []);
    updateLauncherArming(g);
    expect(g.launchers[0].armed).toBe(false);
  });

  it("STAYS armed when a ball comes back in", () => {
    // THE rule 1 case. A returning ball is inside an armed barrel and must stay
    // lockable; dropping back to un-armed would fail the map for the play the
    // rule exists to reward.
    const g = game([barrel({ fired: true, armed: true })], [ball("a", 160, 200)]);
    updateLauncherArming(g);
    expect(g.launchers[0].armed).toBe(true);
    expect(launcherHoldsBall(g, g.launchers[0])).toBe(true);
  });

  it("ignores a won ball sitting in the interior", () => {
    // A ball already locked there does not keep the barrel from arming: it is
    // out of play, and the whole point of arming is that returning balls CAN be
    // locked there.
    const g = game([barrel({ fired: true })], [ball("a", 160, 200, "won")]);
    updateLauncherArming(g);
    expect(g.launchers[0].armed).toBe(true);
  });
});

describe("rule 3: no fence until every barrel is armed", () => {
  it("blocks while a barrel is unfired", () => {
    expect(fencesBlockedByLauncher(game([barrel()], []))).toBe(true);
  });

  it("blocks while a fired barrel is still draining", () => {
    expect(fencesBlockedByLauncher(game([barrel({ fired: true })], []))).toBe(true);
  });

  it("allows once every barrel is armed", () => {
    expect(fencesBlockedByLauncher(game([barrel({ fired: true, armed: true })], []))).toBe(false);
  });

  it("blocks if ANY barrel is still holding, not just the first", () => {
    const g = game([
      barrel({ id: "a", fired: true, armed: true }),
      barrel({ id: "b", fired: true, armed: false }),
    ], []);
    expect(fencesBlockedByLauncher(g)).toBe(true);
  });

  it("never blocks on a map with no launcher", () => {
    // The guarantee for every other map: undefined launchers is not "blocked".
    expect(fencesBlockedByLauncher({ launchers: undefined } as any)).toBe(false);  // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(fencesBlockedByLauncher({ launchers: [] } as any)).toBe(false);  // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe("rule 2: sealing a ball inside before it arms", () => {
  const justWon = [{ position: { x: 160, y: 200 } }];

  it("is a failure while the barrel is un-armed", () => {
    const g = game([barrel({ fired: true, armed: false })], []);
    expect(lockedInsideUnarmedLauncher(g, justWon)?.id).toBe("cup");
  });

  it("is fine once the barrel is armed (rule 1)", () => {
    const g = game([barrel({ fired: true, armed: true })], []);
    expect(lockedInsideUnarmedLauncher(g, justWon)).toBeNull();
  });

  it("ignores a lock that landed outside the barrel", () => {
    const g = game([barrel({ fired: true, armed: false })], []);
    expect(lockedInsideUnarmedLauncher(g, [{ position: { x: 600, y: 600 } }])).toBeNull();
  });

  it("says nothing on a map with no launcher", () => {
    expect(lockedInsideUnarmedLauncher({ launchers: [] } as any, justWon)).toBeNull();  // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

/**
 * The helpers above are inert unless the game actually calls them. Source-level
 * for the reason GameCanvas's payout check is: a render harness for the loop,
 * the input layer and a completing cut would be a large fragile thing guarding
 * three call sites, and what must not happen - a rule going uncalled - is
 * visible in the source.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("the rules are wired in, not just defined", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("arms barrels every frame in the game loop", () => {
    expect(read("src/hooks/useGameLoop.ts"), "arming never runs")
      .toContain("updateLauncherArming(game)");
  });

  it("blocks a cut from starting while a barrel is loaded", () => {
    const input = read("src/hooks/useGameInput.ts");
    // The exact guard, so a `false &&` or a commented-out condition cannot
    // leave the call present but inert - the failure the whole-file toContain
    // could not tell from the real thing.
    expect(input, "the fence block is gone or disabled")
      .toMatch(/if \(fencesBlockedByLauncher\(game\)\) \{/);
    const at = input.indexOf("fencesBlockedByLauncher(game)");
    expect(input.slice(at, at + 120)).toContain("return");
  });

  /**
   * Two statements rather than one window over the source.
   *
   * This used to look for `getLives() - 1` within 400 characters of the guard,
   * which tied it to the life-docking being INLINE. It was inline in three
   * places - the deadline, the lock-out and here - and those three copies of an
   * ordering-sensitive block are now one shared helper, so the old assertion
   * failed on a change that made the code better. Asserting "this path costs a
   * life" and "costing a life docks one" separately leaves each free to move.
   */
  it("fails the map when a cut seals a ball inside an un-armed barrel", () => {
    const applyCut = read("src/lib/physics/applyCut.ts");
    // The live guard, not merely a mention of it: `if (lockedInside...(...))`.
    expect(applyCut, "the premature-lock fail is gone or disabled")
      .toMatch(/if \(lockedInsideUnarmedLauncher\(game, justWon\)\) \{/);
    expect(applyCut, "the premature lock does not cost a life")
      .toMatch(/lockedInsideUnarmedLauncher[\s\S]{0,400}failMapCostingALife\(/);
  });

  it("docks exactly one life on the shared fail path", () => {
    const applyCut = read("src/lib/physics/applyCut.ts");
    const at = applyCut.indexOf("function failMapCostingALife(");
    expect(at, "the shared fail path is gone").toBeGreaterThan(-1);
    const body = applyCut.slice(at, at + 900);
    expect(body, "a map failure stopped costing a life").toContain("getLives() - 1");
    expect(body, "the reason no longer reaches the restart").toContain("onMapTimedOut");
    expect(body, "the last life no longer ends the run").toContain("handleGameOverFn");
  });
});
