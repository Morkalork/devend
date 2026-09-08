/**
 * The launchers actually authored in map.yml.
 *
 * Everything else about this feature is a pure function agreeing with itself.
 * None of it proves a real map is playable, and a launcher has two ways to make
 * one that is not:
 *
 *   A BLOCKED MUZZLE. The cup's open side is the only way out. Point it at the
 *     board edge, or wall it in, and the ball rattles inside forever - a map
 *     that cannot be won and cannot be diagnosed from the outside, because
 *     everything looks fine until you fire.
 *   A CUP OFF THE BOARD. The interior has to be inside the play area or the
 *     ball spawns in the margin the arena was shrunk out of.
 *
 * Both are geometry, and both are cheap to check the way gravityWells.test.ts
 * already checks its wells.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  muzzleVector, launcherRunway, MIN_LAUNCH_RUNWAY_FRACTION, LAUNCH_SPREAD,
  type LaunchFacing, type Blocker,
} from "@/lib/launcher";
import { BOX_WALL_THICKNESS } from "@/lib/gameConstants";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import { ARENA_MARGIN } from "@/lib/gameConstants";

import { ENGINE_MAPS } from "./fixtures/maps";

interface Cup {
  id: string; kind: string; facing: LaunchFacing; angle?: number;
  x: number; y: number; width: number; height: number;
}
interface Level {
  id: string; level: number; maxBalls?: number;
  entities?: Array<Record<string, unknown>>;
}

const MAP = ({ levels: ENGINE_MAPS } as unknown as { levels: Level[] });

const MARGIN = Math.min(BOARD_WIDTH, BOARD_HEIGHT) * ARENA_MARGIN;

const cupsOf = (l: Level): Cup[] =>
  (l.entities ?? []).filter(e => e.kind === "launcher") as unknown as Cup[];

const withCups = MAP.levels
  .map(l => ({ level: l, cups: cupsOf(l) }))
  .filter(x => x.cups.length > 0);

describe("the launchers in map.yml", () => {
  it("exist at all", () => {
    // A guard on the guard: if every launcher were removed or renamed, the
    // loops below would pass by iterating over nothing.
    expect(withCups.length).toBeGreaterThan(0);
    expect(withCups.map(x => x.level.id)).toContain("level-11");
  });

  it("sits inside the playable arena, walls and all", () => {
    for (const { level, cups } of withCups) {
      for (const c of cups) {
        expect(c.x, `${level.id}/${c.id} left`).toBeGreaterThanOrEqual(MARGIN);
        expect(c.y, `${level.id}/${c.id} top`).toBeGreaterThanOrEqual(MARGIN);
        expect(c.x + c.width, `${level.id}/${c.id} right`)
          .toBeLessThanOrEqual(BOARD_WIDTH - MARGIN);
        expect(c.y + c.height, `${level.id}/${c.id} bottom`)
          .toBeLessThanOrEqual(BOARD_HEIGHT - MARGIN);
      }
    }
  });

  it("is big enough to hold a ball", () => {
    // Interior is the cup minus a wall on each side. Under a ball's diameter
    // and the loaded ball spawns inside the cup's own wall.
    for (const { level, cups } of withCups) {
      for (const c of cups) {
        const innerW = c.width - 2 * BOX_WALL_THICKNESS;
        const innerH = c.height - 2 * BOX_WALL_THICKNESS;
        expect(innerW, `${level.id}/${c.id} interior width`).toBeGreaterThan(40);
        expect(innerH, `${level.id}/${c.id} interior height`).toBeGreaterThan(40);
      }
    }
  });

  it("does not fire straight into the board edge, or into another obstacle", () => {
    // The cup's open side is the only way out, so the muzzle needs somewhere to
    // go. A ball that leaves and immediately bounces back in is a map that
    // opens by wasting the player's one shot.
    //
    // Runs through launcherRunway, which is the SAME function the map editor
    // draws its arrow and its "FIRES INTO A WALL" warning from. It used to
    // recompute the ray here, and against the arena edge only - so the editor
    // could pass a barrel this rejected, and this could pass a barrel aimed
    // point-blank at a wall. A designer told two different things by two copies
    // of one rule stops believing either.
    for (const { level, cups } of withCups) {
      const blockers = (level.entities ?? [])
        .filter(e => e.shape === "rect")
        .map(e => e as unknown as Blocker);
      for (const c of cups) {
        const runway = launcherRunway(
          c,
          blockers.filter(b => (b as unknown as { id: string }).id !== c.id),
          { width: BOARD_WIDTH, height: BOARD_HEIGHT, margin: MARGIN },
        );
        expect(runway, `${level.id}/${c.id} has no room to fire`)
          .toBeGreaterThan(BOARD_WIDTH * MIN_LAUNCH_RUNWAY_FRACTION);
      }
    }
  });

  it("names a real facing", () => {
    for (const { level, cups } of withCups) {
      for (const c of cups) {
        expect(["up", "down", "left", "right"], `${level.id}/${c.id}`).toContain(c.facing);
      }
    }
  });
});

describe("level 11 pays for the launcher it gained", () => {
  const l11 = MAP.levels.find(l => l.id === "level-11")!;

  it("keeps its full roster, because the barrel holds it rather than adding to it", () => {
    // This used to read `toBe(2)`: the cup created a ball of its own, so the
    // authored count was dropped by one to keep the map's roster at three. The
    // barrel now LOADS the balls the map already has instead of adding one, so
    // the authored number is the roster again. Same three balls either way; the
    // difference is that all three are now in the barrel.
    expect(l11.maxBalls).toBe(3);
  });

  it("puts the curtain inside the cone the player can actually aim in", () => {
    // The map's shape IS the shot. The barrel sits in one corner and the thing
    // worth shooting at - the curtain over the paying pocket - is in the far
    // one, so opening it with the launch is a line the player can take, and
    // every other aim in the cone is them choosing not to.
    //
    // Checked against LAUNCH_SPREAD rather than against the barrel's centre
    // line, because the cone is what the player has: a drag is aimed anywhere
    // within it, and an assertion on the axis alone would demand the map be
    // built for the one shot nobody has to take. Measured from the MUZZLE - the
    // barrel is canted, so its middle sits nowhere near the height it fires at.
    const cup = cupsOf(l11)[0];
    const curtain = (l11.entities ?? []).find(e => e.id === "curtain") as
      unknown as { x: number; y: number; width: number; height: number };
    expect(curtain, "level 11 lost its curtain").toBeTruthy();

    expect(cup.facing).toBe("right");
    const dir = muzzleVector(cup.facing, cup.angle);
    const reach = (Math.abs(dir.x) > Math.abs(dir.y) ? cup.width : cup.height) / 2;
    const mx = cup.x + cup.width / 2 + dir.x * reach;
    const my = cup.y + cup.height / 2 + dir.y * reach;

    const toTarget = Math.atan2(
      curtain.y + curtain.height / 2 - my, curtain.x + curtain.width / 2 - mx);
    const axis = Math.atan2(dir.y, dir.x);
    let off = Math.abs(toTarget - axis);
    if (off > Math.PI) off = 2 * Math.PI - off;

    expect(off, `the curtain is ${(off * 180 / Math.PI).toFixed(0)} degrees off the barrel`)
      .toBeLessThan(LAUNCH_SPREAD);
  });

  it("leaves the centre line clear all the way there", () => {
    // A solid in the way turns the aimed shot into a bounce, and the whole
    // point of the barrel on its Meet map is that what you aim at is what you
    // get. Breakables do not block - hitting one is a legitimate use of the
    // shot - so only the solid walls are checked.
    const cup = cupsOf(l11)[0];
    const dir = muzzleVector(cup.facing, cup.angle);
    const reach = (Math.abs(dir.x) > Math.abs(dir.y) ? cup.width : cup.height) / 2;
    const mx = cup.x + cup.width / 2 + dir.x * reach;
    const my = cup.y + cup.height / 2 + dir.y * reach;

    const solids = (l11.entities ?? []).filter(e =>
      e.kind === "wall" && !(e as unknown as { breakable?: boolean }).breakable,
    ) as unknown as Array<{ id: string; x: number; y: number; width: number; height: number }>;
    expect(solids.length, "no solid walls to check against").toBeGreaterThan(0);

    for (let d = 0; d <= 600; d += 5) {
      const px = mx + dir.x * d;
      const py = my + dir.y * d;
      for (const w of solids) {
        const hit = px >= w.x && px <= w.x + w.width && py >= w.y && py <= w.y + w.height;
        expect(hit, `${w.id} sits on the centre line, ${d} units out`).toBe(false);
      }
    }
  });

  it("is a barrel rather than a cup: long, and turned off the axis", () => {
    // Both halves of "not what I had in mind". A short axis-aligned box reads as
    // one more wall; the length is what says "this is loaded" and the angle is
    // what says "it is pointing somewhere".
    const cup = cupsOf(l11)[0];
    const long = Math.max(cup.width, cup.height);
    const short = Math.min(cup.width, cup.height);
    expect(long / short, "the barrel is too stubby to read as one").toBeGreaterThan(2);
    expect(cup.angle ?? 0, "an axis-aligned barrel is just a wall").not.toBe(0);
    expect(Math.abs((cup.angle ?? 0) % 90), "a right-angle turn is still axis-aligned")
      .toBeGreaterThan(5);
  });
});
