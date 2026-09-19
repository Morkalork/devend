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
import { LADDER, byLevel } from "./fixtures/maps";
import { setRunSeedText } from "@/lib/runRng";
import { cutWouldBurySmashes } from "@/lib/physics/smashReach";
import { refusalFlare, REFUSAL_FLARE_SECONDS } from "@/lib/rendering/startupPulse";
import { CellState, type SpaceGrid } from "@/lib/spaceGrid";
import type { CanvasGameState } from "@/types/gameState";
import type { WinSpec } from "@/types/winSpec";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

// ── A board built by hand, so the rule can be asked a question with a known
//    answer: one ball bottom-left, one brick top-right, open ground between.

/** 600x600 of 15-unit cells, all open. */
function openGrid(): SpaceGrid {
  const cells = new Uint8Array(40 * 40).fill(CellState.ACTIVE);
  return {
    cellSize: 15, width: 40, height: 40, originX: 0, originY: 0,
    cells, initialActiveCount: cells.length, activeCount: cells.length,
    cellRegionIds: new Array(cells.length).fill("region-1"),
  } as unknown as SpaceGrid;
}

function brick(id: string, x: number, y: number) {
  return {
    id, kind: "breakable", hits: 0, maxHits: 1, destroyed: false,
    obstaclePolygon: { vertices: [
      { x, y }, { x: x + 40, y }, { x: x + 40, y: y + 40 }, { x, y: y + 40 },
    ] },
  };
}

function board(over: Partial<CanvasGameState> = {}): CanvasGameState {
  return {
    spaceGrid: openGrid(),
    balls: [{ id: "b1", state: "active", speed: 300, radius: 18, position: { x: 90, y: 90 } }],
    walls: [],
    destructibles: [brick("brick-1", 480, 480), brick("brick-2", 480, 400)],
    ...over,
  } as unknown as CanvasGameState;
}

const spec = (count: number): WinSpec => ({
  require: count > 0
    ? [{ kind: "space", threshold: 10 }, { kind: "smashed", count }]
    : [{ kind: "space", threshold: 10 }],
  alsoWinIf: [], authored: true,
});

/** A fence straight down the board at x, which puts the bricks out of reach. */
const SEALS_THE_BRICKS = [{ start: { x: 300, y: 0 }, end: { x: 300, y: 600 } }];
/** A fence in the ball's own corner, which puts nothing out of reach. */
const HARMLESS = [{ start: { x: 40, y: 0 }, end: { x: 40, y: 200 } }];

describe("what the rule refuses", () => {
  it("refuses a cut that would put the last needed brick out of reach", () => {
    expect(cutWouldBurySmashes(board(), spec(2), SEALS_THE_BRICKS, 6)).toBe(true);
  });

  it("allows the same cut when the map has bricks to spare", () => {
    // THE thing that must not go wrong. The rule is about the REQUIREMENT, not
    // about any single brick: a map asking for one smash may lose the two on
    // the far side of a fence as long as one is still reachable.
    const game = board({
      destructibles: [brick("far-1", 480, 480), brick("near-1", 120, 480)] as never,
    });
    expect(cutWouldBurySmashes(game, spec(1), SEALS_THE_BRICKS, 6)).toBe(false);
  });

  it("allows an ordinary cut nowhere near the bricks", () => {
    expect(cutWouldBurySmashes(board(), spec(2), HARMLESS, 6)).toBe(false);
  });

  it("says nothing about a map with no smash clause", () => {
    expect(cutWouldBurySmashes(board(), spec(0), SEALS_THE_BRICKS, 6)).toBe(false);
  });

  it("says nothing about a map with nothing to smash", () => {
    // An authoring fault, and not the player's cut to be blamed for.
    expect(cutWouldBurySmashes(board({ destructibles: [] }), spec(1), SEALS_THE_BRICKS, 6))
      .toBe(false);
  });

  it("stops refusing once the map is already beyond reach", () => {
    // That state belongs to objectiveBuried, which ends the map and says why.
    // Refusing every cut instead would leave the player fencing at a board that
    // silently declines to change, which is the silence this whole rule exists
    // to prevent.
    const game = board();
    const grid = game.spaceGrid!;
    for (let i = 0; i < grid.cells.length; i++) {
      const col = i % grid.width;
      if (col > 20) grid.cells[i] = CellState.REMOVED;   // both bricks buried
    }
    expect(cutWouldBurySmashes(game, spec(2), HARMLESS, 6)).toBe(false);
  });

  it("counts a brick already broken, which nothing can take away", () => {
    const game = board({
      destructibles: [
        { ...brick("done", 480, 480), destroyed: true },
        brick("live", 120, 480),
      ] as never,
    });
    expect(cutWouldBurySmashes(game, spec(2), SEALS_THE_BRICKS, 6)).toBe(false);
  });

  it("leaves the real board alone when it cannot read one", () => {
    expect(cutWouldBurySmashes(board({ spaceGrid: null }), spec(2), SEALS_THE_BRICKS, 6))
      .toBe(false);
  });
});

