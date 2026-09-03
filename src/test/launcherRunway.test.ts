/**
 * Where a barrel actually fires, and whether anything is in the way.
 *
 * This is the number behind the map editor's "FIRES INTO A WALL" warning. The
 * failure it exists to catch is specific and quiet: a launcher is authored as a
 * rect and drew on the canvas as one, so a barrel canted round into the wall
 * beside it looked exactly like a good one, and the only way to find out where
 * a map's opening shot went was to play the map.
 *
 * The subtlety is that `facing` is NOT the heading. It names the open side of
 * an un-turned rect, and the barrel's own `angle` then moves it - so a launcher
 * can read "fires out of: right" and shoot at the floor. Anything that reasons
 * about the shot has to go through muzzleVector, and the tests below are mostly
 * about places that could get away with reading the facing instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  muzzleRay, launcherRunway, muzzleVector, MIN_LAUNCH_RUNWAY_FRACTION,
  type LauncherPlacement, type Blocker,
} from "@/lib/launcher";

const BOUNDS = { width: 900, height: 900, margin: 45 };
const cup = (over: Partial<LauncherPlacement> = {}): LauncherPlacement => ({
  x: 100, y: 400, width: 120, height: 80, facing: "right", ...over,
});

describe("where the muzzle is", () => {
  it("starts at the mouth of the barrel, not its middle", () => {
    // Traced from the centre, the first thing every shot "hits" is the
    // launcher's own back wall, and every barrel reports itself blocked.
    const { origin } = muzzleRay(cup());
    expect(origin.x).toBeCloseTo(100 + 120, 6);   // right edge
    expect(origin.y).toBeCloseTo(400 + 40, 6);    // mid height
  });

  it("moves round to the end the barrel actually points at", () => {
    const { origin } = muzzleRay(cup({ facing: "up" }));
    expect(origin.y).toBeCloseTo(400, 6);
    expect(origin.x).toBeCloseTo(160, 6);
  });

  it("points along the TURNED muzzle, not the bare facing", () => {
    // The whole reason this is a function. A barrel facing right at 90 degrees
    // fires DOWN, and a check that read `facing` would clear it for firing into
    // the wall on its right.
    const { direction } = muzzleRay(cup({ angle: 90 }));
    expect(direction.x).toBeCloseTo(0, 6);
    expect(direction.y).toBeCloseTo(1, 6);
  });
});

describe("how far a shot gets", () => {
  it("runs to the far edge of the arena when nothing is in the way", () => {
    // From x=220 to the arena's right edge at 900-45.
    expect(launcherRunway(cup(), [], BOUNDS)).toBeCloseTo(900 - 45 - 220, 6);
  });

  it("stops at the first thing it hits", () => {
    const wall: Blocker = { x: 400, y: 300, width: 30, height: 300 };
    expect(launcherRunway(cup(), [wall], BOUNDS)).toBeCloseTo(400 - 220, 6);
  });

  it("takes the NEAREST blocker, not the last one checked", () => {
    const far: Blocker = { x: 600, y: 300, width: 30, height: 300 };
    const near: Blocker = { x: 400, y: 300, width: 30, height: 300 };
    expect(launcherRunway(cup(), [far, near], BOUNDS)).toBeCloseTo(180, 6);
    expect(launcherRunway(cup(), [near, far], BOUNDS)).toBeCloseTo(180, 6);
  });

  it("ignores a wall the shot passes beside", () => {
    // Directly above the barrel's line, so the ray misses it entirely. A check
    // done on bounding boxes alone, without the ray, would call this blocked.
    const above: Blocker = { x: 400, y: 100, width: 30, height: 80 };
    expect(launcherRunway(cup(), [above], BOUNDS)).toBeCloseTo(900 - 45 - 220, 6);
  });

  it("ignores a wall BEHIND the barrel", () => {
    // A shot travels forwards. A slab test that forgot to reject negative t
    // would report the map's whole left side as an obstruction.
    const behind: Blocker = { x: 40, y: 300, width: 30, height: 300 };
    expect(launcherRunway(cup(), [behind], BOUNDS)).toBeCloseTo(900 - 45 - 220, 6);
  });

  it("finds the wall a CANTED barrel is really pointing at", () => {
    // The bug in one test. Facing right, turned to fire down: the wall to the
    // right is irrelevant and the floor is what stops it.
    const toTheRight: Blocker = { x: 500, y: 300, width: 30, height: 300 };
    const turned = cup({ angle: 90 });
    const run = launcherRunway(turned, [toTheRight], BOUNDS);
    // Muzzle is at the bottom edge of the barrel, running to the arena floor.
    expect(run).toBeCloseTo(900 - 45 - 480, 6);
  });

  it("never reports a negative run", () => {
    // A barrel shoved into the margin has nowhere to fire, which is zero, not
    // a negative number that would read as an enormous clear run if compared
    // the wrong way round.
    const jammed = cup({ x: 700, y: 400, width: 120, height: 80 });
    expect(launcherRunway(jammed, [], BOUNDS)).toBeGreaterThanOrEqual(0);
  });
});

describe("a breakable is a price, not a door", () => {
  it("does not stop a shot", () => {
    // Level 6, exactly. The barrel is aimed into a bowed BREAKABLE wall, and
    // the warning called it "fires into a wall" at 135 units of runway against
    // a 225 floor. Ignoring the breakable it has 707. The rule was refusing the
    // one map where the shot most obviously makes sense: level 6 is the map
    // whose whole lesson is the breakable, and a launched ball is the best
    // thing you can pay that price with, since impact damage goes as
    // `speed^1.6` and a ball fired at 2x hits about three times as hard.
    const wall: Blocker = { x: 400, y: 300, width: 30, height: 300, breakable: true };
    expect(launcherRunway(cup(), [wall], BOUNDS)).toBeCloseTo(900 - 45 - 220, 6);
  });

  it("still stops on the solid one behind it", () => {
    // Skipping breakables must not skip everything after them.
    const soft: Blocker = { x: 300, y: 300, width: 30, height: 300, breakable: true };
    const hard: Blocker = { x: 500, y: 300, width: 30, height: 300 };
    expect(launcherRunway(cup(), [soft, hard], BOUNDS)).toBeCloseTo(500 - 220, 6);
  });

  it("treats an unmarked blocker as solid", () => {
    // The flag is opt-in. A blocker with no `breakable` field is a wall, which
    // is what keeps every existing map measuring as it did.
    const wall: Blocker = { x: 400, y: 300, width: 30, height: 300 };
    expect(launcherRunway(cup(), [wall], BOUNDS)).toBeCloseTo(400 - 220, 6);
    const explicit: Blocker = { ...wall, breakable: false };
    expect(launcherRunway(cup(), [explicit], BOUNDS)).toBeCloseTo(400 - 220, 6);
  });
});

describe("the warning the editor shows", () => {
  const floor = 900 * MIN_LAUNCH_RUNWAY_FRACTION;

  it("fires for a barrel aimed at a wall right in front of it", () => {
    const wall: Blocker = { x: 260, y: 300, width: 40, height: 300 };
    expect(launcherRunway(cup(), [wall], BOUNDS)).toBeLessThan(floor);
  });

  it("stays quiet for a barrel with the board in front of it", () => {
    expect(launcherRunway(cup(), [], BOUNDS)).toBeGreaterThan(floor);
  });

  it("fires for a barrel turned back into the wall it sits against", () => {
    // "Shoots the balls backwards into a wall", literally: facing right but
    // turned 180, so it fires at the left edge it is parked next to.
    const backwards = cup({ angle: 180 });
    expect(launcherRunway(backwards, [], BOUNDS)).toBeLessThan(floor);
  });

  it("agrees with the muzzle vector about which way is trouble", () => {
    // Sweep the barrel round and check the runway tracks the heading rather
    // than the unchanged `facing`: parked on the left, shots to the right are
    // long and shots to the left are short, whatever the facing says.
    for (const angle of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const c = cup({ angle });
      const dir = muzzleVector(c.facing, angle);
      const run = launcherRunway(c, [], BOUNDS);
      if (dir.x < -0.7) expect(run, `angle ${angle}`).toBeLessThan(floor);
      if (dir.x > 0.7) expect(run, `angle ${angle}`).toBeGreaterThan(floor);
    }
  });
});

/**
 * The editor has to SHOW this, or none of the above helps anyone.
 *
 * Source-level rather than a render harness, the same trade GameCanvas's payout
 * check takes: the canvas wants a board rect, a view transform and a live 2d
 * context, and a harness for it would be a large fragile thing guarding a
 * handful of calls. What must not happen is the drawing being deleted or
 * quietly reduced to reading `facing`, and that is visible in the source.
 */
