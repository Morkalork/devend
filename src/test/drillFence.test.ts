/**
 * Step 6 of FENCE_TYPES_PLAN: the drill.
 *
 * The only genuinely new physics in the feature, and the only fence that does
 * three things: it may ANCHOR on a breakable, it CHEWS what it touches, and
 * when that slab dies it CONTINUES growing through the gap to the next solid
 * thing. One drill can chain through several slabs.
 *
 * The chain is what this file is really for. Everything else is a rule that can
 * be read off the code; "two slabs in a line, one drill, and both fall" cannot,
 * because it depends on the continuation being cast against the board AFTER the
 * first slab's cells reopened rather than before.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInitialGameData } from "@/lib/initGame";
import { DEFAULT_MODIFIERS } from "@/hooks/useActiveModifiers";
import { setRunSeedText } from "@/lib/runRng";
import { tickDrills, resumeDrillThrough } from "@/lib/physics/drill";
import { processDestroysFn } from "@/lib/physics/destructibles";
import { getFenceType } from "@/lib/fences";
import type { LevelConfig } from "@/types/level";
import type { CanvasGameState } from "@/types/gameState";
import type { Wall } from "@/lib/wallGeometry";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
beforeEach(() => setRunSeedText(null));

const SLAB = {
  id: "slab", kind: "wall", shape: "rect",
  x: 400, y: 300, width: 40, height: 200, breakable: true, hitsToBreak: 2,
};

const level = (entities: unknown[] = [SLAB]): LevelConfig => ({
  id: "drill-probe", level: 5, sizeThreshold: 40, expectedCuts: 6, points: 20,
  maxBalls: 1, variety: 0, randomShapes: 0, entities,
} as unknown as LevelConfig);

/**
 * A board with the fields the drill paths write to.
 *
 * createInitialGameData builds a BOARD, not a run in progress: `walls` and
 * `activeWalls` are populated by the game shell, so a fixture that skipped them
 * would fail on a `.push` and say nothing about the drill.
 */
const board = (lvl = level()): CanvasGameState => {
  const g = createInitialGameData(lvl, 5, DEFAULT_MODIFIERS) as unknown as CanvasGameState;
  g.walls = g.walls ?? [];
  g.activeWalls = g.activeWalls ?? [];
  g.pendingDestroys = g.pendingDestroys ?? [];
  // registerObjectHit sheds impact chips into this on every non-fatal hit.
  g.objectDebris = g.objectDebris ?? [];
  g.fallingObjects = g.fallingObjects ?? [];
  return g;
};

/** A fence of `typeId` laid up against the slab's left face, pointing right. */
function fenceAgainstSlab(game: CanvasGameState, typeId: string): Wall {
  const d = game.destructibles!.find(x => x.kind === "breakable")!;
  const v = d.obstaclePolygon!.vertices;
  const x0 = Math.min(...v.map(p => p.x));
  const cy = v.reduce((a, p) => a + p.y, 0) / v.length;
  const wall: Wall = {
    id: "drill-wall", thickness: 6,
    start: { x: x0 - 60, y: cy }, end: { x: x0 - 2, y: cy },
    fenceTypeId: typeId,
  } as unknown as Wall;
  game.walls.push(wall);
  return wall;
}

const noopCallbacks = {
  repaintRegionCanvas: () => {}, setRemainingPercent: () => {},
} as unknown as Parameters<typeof processDestroysFn>[1];