describe("on a real board, an ordinary cut is untouched", () => {
  /**
   * The failure that would make this rule worse than the problem: a predicate
   * that refuses fences nobody should have been refused. Level 6 is the map
   * with the most to lose - twelve bricks in one column and a clause asking for
   * six - so a cut across open floor there has to behave exactly as before.
   *
   * Measured rather than argued elsewhere: across four bot runs per map the
   * rule refused 2 of 63 completed cuts on level 7, 10 of 86 on level 5 and 19
   * of 109 on level 9, and every one of those would previously have been a lost
   * life rather than a fence that did not land.
   */
  it("lands a fence that buries nothing", () => {
    installClock();
    setRunSeedText("smash-refusal");
    const level = byLevel(LADDER, 6)!;
    const ctx = createBotGame(level, 6, plainModifiers());
    for (let i = 0; i < 30; i++) stepBot(ctx);
    const game = ctx.game;

    // wallCount, not walls.length: a capture removes segments that end up
    // inside claimed ground, so the wall list can SHRINK on a cut that landed.
    const before = game.wallCount;
    expect(tryCut(ctx, { x: 200, y: 300 }, { x: 1, y: 0 }), "the cut never started")
      .toBe(true);
    for (let i = 0; i < 900 && game.activeWalls.length > 0; i++) stepBot(ctx);

    expect(game.wallCount, "an ordinary fence was refused").toBeGreaterThan(before);
    expect(game.smashRefusedAtSeconds, "the board flared at a cut it allowed")
      .toBeUndefined();
    expect(ctx.events.livesLost).toBe(0);
    releaseClock();
  });
});

describe("the board says why", () => {
  it("flares at the moment of the refusal and fades out", () => {
    expect(refusalFlare(10, 10)).toBeCloseTo(1, 5);
    expect(refusalFlare(10 + REFUSAL_FLARE_SECONDS / 2, 10)).toBeCloseTo(0.5, 5);
    expect(refusalFlare(10 + REFUSAL_FLARE_SECONDS, 10)).toBeCloseTo(0, 6);
    expect(refusalFlare(30, 10), "the marker is still shouting a map later").toBe(0);
  });

  it("is silent when no cut has been refused", () => {
    expect(refusalFlare(10, undefined)).toBe(0);
  });

  it("rides the win markers rather than inventing a second language", () => {
    // The cue has to say WHICH slabs stopped the cut, and the board already has
    // a marker for exactly those - the slow breathe over what the win still
    // needs. Making it louder for a moment reuses a thing the player has been
    // looking at all map.
    const layer = read("src/lib/rendering/sleek/areaLayer.ts");
    expect(layer).toContain("refusalFlare(game.activePlaySeconds ?? 0, game.smashRefusedAtSeconds)");
    const draw = layer.slice(layer.indexOf("private drawWinTargets"));
    expect(draw.slice(0, 1400), "the flare is computed and never used").toContain("flare *");
  });

  it("sits with the refusal that already existed, and costs the same nothing", () => {
    const cut = read("src/lib/physics/applyCut.ts");
    const block = cut.slice(cut.indexOf("Reject walls that would orphan a ball"));
    const refusal = block.slice(0, block.indexOf("Commit fence segments"));
    expect(refusal).toContain("cutWouldBurySmashes(game,");
    expect(refusal, "a refused cut takes a life somewhere in here")
      .not.toContain("failMapCostingALife");
  });
});

describe("the ladder's counts", () => {
  /**
   * The request, pinned: the maps with many bricks ask for about half of them.
   * A number in a YAML file is exactly the kind of thing that drifts back.
   */
  const yaml = read("public/map.yml");

  it("asks for half the bricks on the maps that have many", () => {
    const levels = yaml.split(/\n {2}- id: level-/).slice(1);
    for (const [n, want] of [[5, 2], [6, 6], [7, 6], [9, 6]] as const) {
      const body = levels.find(l => l.startsWith(`${n}\n`))!;
      const count = body.match(/- kind: smashed\n\s+count: (\d+)/)?.[1];
      expect(Number(count), `level ${n} no longer asks for half its bricks`).toBe(want);
    }
  });

  it("keeps every smash clause under the number of breakables it has", () => {
    // The slack rule (MAP_DESIGN_GUIDELINES section 1). Half of many leaves
    // plenty; half of two would leave none, which is the shape that makes a
    // single object load-bearing.
    const levels = yaml.split(/\n {2}- id: level-/).slice(1);
    for (const body of levels) {
      const count = Number(body.match(/- kind: smashed\n\s+count: (\d+)/)?.[1] ?? 0);
      if (count === 0) continue;
      const breakables = (body.match(/\n {8}(brittle|chest|breakable): true/g) ?? []).length;
      const id = body.slice(0, body.indexOf("\n"));
      expect(count, `level ${id} has no brick to spare`).toBeLessThan(breakables);
    }
  });
});