describe("the map editor draws where a launcher fires", () => {
  const CANVAS = readFileSync(
    resolve(process.cwd(), "src/components/admin/MapCanvas.tsx"), "utf8");
  const PANEL = readFileSync(
    resolve(process.cwd(), "src/components/admin/EntityPanel.tsx"), "utf8");

  it("draws a muzzle marker at all", () => {
    expect(CANVAS, "the launcher is drawn as a plain rect again")
      .toContain("drawMuzzle");
    // And actually calls it: a defined-but-uncalled helper draws nothing.
    expect(CANVAS).toMatch(/forEach\(drawMuzzle\)/);
  });

  it("aims the marker with the turned muzzle, not the bare facing", () => {
    // A canted barrel drawn from its facing points somewhere it does not fire,
    // which is worse than drawing nothing: it is a confident wrong answer.
    expect(CANVAS).toContain("muzzleRay");
  });

  it("draws it after the entities, so an obstacle cannot cover it", () => {
    const drawn = CANVAS.indexOf("forEach(drawMuzzle)");
    const entities = CANVAS.indexOf("// Draw entities");
    expect(entities).toBeGreaterThan(-1);
    expect(drawn, "the muzzle is drawn before the obstacles it warns about")
      .toBeGreaterThan(entities);
  });

  it("warns on the canvas when the shot has nowhere to go", () => {
    expect(CANVAS).toContain("launcherRunway");
    expect(CANVAS).toContain("FIRES INTO A WALL");
  });

  it("says the resolved heading and the clear run in the panel", () => {
    // The canvas answers "which way"; the panel has to answer "how far", since
    // an arrow clipped at the edge of the view looks the same as a long one.
    expect(PANEL).toContain("launcherRunway");
    expect(PANEL).toContain("muzzleVector");
  });
});