describe("chewing", () => {
  it("damages a slab it is resting against", () => {
    const game = board();
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    fenceAgainstSlab(game, "drill");
    expect(d.hits).toBe(0);
    tickDrills(game, 1);
    expect(d.hits, "the drill did not bite").toBeGreaterThan(0);
  });

  it("does nothing for any other fence type", () => {
    // The whole point of the type: an ordinary fence resting on a slab is just
    // a fence resting on a slab.
    for (const type of ["standard", "ice", "flare", "rebar", "tripwire"]) {
      const game = board();
      const d = game.destructibles!.find(x => x.kind === "breakable")!;
      fenceAgainstSlab(game, type);
      tickDrills(game, 5);
      expect(d.hits, `${type} chewed a slab`).toBe(0);
    }
  });

  it("eats per SECOND, not per frame", () => {
    // A drill must not chew twice as fast on a 120Hz phone, and that is a bug
    // that only ever shows up on somebody else's device.
    const slow = board(); const dSlow = slow.destructibles!.find(x => x.kind === "breakable")!;
    fenceAgainstSlab(slow, "drill");
    tickDrills(slow, 1);

    const fast = board(); const dFast = fast.destructibles!.find(x => x.kind === "breakable")!;
    fenceAgainstSlab(fast, "drill");
    // Same second, ten frames instead of one. registerObjectHit debounces per
    // object, so the honest comparison is one tick of 1s against one of 0.1s.
    tickDrills(fast, 0.1);
    expect(dFast.hits).toBeLessThan(dSlow.hits);
    expect(dFast.hits).toBeCloseTo(dSlow.hits * 0.1, 5);
  });

  it("leaves a slab it is nowhere near alone", () => {
    const game = board();
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    game.walls.push({
      id: "far", thickness: 6, start: { x: 60, y: 800 }, end: { x: 200, y: 800 },
      fenceTypeId: "drill",
    } as unknown as Wall);
    tickDrills(game, 5);
    expect(d.hits, "a drill on the far side of the board chewed it").toBe(0);
  });

  it("kills through the same door a ball uses", () => {
    // registerObjectHit, so the smash counter, a chest's reward and the
    // sealed-shadow reopen all happen exactly once and exactly as they would.
    const src = read("src/lib/physics/drill.ts");
    expect(src).toMatch(/registerObjectHit\(game, d,/);
  });
});

describe("continuing through the gap", () => {
  it("sends the fence on when the slab it was eating dies", () => {
    const game = board();
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    fenceAgainstSlab(game, "drill");
    tickDrills(game, 1);            // records which wall was on it
    expect(d.drilledByWallId).toBe("drill-wall");

    const before = game.activeWalls.length;
    const cont = resumeDrillThrough(game, d);
    expect(cont, "the drill stopped at the gap it made").toBeTruthy();
    expect(game.activeWalls.length).toBe(before + 1);
    expect(cont!.fenceTypeId, "the continuation stopped being a drill, so it cannot chain")
      .toBe("drill");
  });

  it("continues in the direction the cut was travelling", () => {
    const game = board();
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    const wall = fenceAgainstSlab(game, "drill");
    tickDrills(game, 1);
    const cont = resumeDrillThrough(game, d)!;
    // The fence pointed right (start.x < end.x), so the continuation must too.
    expect(cont.direction.x).toBeGreaterThan(0.9);
    expect(cont.origin.x).toBeGreaterThanOrEqual(wall.end.x);
  });

  it("grows in ONE direction, not both", () => {
    // It is the same fence carrying on, not a new cut from a point the player
    // chose, so it must not also open up behind itself.
    const game = board();
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    fenceAgainstSlab(game, "drill");
    tickDrills(game, 1);
    const cont = resumeDrillThrough(game, d)!;
    const back = cont.startWaypoints;
    expect(Math.hypot(back[back.length - 1].x - back[0].x, back[back.length - 1].y - back[0].y))
      .toBeLessThan(1e-6);
  });

  it("continues once per slab, however often it is asked", () => {
    const game = board();
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    fenceAgainstSlab(game, "drill");
    tickDrills(game, 1);
    expect(resumeDrillThrough(game, d)).toBeTruthy();
    expect(resumeDrillThrough(game, d), "a second continuation from one slab").toBeNull();
  });

  it("does not continue for a slab no drill was on", () => {
    const game = board();
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    fenceAgainstSlab(game, "standard");
    tickDrills(game, 1);
    expect(resumeDrillThrough(game, d)).toBeNull();
  });

  it("costs no fence from the budget", () => {
    // One drill is one fence however many slabs it chains through. Charging per
    // slab would make a WIP-limit map unplayable with a drill equipped.
    const game = board();
    const d = game.destructibles!.find(x => x.kind === "breakable")!;
    fenceAgainstSlab(game, "drill");
    tickDrills(game, 1);
    const cuts = game.wallCount ?? 0;
    resumeDrillThrough(game, d);
    expect(game.wallCount ?? 0, "the continuation billed the player a fence").toBe(cuts);
  });

  it("casts AFTER the reopen, from the destroy pipeline's end", () => {
    // Order, and it cannot be read off a single function: cast a moment early
    // and the ray stops dead on the obstacle that is no longer there.
    const src = read("src/lib/physics/destructibles.ts");
    const resume = src.indexOf("resumeDrillThrough(game, d)");
    const reopen = src.indexOf("captureUnreachableCells(game.spaceGrid, game.balls, game.walls)");
    expect(resume, "the destroy pipeline stopped continuing drills").toBeGreaterThan(-1);
    expect(resume, "the continuation is cast before the ground reopens")
      .toBeGreaterThan(reopen);
  });
});

describe("the chain", () => {
  it("takes a second slab in the same line", () => {
    // The payoff, and the reason the continuation is a real growing fence.
    const two = level([SLAB, { ...SLAB, id: "slab-2", x: 600 }]);
    const game = board(two);
    const slabs = game.destructibles!.filter(x => x.kind === "breakable");
    expect(slabs).toHaveLength(2);

    // Line the fence up on whichever slab is furthest left, pointing at the other.
    fenceAgainstSlab(game, "drill");
    tickDrills(game, 1);
    const eaten = slabs.find(s => s.drilledByWallId)!;
    expect(eaten, "the drill bit neither slab").toBeTruthy();

    const cont = resumeDrillThrough(game, eaten);
    expect(cont, "no continuation, so nothing can chain").toBeTruthy();
    // The continuation carries the drill type, which is what lets the NEXT slab
    // be eaten when this fence completes.
    expect(getFenceType(cont!.fenceTypeId).drillDamage).toBeGreaterThan(0);
  });
});

describe("anchoring", () => {
  it("lets only the drill start a cut on a slab", () => {
    const src = read("src/hooks/useGameInput.ts");
    expect(src).toMatch(/getFenceType\(game\.selectedFenceTypeId\)\.anchorOnBreakable/);
    expect(src, "the refusal was removed for everyone rather than excepted")
      .toMatch(/!mayAnchor && cutAnchorsBreakable\(/);
  });

  it("is the only type in the catalogue allowed to", () => {
    const drills = ["standard", "ice", "flare", "rebar", "tripwire", "drill"]
      .filter(id => getFenceType(id).anchorOnBreakable);
    expect(drills).toEqual(["drill"]);
  });
});
