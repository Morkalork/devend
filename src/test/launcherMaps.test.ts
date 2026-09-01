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
import { bearingVector, type LaunchFacing } from "@/lib/launcher";
import { BOX_WALL_THICKNESS } from "@/lib/gameConstants";
import { BOARD_WIDTH, BOARD_HEIGHT } from "@/lib/boardConstants";
import { ARENA_MARGIN } from "@/lib/gameConstants";

interface Cup {
  id: string; kind: string; facing: LaunchFacing;
  x: number; y: number; width: number; height: number;
}
interface Level {
  id: string; level: number; maxBalls?: number;
  entities?: Array<Record<string, unknown>>;
}

const MAP = yaml.load(
  readFileSync(resolve(__dirname, "../../public/map.yml"), "utf8"),
) as { levels: Level[] };

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

  it("does not fire straight into the board edge", () => {
    // The cup's open side is the only way out, so the muzzle needs somewhere to
    // go. A ball that leaves and immediately bounces back in is a map that
    // opens by wasting the player's one shot.
    for (const { level, cups } of withCups) {
      for (const c of cups) {
        const dir = bearingVector(c.facing);
        const mouthX = c.x + c.width / 2 + dir.x * (c.width / 2);
        const mouthY = c.y + c.height / 2 + dir.y * (c.height / 2);
        const runway =
          dir.x > 0 ? BOARD_WIDTH - MARGIN - mouthX
          : dir.x < 0 ? mouthX - MARGIN
          : dir.y > 0 ? BOARD_HEIGHT - MARGIN - mouthY
          : mouthY - MARGIN;
        expect(runway, `${level.id}/${c.id} has no room to fire`)
          .toBeGreaterThan(BOARD_WIDTH * 0.25);
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

  it("drops a random ball, so the roster is the size it was", () => {
    // The cup adds a ball of its own. Left at 3 the map would quietly gain a
    // fourth, which is a different map from the one the ladder was tuned on.
    expect(l11.maxBalls).toBe(2);
  });

  it("aims through the gap in the spine rather than into it", () => {
    // The map's shape IS the shot: the spine has a gap, and a full-power run
    // through it is the reward for pulling hard. Firing into the spine instead
    // would make the wager pointless.
    const cup = cupsOf(l11)[0];
    const spineTop = (l11.entities ?? []).find(e => e.id === "spine-top") as
      unknown as { y: number; height: number };
    const spineBottom = (l11.entities ?? []).find(e => e.id === "spine-bottom") as
      unknown as { y: number };
    const gapFrom = spineTop.y + spineTop.height;
    const gapTo = spineBottom.y;

    expect(cup.facing).toBe("right");
    const cupMidY = cup.y + cup.height / 2;
    expect(cupMidY, "the cup does not line up with the gap").toBeGreaterThan(gapFrom);
    expect(cupMidY, "the cup does not line up with the gap").toBeLessThan(gapTo);
  });
});
