/**
 * Setting a bumper's bank in the editor, and seeing it as one on the canvas.
 *
 * Two gaps, both about the editor rather than the mechanic:
 *
 *   THE BANK WAS UNREACHABLE. `bounceHours` is the number a designer is really
 *     tuning - a bumper pays one hour per bump until it runs dry, so the bank
 *     is the whole reason a player keeps a ball alive rather than taking the
 *     quick win - and it could only be set by hand-editing map.yml.
 *   A BUMPER LOOKED LIKE A WALL. On the map canvas it drew as a plain circle,
 *     identical to any other obstacle, so the objects that pay hours and change
 *     a ball's speed were indistinguishable from the ones that just sit there.
 *
 * The mechanic itself is covered by bouncer.test.ts. What is checked here is
 * that the authored number survives the trip into the running game, and that
 * the editor draws the thing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { setRunSeedText } from "@/lib/runRng";
import { BOUNCER_HOURS } from "@/lib/physics/bouncer";
import type { LevelConfig } from "@/types/level";

function build(bumper: Record<string, unknown>) {
  setRunSeedText("bumper-fixture");
  const level = {
    id: "bumper-test", level: 1, name: "B", sizeThreshold: 30, expectedCuts: 4,
    points: 20, variety: 0, randomShapes: 0, pickupChance: 0, maxBalls: 1,
    balls: [{ id: "b1", type: "red", startX: 700, startY: 700 }],
    entities: [{
      id: "bump", kind: "wall", shape: "circle",
      cx: 400, cy: 400, radius: 40, bouncer: true, ...bumper,
    }],
  } as unknown as LevelConfig;
  const data = createInitialGameData(level, 1, DEFAULT_MODIFIERS);
  setRunSeedText(null);
  return data;
}

const specOf = (d: ReturnType<typeof build>) => [...d.bouncers.values()][0];

describe("the bank a designer authors", () => {
  it("reaches the running bumper", () => {
    expect(specOf(build({ bounceHours: 12 })).hours).toBe(12);
  });

  it("falls back to the default when the map does not say", () => {
    // Blank in the editor means "use the default", which is what keeps every
    // bumper authored before this control existed worth what it was.
    expect(specOf(build({})).hours).toBe(BOUNCER_HOURS);
  });

  it("honours an authored ZERO rather than treating it as unset", () => {
    // THE distinction the editor's empty-string handling turns on. A zero bank
    // is a real design choice - a bumper that kicks and pays nothing - and if
    // it were read as "unset" that bumper would quietly pay full price.
    expect(specOf(build({ bounceHours: 0 })).hours).toBe(0);
  });

  it("refuses a negative bank rather than paying it out backwards", () => {
    expect(specOf(build({ bounceHours: -5 })).hours).toBe(BOUNCER_HOURS);
  });

  it("keeps the bank a whole number of hours", () => {
    // It is spent one per bump; a fractional bank would leave a bumper stuck
    // at 0.5 hours, neither payable nor empty.
    expect(specOf(build({ bounceHours: 7.6 })).hours).toBe(8);
  });

  it("carries the kicker's bearing through, and omits it when scattering", () => {
    expect(specOf(build({ bounceBearing: "up" })).bearing).toBe("up");
    expect(specOf(build({})).bearing).toBeUndefined();
  });
});

/**
 * The editor has to SHOW it. Source-level for the same reason the launcher's
 * muzzle check is: the canvas wants a board rect, a view transform and a live
 * 2d context, and what must not happen - the drawing being deleted, or the
 * bank becoming unsettable again - is visible in the source.
 */
describe("the editor draws and edits a bumper", () => {
  const CANVAS = readFileSync(
    resolve(process.cwd(), "src/components/admin/MapCanvas.tsx"), "utf8");
  const PANEL = readFileSync(
    resolve(process.cwd(), "src/components/admin/EntityPanel.tsx"), "utf8");

  it("draws bumpers as something other than a plain obstacle", () => {
    expect(CANVAS, "a bumper is drawn as a plain circle again")
      .toContain("drawBumper");
    expect(CANVAS).toMatch(/forEach\(drawBumper\)/);
  });

  it("shows the bank on the canvas, since that is what is being tuned", () => {
    expect(CANVAS).toContain("BOUNCER_HOURS");
  });

  it("distinguishes a kicker from a scattering bouncer", () => {
    // The difference between a pinball and a plan, and invisible until a ball
    // happens to hit one.
    expect(CANVAS).toContain("bounceBearing");
  });

  it("lets the bank be set without hand-editing the yaml", () => {
    expect(PANEL).toContain("BumperEditor");
    expect(PANEL).toContain("bounceHours");
  });

  it("does not store a zero for an empty box", () => {
    // The panel must send `undefined` for a blank field. Storing 0 would make
    // every newly-toggled bumper worthless, and silently.
    expect(PANEL).toMatch(/bounceHours:\s*e\.target\.value === ''\s*\?\s*undefined/);
  });
});
