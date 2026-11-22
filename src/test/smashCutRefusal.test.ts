/**
 * A cut that would bury the slabs the win still needs does not land.
 *
 * Act I's breakables used to be one slab per map and are now runs of one-touch
 * bricks, and the win counts were raised to match: half the bricks, on the maps
 * that have many of them. Asked for as "since there are now many, the win count
 * could go up as well. Not to match all of them, but half would work."
 *
 * Raising the counts alone made those maps worse, and the sweep said exactly
 * how: on eight seeds, level 6 fell from 7 wins to 3, level 7 from 7 to 4 and
 * level 13 from 8 to 3, and EVERY loss was objectiveBuried. The counts were not
 * the problem. A map that asks for six of twelve bricks is a fine map; the
 * problem was that getting the ORDER of play wrong cost a life, on a cut that
 * looked like every other cut, sometimes with 88% of the board still live.
 *
 * With one slab and a clause asking for one, you had to go out of your way to
 * bury it. With a RUN of twelve behind one doorway, a single ordinary fence can
 * orphan the lot - so "slack" counted in objects (nine spare!) is not slack at
 * all when the objects share a lane.
 *
 * So the cut is refused instead of the map being failed, exactly as a cut that
 * would orphan a ball has always been refused: the fence does not land, nothing
 * is spent, the board is unchanged, and the player tries somewhere else. The
 * lesson is the same one and it is free.
 *
 * What this file guards, in order of how badly each would hurt:
 *   - the refusal fires when the map would really be lost, and NOT otherwise
 *     (a rule that eats ordinary cuts is worse than the failure it prevents)
 *   - a map already beyond reach refuses nothing, so objectiveBuried still ends
 *     it rather than the board silently declining every fence
 *   - the refusal costs nothing: no life, no cut, no fence
 *   - it says something, because a silent refusal at this rate reads as a bug
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createBotGame, stepBot, tryCut, plainModifiers, installClock, releaseClock,
} from "@/lib/bot/headlessGame";
import { ARCHIVE, byLevel } from "./fixtures/maps";
import { setRunSeedText } from "@/lib/runRng";
import { refusalFlare, REFUSAL_FLARE_SECONDS } from "@/lib/rendering/startupPulse";
import { CellState, type SpaceGrid } from "@/lib/spaceGrid";
import { createInitialGameData } from "@/lib/initGame";
import { applyCutFn } from "@/lib/physics/applyCut";
import type { CanvasGameState } from "@/types/gameState";
import type { GrowingWall } from "@/types/game";
import type { LevelConfig } from "@/types/level";
import type { WinSpec } from "@/types/winSpec";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

// The refusal this file was written for is gone (BRICKS_PLAN.md): a fence
// that buries bricks is no longer turned away. It lands; the map goes on if
// enough bricks are left and is lost if not (brickBurial.test.ts). What stays
// here is the check on the archive's own counts.

describe("the ladder's counts", () => {
  /**
   * The request, pinned: the maps with many bricks ask for a real share of
   * them (half, where the bricks are the whole ask; a third or more where the
   * win has other lines). A number in a YAML file is exactly the kind of thing
   * that drifts back.
   */
  const yaml = read("public/maps-archive.yml");

  it("asks for a real share of the bricks on the maps that have many", () => {
    const levels = yaml.split(/\n {2}- id: level-/).slice(1);
    // 7 and 9 ask for four rather than six since their wins gained lines of
    // their own: a monolith on both (the chest the win used to ignore), and on
    // 9 the box as well. Reported from play as "only shards in the AC, so why
    // go for the monolith"; the shard count paid for the extra line. Still a
    // third of the run or more, which is the point this test protects.
    //
    // 6 asks twelve of eighteen: its shards moved from one divider column into
    // teeth on both sides of a solid spine, walling alcoves, and every one spent
    // is a pocket given up. It was a third of the teeth; raised to two thirds on
    // request, which leaves six of slack before a sealed tooth buries the win.
    for (const [n, want] of [[5, 2], [6, 12], [7, 4], [9, 4]] as const) {
      const body = levels.find(l => l.startsWith(`${n}\n`))!;
      const count = body.match(/- kind: smashed\n\s+count: (\d+)/)?.[1];
      expect(Number(count), `level ${n} changed how many of its bricks it asks for`).toBe(want);
    }
  });

  it("keeps every smash clause under the number of breakables OF ITS CLASS", () => {
    // The slack rule (MAP_DESIGN_GUIDELINES section 1). Half of many leaves
    // plenty; half of two would leave none, which is the shape that makes a
    // single object load-bearing.
    //
    // Per class, and that is the whole point of this rewrite. It used to lump
    // every breakable into one number, so a clause asking for the one monolith
    // on a map of thirty-four shards was measured against thirty-five and
    // passed with room to spare. Level 17 is that map, the question was asked
    // in as many words, and the sweep is what caught it: 5 wins of 8 became 1,
    // five losses objectiveBuried.
    const levels = yaml.split(/\n {2}- id: level-/).slice(1);
    for (const body of levels) {
      const id = body.slice(0, body.indexOf("\n"));
      // Each entity block, so a flag can be attributed to the object carrying
      // it rather than counted loose across the map.
      const entities = body.split(/\n {6}- id: /).slice(1);
      const shards = entities.filter(e => /\n {8}brittle: true/.test(e)).length;
      const monoliths = entities.filter(e =>
        /\n {8}(chest|breakable): true/.test(e) && !/\n {8}brittle: true/.test(e)).length;

      for (const m of body.matchAll(/- kind: smashed\n\s+count: (\d+)\n\s+of: (\w+)/g)) {
        const count = Number(m[1]);
        const have = m[2] === "shards" ? shards : m[2] === "monoliths" ? monoliths : shards + monoliths;
        expect(count, `level ${id} asks for ${count} of ${m[2]} and has ${have}: no spare`)
          .toBeLessThan(have);
      }
    }
  });

  it("names a class on every clause, so the check above can do its job", () => {
    // A clause without `of` is measured against both classes lumped together,
    // which is exactly the blindness the test above exists to remove. The gate
    // only forces `of` on a map holding both; the ladder says it everywhere so
    // a map copied from it inherits the habit.
    const levels = yaml.split(/\n {2}- id: level-/).slice(1);
    for (const body of levels) {
      const id = body.slice(0, body.indexOf("\n"));
      const clauses = [...body.matchAll(/- kind: smashed\n\s+count: \d+\n(\s+of: \w+)?/g)];
      for (const c of clauses) {
        expect(c[1], `level ${id} has a smash clause that does not say of what`).toBeTruthy();
      }
    }
  });
});

