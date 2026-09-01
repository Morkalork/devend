/**
 * Everything the engine supports has to be placeable from the builder.
 *
 * Reported as "did you add launcher and bumpers to the admin map maker? Can't
 * find them" - and the answer was no. Both had entity kinds, physics, renderers
 * and property editors, and neither had a BUTTON. The launcher, the delivery
 * box and the cage could not be created at all: the palette made walls and
 * movers, so the only way to get one onto a map was to hand-edit map.yml.
 * Bumpers and portals existed only as a checkbox on a shape you had already
 * placed, which nobody finds without being told.
 *
 * It is the same failure as the missing `game.launchers` assignment and the
 * missing mechanicSpread entries, in a third place: the feature is complete
 * everywhere except the one path a person actually uses, and nothing anywhere
 * reports it. A mechanic nobody can place is a mechanic nobody has.
 *
 * So the check is on the SOURCE of the two files that have to agree, because
 * the thing being guarded is a list drifting away from a list. Rendering the
 * admin here would test that the buttons exist, not that they cover the
 * mechanics - which is the half that was actually wrong.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PANEL = readFileSync(resolve(process.cwd(), "src/components/admin/EntityPanel.tsx"), "utf8");
const BUILDER = readFileSync(resolve(process.cwd(), "src/components/admin/MapBuilder.tsx"), "utf8");

/** The palette entries declared in the shared AddEntityType union. */
function paletteTypes(): string[] {
  const block = PANEL.slice(PANEL.indexOf("export type AddEntityType"));
  const decl = block.slice(0, block.indexOf(";"));
  return [...decl.matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
}

describe("the palette covers the mechanics the engine has", () => {
  const types = paletteTypes();

  it("declares a palette at all", () => {
    expect(types.length, "AddEntityType could not be read").toBeGreaterThan(4);
  });

  it.each([
    ["launcher", "the barrel that holds the map's balls"],
    ["cage", "the container that shuts behind a ball"],
    ["box", "the delivery box"],
    ["bouncer", "the pop bumper"],
    ["kicker", "the aimed bumper"],
    ["portal", "the linked pair"],
  ])("can place a %s (%s)", (kind) => {
    expect(types, `${kind} is not in the palette`).toContain(kind);
  });

  it("has a button for every palette entry", () => {
    // A type nobody can click is the same gap one step further along.
    const missing = types.filter(t => !PANEL.includes(`onAddEntity('${t}')`));
    expect(missing, `declared but unclickable: ${missing.join(", ")}`).toEqual([]);
  });

  it("has builder handling for every palette entry", () => {
    // And a button that falls through to the default branch silently places a
    // plain wall, which looks like it worked.
    const missing = types.filter(t =>
      !new RegExp(`type === '${t}'`).test(BUILDER) && !BUILDER.includes(`'${t}'`));
    expect(missing, `clickable but unhandled: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("what the placed objects have to be born with", () => {
  it("gives a launcher a bore wide enough not to seal its own balls in", () => {
    // A 240x84 barrel rasterises to a staircase that erodes into disconnected
    // cells: the loaded balls become unreachable and the board is written off.
    // launcherBarrel.test.ts pins the property; this pins what the button makes.
    const block = BUILDER.slice(BUILDER.indexOf("type === 'launcher'"));
    const height = /height:\s*(\d+)/.exec(block.slice(0, 500));
    expect(height, "the launcher template has no height").toBeTruthy();
    expect(Number(height![1]), "a narrow bore seals its own balls in")
      .toBeGreaterThanOrEqual(110);
  });

  it("places a portal as a linked PAIR", () => {
    // A lone portal is inert by design, so a button that placed one end would
    // hand the author a dud and a step to remember.
    const block = BUILDER.slice(BUILDER.indexOf("type === 'portal'"));
    expect(block.slice(0, 700)).toMatch(/portal:\s*link/);
    expect(block.slice(0, 700)).toMatch(/mk\(1,[^)]*\), mk\(2,/);
  });

  it("places a bumper already switched on", () => {
    const block = BUILDER.slice(BUILDER.indexOf("type === 'bouncer'"));
    expect(block.slice(0, 700)).toMatch(/bouncer:\s*true/);
  });
});
