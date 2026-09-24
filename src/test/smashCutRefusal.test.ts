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
import { createInitialGameData } from "@/lib/initGame";
import { applyCutFn } from "@/lib/physics/applyCut";
import type { CanvasGameState } from "@/types/gameState";
import type { GrowingWall } from "@/types/game";
import type { LevelConfig } from "@/types/level";
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
   * The request, pinned: the maps with many bricks ask for a real share of
   * them (half, where the bricks are the whole ask; a third or more where the
   * win has other lines). A number in a YAML file is exactly the kind of thing
   * that drifts back.
   */
  const yaml = read("public/map.yml");

  it("asks for a real share of the bricks on the maps that have many", () => {
    const levels = yaml.split(/\n {2}- id: level-/).slice(1);
    // 7 and 9 ask for four rather than six since their wins gained lines of
    // their own: a monolith on both (the chest the win used to ignore), and on
    // 9 the box as well. Reported from play as "only shards in the AC, so why
    // go for the monolith"; the shard count paid for the extra line. Still a
    // third of the run or more, which is the point this test protects.
    //
    // 6 asks four of twelve for a different reason: its divider used to topple
    // from the bottom (a bug, fixed in the stack graph), which had been doing
    // most of the smashing, and four is what measures the same without it.
    for (const [n, want] of [[5, 2], [6, 4], [7, 4], [9, 4]] as const) {
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

describe("the board says why, in words", () => {
  /**
   * The flare alone was not enough, and play said so: a cut drawn in level 9's
   * right-hand chamber was refused while the slabs it would have orphaned sat
   * in the LEFT one, so the only cue the game gave fired where the player was
   * not looking. What they saw was a fence that drew all the way across and
   * then vanished, and what they asked was "could there be an invisible object
   * there?" - which is the exact question a silent rule produces.
   *
   * Both refusals in applyCut now raise a line in the message bar. This test
   * drives the real applyCutFn rather than the predicate, because the predicate
   * was never the part that was broken.
   */
  const LEVEL: LevelConfig = {
    id: "refusal-speaks", level: 9, sizeThreshold: 40, expectedCuts: 5, points: 40,
    maxBalls: 1,
    entities: [
      // Both bricks in the right half, so one vertical fence orphans the pair.
      { id: "brick-a", kind: "wall", shape: "rect", x: 620, y: 300, width: 60, height: 40, breakable: true },
      { id: "brick-b", kind: "wall", shape: "rect", x: 620, y: 420, width: 60, height: 40, breakable: true },
    ],
    win: { require: [{ kind: "space", threshold: 40 }, { kind: "smashed", count: 2 }] },
    // Level 9 is above ROTATION_MIN_LEVEL, so without this the loader deals the
    // board a quarter turn and every coordinate written below lands somewhere
    // else. A fixture that has to be re-derived per deal is testing the dealer.
    neverRotates: true,
    randomShapes: 0,
    variety: 0,
  } as unknown as LevelConfig;

  function makeGame(): CanvasGameState {
    const data = createInitialGameData(LEVEL, 9, plainModifiers());
    return {
      ...data,
      activeWalls: [], gameOver: false, levelComplete: false, wallCount: 0,
      screenSize: { width: 900, height: 900 },
      boardRect: { left: 0, top: 0, width: 900, height: 900, scale: 1 },
      pushMode: "none", bestRemainingPercent: 100, pushStartPercent: 100,
      lockedBallsCount: 0, assimilations: new Map(), objectDebris: [],
      pendingDestroys: [], pendingWallBreaks: [], fallingObjects: [],
      bonusCutCells: new Set(), objectivesBroken: 0, activePlaySeconds: 3,
      lockWinThresholdPercent: 85, lockMinRegionCells: 0,
    } as unknown as CanvasGameState;
  }

  /** A finished fence down x, which puts the right-hand bricks out of reach. */
  function fenceDown(x: number): GrowingWall {
    return {
      origin: { x, y: 450 }, direction: { x: 0, y: 0 },
      startWaypoints: [{ x, y: 450 }, { x, y: 0 }],
      endWaypoints: [{ x, y: 450 }, { x, y: 900 }],
      startSegmentIndex: 0, endSegmentIndex: 0,
      startPoint: { x, y: 0 }, endPoint: { x, y: 900 },
      targetStart: { x, y: 0 }, targetEnd: { x, y: 900 },
      thickness: 6, isComplete: true, activeRegionId: "",
    } as unknown as GrowingWall;
  }

  function recorder() {
    const said: string[] = [];
    const callbacks = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "then") return undefined;
        if (prop === "onGameMessage") return (id: string) => { said.push(id); };
        return () => {};
      },
    }) as never;
    return { said, callbacks };
  }

  it("says the cut would bury the slabs, rather than nothing at all", () => {
    const game = makeGame();
    // The one ball on the LEFT, so the fence is legal for balls and refused
    // only by the smash rule - the situation the screenshot showed.
    game.balls = game.balls.slice(0, 1);
    game.balls[0].position = { x: 150, y: 450 };
    game.balls[0].velocity = { x: 60, y: 40 };

    const { said, callbacks } = recorder();
    const wall = fenceDown(450);
    game.activeWalls = [wall];
    applyCutFn(wall, game, LEVEL, 9, plainModifiers(), false, false, 0, callbacks);

    expect(said, "the refusal was silent, which reads as an invisible object")
      .toContain("cutWouldBurySlabs");
    expect(game.activeWalls, "the refused fence was left on the board").toHaveLength(0);
    expect(game.wallCount, "a refused cut still spent a fence").toBe(0);
  });

  it("stays quiet on a cut it allows", () => {
    const game = makeGame();
    game.balls = game.balls.slice(0, 1);
    game.balls[0].position = { x: 150, y: 450 };
    game.balls[0].velocity = { x: 60, y: 40 };

    const { said, callbacks } = recorder();
    // Far left, well clear of the bricks: nothing to protect, nothing to say.
    const wall = fenceDown(60);
    game.activeWalls = [wall];
    applyCutFn(wall, game, LEVEL, 9, plainModifiers(), false, false, 0, callbacks);

    expect(said, "an ordinary cut explained itself").toHaveLength(0);
  });

  it("wires both of applyCut's completion-time refusals, not just one", () => {
    // The ball refusal is the older of the two and was silent for longer. A
    // source check rather than a scenario: building a board where a fence
    // orphans a ball AND nothing else intervenes is a map-authoring exercise,
    // and what matters here is only that the call is there.
    const cut = read("src/lib/physics/applyCut.ts");
    const block = cut.slice(cut.indexOf("Reject walls that would orphan a ball"));
    const refusal = block.slice(0, block.indexOf("Commit fence segments"));
    expect(refusal).toContain('onGameMessage?.("cutWouldTrapBall")');
    expect(refusal).toContain('onGameMessage?.("cutWouldBurySlabs")');
  });
});
